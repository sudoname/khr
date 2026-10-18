import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { Prisma } from '@peopleflow/database';
import type { PayrollRunCreateInput, PayrollSettingsInput } from '@peopleflow/types';
import { csvSafe } from '../common/csv';
import { config } from '../config';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { renderEmail } from '../infra/email-template';
import { PrismaService } from '../infra/prisma.service';
import { QueueService } from '../infra/queue.service';
import {
  computePayslip,
  ENGINE_VERSION,
  regimeForPeriod,
  toComputeSettings,
  toMonthlyGross,
  type PayrollComputeSettings,
  type TaxRegimeId,
} from './nigeria-tax';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DEFAULT_SETTINGS: PayrollSettingsInput = {
  basicPercent: 50,
  housingPercent: 25,
  transportPercent: 25,
  pensionEnabled: true,
  pensionEmployeePercent: 8,
  pensionEmployerPercent: 10,
  nhfEnabled: false,
  nhfPercent: 2.5,
  nhisEnabled: false,
  nhisPercent: 5,
  nsitfEnabled: false,
  nsitfPercent: 1,
  itfEnabled: false,
  itfPercent: 1,
};

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
    private readonly queue: QueueService,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── settings ───────────────────────────

  async getSettings() {
    const existing = await this.db.payrollSettings.findFirst({ where: { companyId: this.ctx.companyId } });
    return existing ?? { ...DEFAULT_SETTINGS, companyId: this.ctx.companyId };
  }

  async updateSettings(input: PayrollSettingsInput) {
    const settings = await this.db.payrollSettings.upsert({
      where: { companyId: this.ctx.companyId },
      create: { companyId: this.ctx.companyId, ...input },
      update: { ...input },
    });
    await this.audit.log('payroll.settings_updated', { entity: 'PayrollSettings', entityId: settings.id });
    return settings;
  }

  private async computeSettings(): Promise<PayrollComputeSettings> {
    // Prisma Decimal columns flow straight into the Decimal engine — no
    // float conversion anywhere on the money path.
    const s = await this.getSettings();
    return toComputeSettings(s);
  }

  /**
   * Tax-rule validation status for a payroll period. Finalization (finance
   * approval / mark-paid) is blocked until an authorized approver has
   * attested the engine version that governs the run's period.
   */
  async taxStatus(year?: number, month?: number) {
    const now = new Date();
    const y = year ?? now.getUTCFullYear();
    const m = month ?? now.getUTCMonth() + 1;
    const regime: TaxRegimeId = regimeForPeriod(y, m);
    const requiredVersion = ENGINE_VERSION[regime];
    const s = await this.db.payrollSettings.findFirst({
      where: { companyId: this.ctx.companyId },
      select: { taxRulesApprovedVersion: true, taxRulesApprovedAt: true, taxRulesApprovedById: true },
    });
    return {
      regime,
      requiredVersion,
      approvedVersion: s?.taxRulesApprovedVersion ?? null,
      approvedAt: s?.taxRulesApprovedAt ?? null,
      approved: s?.taxRulesApprovedVersion === requiredVersion,
    };
  }

  /** Record a human attestation that the given engine version was reviewed. */
  async approveTaxRules(version: string) {
    const known = Object.values(ENGINE_VERSION);
    if (!known.includes(version)) {
      throw new BadRequestException(`Unknown tax engine version. Expected one of: ${known.join(', ')}`);
    }
    const settings = await this.db.payrollSettings.upsert({
      where: { companyId: this.ctx.companyId },
      create: {
        companyId: this.ctx.companyId,
        ...DEFAULT_SETTINGS,
        taxRulesApprovedVersion: version,
        taxRulesApprovedById: this.ctx.userIdOrNull,
        taxRulesApprovedAt: new Date(),
      },
      update: {
        taxRulesApprovedVersion: version,
        taxRulesApprovedById: this.ctx.userIdOrNull,
        taxRulesApprovedAt: new Date(),
      },
    });
    await this.audit.log('payroll.tax_rules_approved', {
      entity: 'PayrollSettings',
      entityId: settings.id,
      meta: { version },
    });
    return this.taxStatus();
  }

  /** Throws unless the run's period has validated + approved tax rules. */
  private async assertTaxRulesApproved(run: { year: number; month: number; engineVersion: string | null }) {
    const regime = regimeForPeriod(run.year, run.month);
    const requiredVersion = ENGINE_VERSION[regime];
    if (run.engineVersion !== requiredVersion) {
      throw new BadRequestException({
        message:
          'This run was computed with an outdated tax engine. Reject it back to draft and recompute before finalizing.',
        code: 'TAX_ENGINE_STALE',
      });
    }
    const status = await this.taxStatus(run.year, run.month);
    if (!status.approved) {
      throw new BadRequestException({
        message: `Tax rules for this period (${requiredVersion}) have not been reviewed and approved. An authorized approver must approve them in payroll settings before payroll can be finalized.`,
        code: 'TAX_RULES_NOT_APPROVED',
      });
    }
  }

  // ─────────────────────────── runs ───────────────────────────

  async listRuns() {
    return this.db.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 50,
    });
  }

  async getRun(id: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id },
      include: { payslips: { orderBy: { employeeName: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async createRun(input: PayrollRunCreateInput) {
    const duplicate = await this.db.payrollRun.findFirst({
      where: { year: input.year, month: input.month },
    });
    if (duplicate) throw new ConflictException(`A run for ${MONTH_NAMES[input.month - 1]} ${input.year} already exists`);

    const run = await this.db.payrollRun.create({
      data: {
        companyId: this.ctx.companyId,
        year: input.year,
        month: input.month,
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('payroll.run_created', {
      entity: 'PayrollRun',
      entityId: run.id,
      meta: { year: input.year, month: input.month },
    });
    return this.compute(run.id);
  }

  /** (Re)build all payslips for a DRAFT run from current data. */
  async compute(runId: string) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') throw new BadRequestException('Only draft runs can be recomputed');

    const settings = await this.computeSettings();
    const regime = regimeForPeriod(run.year, run.month);
    const engineVersion = ENGINE_VERSION[regime];
    const periodEnd = new Date(Date.UTC(run.year, run.month, 0)); // last day of month

    const employees = await this.db.employee.findMany({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE'] }, hireDate: { lte: periodEnd } },
      select: {
        id: true,
        employeeNo: true,
        firstName: true,
        lastName: true,
        bankName: true,
        bankAccountNumber: true,
        annualRentDeclared: true,
        compensations: {
          where: { effectiveDate: { lte: periodEnd } },
          orderBy: { effectiveDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { employeeNo: 'asc' },
    });

    const skipped: { employeeNo: string; name: string; reason: string }[] = [];
    const slips: Array<{
      employeeId: string;
      employeeName: string;
      employeeNo: string;
      bankName: string | null;
      bankAccountNumber: string | null;
      computed: ReturnType<typeof computePayslip>;
    }> = [];

    for (const emp of employees) {
      const comp = emp.compensations[0];
      const name = `${emp.firstName} ${emp.lastName}`;
      if (!comp) {
        skipped.push({ employeeNo: emp.employeeNo, name, reason: 'No compensation record' });
        continue;
      }
      // comp.baseSalary is a Prisma Decimal and stays Decimal end-to-end.
      const grossMonthly = toMonthlyGross(comp.baseSalary, comp.payFrequency);
      slips.push({
        employeeId: emp.id,
        employeeName: name,
        employeeNo: emp.employeeNo,
        bankName: emp.bankName,
        bankAccountNumber: emp.bankAccountNumber,
        computed: computePayslip(
          { grossMonthly, annualRentDeclared: emp.annualRentDeclared },
          settings,
          regime,
        ),
      });
    }

    // Totals summed with Decimal — no float error can accumulate across
    // hundreds of payslips.
    const Z = new Prisma.Decimal(0);
    const totals = slips.reduce(
      (acc, s) => ({
        totalGross: acc.totalGross.add(s.computed.grossMonthly),
        totalPaye: acc.totalPaye.add(s.computed.paye),
        totalPensionEmployee: acc.totalPensionEmployee.add(s.computed.pensionEmployee),
        totalPensionEmployer: acc.totalPensionEmployer.add(s.computed.pensionEmployer),
        totalNhf: acc.totalNhf.add(s.computed.nhf),
        totalNhis: acc.totalNhis.add(s.computed.nhis),
        totalRentRelief: acc.totalRentRelief.add(s.computed.rentRelief),
        totalNsitf: acc.totalNsitf.add(s.computed.nsitf),
        totalItf: acc.totalItf.add(s.computed.itf),
        totalNet: acc.totalNet.add(s.computed.netPay),
      }),
      {
        totalGross: Z,
        totalPaye: Z,
        totalPensionEmployee: Z,
        totalPensionEmployer: Z,
        totalNhf: Z,
        totalNhis: Z,
        totalRentRelief: Z,
        totalNsitf: Z,
        totalItf: Z,
        totalNet: Z,
      },
    );

    // Interactive transactions must run on the raw client (the tenant
    // extension wraps each operation in its own RLS transaction, which cannot
    // nest). Tenant scoping here is explicit: set_config activates the RLS
    // policies and every statement filters by companyId.
    const companyId = this.ctx.companyId;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      // Status-conditioned update doubles as a row lock: a concurrent
      // submit/approve flips the status first and this recompute aborts.
      const locked = await tx.payrollRun.updateMany({
        where: { id: runId, companyId, status: 'DRAFT' },
        data: {
          taxRegime: regime,
          engineVersion,
          totalGross: totals.totalGross,
          totalPaye: totals.totalPaye,
          totalPensionEmployee: totals.totalPensionEmployee,
          totalPensionEmployer: totals.totalPensionEmployer,
          totalNhf: totals.totalNhf,
          totalNhis: totals.totalNhis,
          totalRentRelief: totals.totalRentRelief,
          totalNsitf: totals.totalNsitf,
          totalItf: totals.totalItf,
          totalNet: totals.totalNet,
        },
      });
      if (locked.count === 0) throw new BadRequestException('Only draft runs can be recomputed');
      await tx.payslip.deleteMany({ where: { runId, companyId } });
      if (slips.length > 0) {
        await tx.payslip.createMany({
          data: slips.map((s) => ({
            companyId,
            runId,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            employeeNo: s.employeeNo,
            bankName: s.bankName,
            bankAccountNumber: s.bankAccountNumber,
            grossMonthly: s.computed.grossMonthly,
            basic: s.computed.basic,
            housing: s.computed.housing,
            transport: s.computed.transport,
            pensionEmployee: s.computed.pensionEmployee,
            pensionEmployer: s.computed.pensionEmployer,
            nhf: s.computed.nhf,
            nhis: s.computed.nhis,
            cra: s.computed.cra,
            rentRelief: s.computed.rentRelief,
            taxableIncome: s.computed.taxableIncome,
            paye: s.computed.paye,
            netPay: s.computed.netPay,
            nsitf: s.computed.nsitf,
            itf: s.computed.itf,
            taxRegime: regime,
          })),
        });
      }
    });

    await this.audit.log('payroll.run_computed', {
      entity: 'PayrollRun',
      entityId: runId,
      meta: { payslips: slips.length, skipped: skipped.length },
    });
    const result = await this.getRun(runId);
    return { ...result, skipped };
  }

  /**
   * Atomic state transition: the status precondition lives inside the UPDATE
   * itself, so two concurrent approvals (or approve-vs-reject) cannot both
   * succeed — the loser matches zero rows and gets a 400/404.
   */
  private async transition(
    id: string,
    from: Array<'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID'>,
    data: Record<string, unknown>,
    action: string,
  ) {
    const result = await this.db.payrollRun.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (result.count === 0) {
      const run = await this.db.payrollRun.findFirst({ where: { id }, select: { status: true } });
      if (!run) throw new NotFoundException('Payroll run not found');
      throw new BadRequestException(`Run is ${run.status}; expected ${from.join(' or ')}`);
    }
    const updated = await this.db.payrollRun.findFirstOrThrow({ where: { id } });
    await this.audit.log(action, {
      entity: 'PayrollRun',
      entityId: id,
      meta: { year: updated.year, month: updated.month },
    });
    return updated;
  }

  async submit(id: string) {
    return this.transition(id, ['DRAFT'], { status: 'PENDING_APPROVAL', submittedAt: new Date() }, 'payroll.run_submitted');
  }

  async approve(id: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id },
      select: { year: true, month: true, engineVersion: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    await this.assertTaxRulesApproved(run);
    return this.transition(
      id,
      ['PENDING_APPROVAL'],
      { status: 'APPROVED', approvedById: this.ctx.userIdOrNull, approvedAt: new Date() },
      'payroll.run_approved',
    );
  }

  async reject(id: string, note: string) {
    return this.transition(
      id,
      ['PENDING_APPROVAL'],
      { status: 'DRAFT', note, submittedAt: null },
      'payroll.run_rejected',
    );
  }

  async markPaid(id: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id },
      select: { year: true, month: true, engineVersion: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    await this.assertTaxRulesApproved(run);
    const updated = await this.transition(id, ['APPROVED'], { status: 'PAID', paidAt: new Date() }, 'payroll.run_paid');

    // Notify employees that their payslip is available.
    const payslips = await this.db.payslip.findMany({
      where: { runId: id },
      select: { employeeId: true, netPay: true, employee: { select: { workEmail: true, firstName: true } } },
    });
    const period = `${MONTH_NAMES[updated.month - 1]} ${updated.year}`;
    for (const slip of payslips) {
      if (!slip.employee?.workEmail) continue;
      await this.queue.sendEmail({
        to: slip.employee.workEmail,
        subject: `Your ${period} payslip is ready`,
        text: `Hi ${slip.employee.firstName},\n\nYour salary for ${period} has been paid and your payslip is now available in KHR under Payroll > My payslips.\n\n— KHR`,
        html: renderEmail({
          heading: `Your ${period} payslip is ready`,
          bodyLines: [
            `Hi ${slip.employee.firstName},`,
            `Your salary for ${period} has been paid and your payslip is now available under Payroll > My payslips.`,
          ],
          button: { label: 'View payslip', url: `${config.webBaseUrl}/payroll` },
        }),
        companyId: this.ctx.companyId,
      });
    }
    return updated;
  }

  // ─────────────────────────── payslips & exports ───────────────────────────

  async myPayslips() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) return [];
    return this.db.payslip.findMany({
      where: { employeeId, run: { status: 'PAID' } },
      include: { run: { select: { year: true, month: true, paidAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 36,
    });
  }

  async bankScheduleCsv(id: string): Promise<{ csv: string; filename: string }> {
    const run = await this.getRun(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') {
      throw new BadRequestException('Bank schedule is only available for approved or paid runs');
    }
    const period = `${run.year}-${String(run.month).padStart(2, '0')}`;
    const csv = stringify(
      run.payslips.map((p) => ({
        employeeNo: csvSafe(p.employeeNo),
        name: csvSafe(p.employeeName),
        bank: csvSafe(p.bankName),
        accountNumber: csvSafe(p.bankAccountNumber),
        amount: Number(p.netPay).toFixed(2),
        narration: `Salary ${period}`,
      })),
      { header: true },
    );
    await this.audit.log('payroll.bank_schedule_exported', { entity: 'PayrollRun', entityId: id });
    return { csv, filename: `bank-schedule-${period}.csv` };
  }
}
