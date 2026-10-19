import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { Prisma } from '@peopleflow/database';
import type { PayrollRunCreateInput, PayrollSettingsInput, PayslipAdjustInput } from '@peopleflow/types';
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
import { renderPayslipPdf, type PayslipPdfLine } from './payslip-pdf';

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

    // One-off adjustments (bonus / deductions) set on the current draft slips
    // survive a recompute: carry them over keyed by employee.
    const priorSlips = await this.db.payslip.findMany({
      where: { runId },
      select: { employeeId: true, bonus: true, otherDeductions: true, adjustmentNote: true },
    });
    const adjustments = new Map(priorSlips.map((p) => [p.employeeId, p]));

    const skipped: { employeeNo: string; name: string; reason: string }[] = [];
    const slips: Array<{
      employeeId: string;
      employeeName: string;
      employeeNo: string;
      bankName: string | null;
      bankAccountNumber: string | null;
      adjustmentNote: string | null;
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
      const adj = adjustments.get(emp.id);
      slips.push({
        employeeId: emp.id,
        employeeName: name,
        employeeNo: emp.employeeNo,
        bankName: emp.bankName,
        bankAccountNumber: emp.bankAccountNumber,
        adjustmentNote: adj?.adjustmentNote ?? null,
        computed: computePayslip(
          {
            grossMonthly,
            annualRentDeclared: emp.annualRentDeclared,
            bonus: adj?.bonus,
            otherDeductions: adj?.otherDeductions,
          },
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
        totalBonus: acc.totalBonus.add(s.computed.bonus),
        totalOtherDeductions: acc.totalOtherDeductions.add(s.computed.otherDeductions),
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
        totalBonus: Z,
        totalOtherDeductions: Z,
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
          totalBonus: totals.totalBonus,
          totalOtherDeductions: totals.totalOtherDeductions,
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
            bonus: s.computed.bonus,
            otherDeductions: s.computed.otherDeductions,
            adjustmentNote: s.adjustmentNote,
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
    extraMeta: Record<string, unknown> = {},
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
      meta: { year: updated.year, month: updated.month, ...extraMeta },
    });
    return updated;
  }

  /**
   * Segregation of duties (maker–checker): whoever prepared or submitted a
   * run must not be the one to approve it. Enforced against user ids, not
   * roles, so a COMPANY_ADMIN holding both payroll permissions still cannot
   * finalize their own run.
   */
  private assertSeparationOfDuties(run: { createdById: string | null; submittedById: string | null }) {
    const approverId = this.ctx.userIdOrNull;
    if (approverId && (approverId === run.createdById || approverId === run.submittedById)) {
      throw new ForbiddenException({
        message:
          'Segregation of duties: the user who prepared or submitted a payroll run cannot approve it. Another member with payroll approval permission must review it.',
        code: 'PAYROLL_SOD_VIOLATION',
      });
    }
  }

  /**
   * Reconciliation gate: before money moves, re-derive every total from the
   * stored payslips and require an exact Decimal match with the figures
   * stamped on the run at compute time. Any drift (manual tampering, partial
   * writes, code regressions) blocks approval.
   */
  private async assertRunReconciles(id: string, run: Record<string, unknown>) {
    const agg = await this.db.payslip.aggregate({
      where: { runId: id },
      _count: true,
      _sum: {
        grossMonthly: true,
        bonus: true,
        otherDeductions: true,
        paye: true,
        pensionEmployee: true,
        pensionEmployer: true,
        nhf: true,
        nhis: true,
        rentRelief: true,
        nsitf: true,
        itf: true,
        netPay: true,
      },
    });
    if (agg._count === 0) {
      throw new BadRequestException({
        message: 'This run has no payslips. Add compensation records and recompute before approval.',
        code: 'EMPTY_RUN',
      });
    }
    const Z = new Prisma.Decimal(0);
    const pairs: Array<[string, keyof typeof agg._sum]> = [
      ['totalGross', 'grossMonthly'],
      ['totalBonus', 'bonus'],
      ['totalOtherDeductions', 'otherDeductions'],
      ['totalPaye', 'paye'],
      ['totalPensionEmployee', 'pensionEmployee'],
      ['totalPensionEmployer', 'pensionEmployer'],
      ['totalNhf', 'nhf'],
      ['totalNhis', 'nhis'],
      ['totalRentRelief', 'rentRelief'],
      ['totalNsitf', 'nsitf'],
      ['totalItf', 'itf'],
      ['totalNet', 'netPay'],
    ];
    const mismatches = pairs
      .filter(([runField, slipField]) => !(run[runField] as Prisma.Decimal).equals(agg._sum[slipField] ?? Z))
      .map(([runField]) => runField);
    if (mismatches.length > 0) {
      throw new ConflictException({
        message: `Run totals do not reconcile with the payslips (${mismatches.join(', ')}). Reject the run back to draft and recompute it.`,
        code: 'RECONCILIATION_MISMATCH',
      });
    }
    return { payslips: agg._count as number };
  }

  async submit(id: string) {
    return this.transition(
      id,
      ['DRAFT'],
      { status: 'PENDING_APPROVAL', submittedById: this.ctx.userIdOrNull, submittedAt: new Date() },
      'payroll.run_submitted',
    );
  }

  async approve(id: string) {
    const run = await this.db.payrollRun.findFirst({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    this.assertSeparationOfDuties(run);
    await this.assertTaxRulesApproved(run);
    const { payslips } = await this.assertRunReconciles(id, run as unknown as Record<string, unknown>);
    return this.transition(
      id,
      ['PENDING_APPROVAL'],
      { status: 'APPROVED', approvedById: this.ctx.userIdOrNull, approvedAt: new Date() },
      'payroll.run_approved',
      { payslips, totalNet: run.totalNet.toFixed(2), reconciled: true },
    );
  }

  async reject(id: string, note: string) {
    return this.transition(
      id,
      ['PENDING_APPROVAL'],
      { status: 'DRAFT', note, submittedById: null, submittedAt: null },
      'payroll.run_rejected',
      { note },
    );
  }

  async markPaid(id: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id },
      select: { year: true, month: true, engineVersion: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    await this.assertTaxRulesApproved(run);
    const updated = await this.transition(
      id,
      ['APPROVED'],
      { status: 'PAID', paidById: this.ctx.userIdOrNull, paidAt: new Date() },
      'payroll.run_paid',
    );

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

  /**
   * Set one-off bonus / other-deduction amounts on a payslip while its run is
   * still DRAFT, then recompute the whole run so PAYE, net pay and run totals
   * all reflect the adjustment (recompute carries adjustments over).
   */
  async adjustPayslip(runId: string, payslipId: string, input: PayslipAdjustInput) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId }, select: { status: true } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') {
      throw new BadRequestException('Adjustments can only be made while the run is a draft');
    }
    const slip = await this.db.payslip.findFirst({
      where: { id: payslipId, runId },
      select: { id: true, employeeName: true },
    });
    if (!slip) throw new NotFoundException('Payslip not found');

    await this.db.payslip.update({
      where: { id: payslipId },
      data: {
        bonus: new Prisma.Decimal(input.bonus),
        otherDeductions: new Prisma.Decimal(input.otherDeductions),
        adjustmentNote: input.adjustmentNote?.trim() || null,
      },
    });
    await this.audit.log('payroll.payslip_adjusted', {
      entity: 'Payslip',
      entityId: payslipId,
      meta: {
        employee: slip.employeeName,
        bonus: input.bonus.toFixed(2),
        otherDeductions: input.otherDeductions.toFixed(2),
      },
    });
    return this.compute(runId);
  }

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

  /**
   * Itemized PDF payslip with a cumulative year-to-date column for every
   * line item (earnings, bonus, each deduction, employer contributions, net).
   * Employees can download their own slips from PAID runs; payroll managers
   * can download any slip (unpaid runs are watermarked as previews).
   */
  async payslipPdf(payslipId: string): Promise<{ pdf: Buffer; filename: string }> {
    const slip = await this.db.payslip.findFirst({
      where: { id: payslipId },
      include: { run: { select: { year: true, month: true, status: true, paidAt: true } } },
    });
    if (!slip) throw new NotFoundException('Payslip not found');

    const isManager = this.ctx.can('payroll.manage');
    const isOwn = this.ctx.employeeIdOrNull === slip.employeeId;
    if (!isManager && (!isOwn || slip.run.status !== 'PAID')) {
      throw new NotFoundException('Payslip not found');
    }

    // YTD = all PAID months of the same year up to this slip's month, plus
    // this slip itself (so manager previews of unpaid runs include the
    // current period). Decimal sums happen in the database.
    const ytdAgg = await this.db.payslip.aggregate({
      where: {
        employeeId: slip.employeeId,
        run: { year: slip.run.year, month: { lte: slip.run.month } },
        OR: [{ run: { status: 'PAID' } }, { id: payslipId }],
      },
      _sum: {
        grossMonthly: true,
        basic: true,
        housing: true,
        transport: true,
        bonus: true,
        paye: true,
        pensionEmployee: true,
        nhf: true,
        nhis: true,
        otherDeductions: true,
        pensionEmployer: true,
        nsitf: true,
        itf: true,
        netPay: true,
      },
    });
    const Z = new Prisma.Decimal(0);
    const sum = ytdAgg._sum;
    const n = (d: Prisma.Decimal | null | undefined) => Number(d ?? Z);

    // "Other allowances" is the gross remainder when basic+housing+transport
    // percentages sum below 100 — derived in Decimal to avoid float noise.
    const otherAllowCurrent = slip.grossMonthly.sub(slip.basic).sub(slip.housing).sub(slip.transport);
    const otherAllowYtd = (sum.grossMonthly ?? Z)
      .sub(sum.basic ?? Z)
      .sub(sum.housing ?? Z)
      .sub(sum.transport ?? Z);

    const company = await this.prisma.company.findUnique({
      where: { id: this.ctx.companyId },
      select: { name: true, rcNumber: true },
    });

    const keep = new Set(['Basic salary', 'Housing allowance', 'Transport allowance', 'PAYE tax']);
    const nonZero = (lines: PayslipPdfLine[]) =>
      lines.filter((l) => keep.has(l.label) || l.current !== 0 || l.ytd !== 0);

    const period = `${MONTH_NAMES[slip.run.month - 1]} ${slip.run.year}`;
    const pdf = await renderPayslipPdf({
      companyName: company?.name ?? 'KHR',
      rcNumber: company?.rcNumber ?? null,
      period,
      status: slip.run.status,
      paidAt: slip.run.paidAt,
      employeeName: slip.employeeName,
      employeeNo: slip.employeeNo,
      bankName: slip.bankName,
      bankAccountNumber: slip.bankAccountNumber,
      taxRegime: slip.taxRegime,
      adjustmentNote: slip.adjustmentNote,
      currency: slip.currency,
      earnings: nonZero([
        { label: 'Basic salary', current: Number(slip.basic), ytd: n(sum.basic) },
        { label: 'Housing allowance', current: Number(slip.housing), ytd: n(sum.housing) },
        { label: 'Transport allowance', current: Number(slip.transport), ytd: n(sum.transport) },
        { label: 'Other allowances', current: Number(otherAllowCurrent), ytd: Number(otherAllowYtd) },
        { label: 'Bonus', current: Number(slip.bonus), ytd: n(sum.bonus) },
      ]),
      deductions: nonZero([
        { label: 'PAYE tax', current: Number(slip.paye), ytd: n(sum.paye) },
        { label: 'Pension (employee)', current: Number(slip.pensionEmployee), ytd: n(sum.pensionEmployee) },
        { label: 'NHF', current: Number(slip.nhf), ytd: n(sum.nhf) },
        { label: 'NHIS', current: Number(slip.nhis), ytd: n(sum.nhis) },
        { label: 'Other deductions', current: Number(slip.otherDeductions), ytd: n(sum.otherDeductions) },
      ]),
      employerContributions: nonZero([
        { label: 'Pension (employer)', current: Number(slip.pensionEmployer), ytd: n(sum.pensionEmployer) },
        { label: 'NSITF', current: Number(slip.nsitf), ytd: n(sum.nsitf) },
        { label: 'ITF', current: Number(slip.itf), ytd: n(sum.itf) },
      ]),
      net: { label: 'NET PAY', current: Number(slip.netPay), ytd: n(sum.netPay) },
    });

    await this.audit.log('payroll.payslip_pdf_exported', {
      entity: 'Payslip',
      entityId: payslipId,
      meta: { employee: slip.employeeName, period },
    });
    const ym = `${slip.run.year}-${String(slip.run.month).padStart(2, '0')}`;
    const safeNo = slip.employeeNo.replace(/[^A-Za-z0-9-]+/g, '-');
    return { pdf, filename: `payslip-${ym}-${safeNo}.pdf` };
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
