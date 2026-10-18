import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import type { PayrollRunCreateInput, PayrollSettingsInput } from '@peopleflow/types';
import { csvSafe } from '../common/csv';
import { config } from '../config';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { renderEmail } from '../infra/email-template';
import { PrismaService } from '../infra/prisma.service';
import { QueueService } from '../infra/queue.service';
import { computePayslip, toMonthlyGross, type PayrollComputeSettings } from './nigeria-tax';

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
    const s = await this.getSettings();
    return {
      basicPercent: Number(s.basicPercent),
      housingPercent: Number(s.housingPercent),
      transportPercent: Number(s.transportPercent),
      pensionEnabled: s.pensionEnabled,
      pensionEmployeePercent: Number(s.pensionEmployeePercent),
      pensionEmployerPercent: Number(s.pensionEmployerPercent),
      nhfEnabled: s.nhfEnabled,
      nhfPercent: Number(s.nhfPercent),
    };
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
      const grossMonthly = toMonthlyGross(Number(comp.baseSalary), comp.payFrequency);
      slips.push({
        employeeId: emp.id,
        employeeName: name,
        employeeNo: emp.employeeNo,
        bankName: emp.bankName,
        bankAccountNumber: emp.bankAccountNumber,
        computed: computePayslip(grossMonthly, settings),
      });
    }

    // Totals are summed in integer kobo so float error cannot accumulate
    // across hundreds of payslips; converted back to naira strings at the end.
    const kobo = (n: number) => Math.round(n * 100);
    const naira = (k: number) => (k / 100).toFixed(2);
    const totals = slips.reduce(
      (acc, s) => {
        acc.totalGross += kobo(s.computed.grossMonthly);
        acc.totalPaye += kobo(s.computed.paye);
        acc.totalPensionEmployee += kobo(s.computed.pensionEmployee);
        acc.totalPensionEmployer += kobo(s.computed.pensionEmployer);
        acc.totalNhf += kobo(s.computed.nhf);
        acc.totalNet += kobo(s.computed.netPay);
        return acc;
      },
      { totalGross: 0, totalPaye: 0, totalPensionEmployee: 0, totalPensionEmployer: 0, totalNhf: 0, totalNet: 0 },
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
          totalGross: naira(totals.totalGross),
          totalPaye: naira(totals.totalPaye),
          totalPensionEmployee: naira(totals.totalPensionEmployee),
          totalPensionEmployer: naira(totals.totalPensionEmployer),
          totalNhf: naira(totals.totalNhf),
          totalNet: naira(totals.totalNet),
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
            cra: s.computed.cra,
            taxableIncome: s.computed.taxableIncome,
            paye: s.computed.paye,
            netPay: s.computed.netPay,
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
