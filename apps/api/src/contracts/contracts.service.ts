import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_CONTRACT_CLAUSES,
  DEFAULT_CONTRACT_TITLE,
  type ContractClause,
  type ContractTemplateUpdateInput,
  type ContractUpdateInput,
} from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { renderContractPdf } from './contract-pdf';
import { nairaWords } from './naira-words';

const FREQUENCY_WORDS: Record<string, string> = {
  MONTHLY: 'per month',
  BIWEEKLY: 'per fortnight',
  WEEKLY: 'per week',
  ANNUAL: 'per annum',
};

function longDate(d: Date): string {
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const s = parts.filter(Boolean).join(', ');
  return s || null;
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ── Company template ───────────────────────────────────────────────────

  async getTemplate() {
    const row = await this.db.contractTemplate.findUnique({
      where: { companyId: this.ctx.companyId },
    });
    if (!row) {
      return { title: DEFAULT_CONTRACT_TITLE, clauses: DEFAULT_CONTRACT_CLAUSES, isDefault: true };
    }
    return { title: row.title, clauses: row.clauses as unknown as ContractClause[], isDefault: false };
  }

  async updateTemplate(input: ContractTemplateUpdateInput) {
    const companyId = this.ctx.companyId;
    await this.db.contractTemplate.upsert({
      where: { companyId },
      create: { companyId, title: input.title, clauses: input.clauses, updatedById: this.ctx.userIdOrNull },
      update: { title: input.title, clauses: input.clauses, updatedById: this.ctx.userIdOrNull },
    });
    await this.audit.log('contract.template_updated', {
      entity: 'ContractTemplate',
      entityId: companyId,
      meta: { clauseCount: input.clauses.length },
    });
    return this.getTemplate();
  }

  // ── Per-employee contracts ─────────────────────────────────────────────

  /** `document.manage` sees any contract; an employee sees only their own. */
  private assertCanRead(employeeId: string) {
    if (this.ctx.can('document.manage')) return;
    if (this.ctx.employeeIdOrNull !== employeeId)
      throw new ForbiddenException('You can only view your own contract');
  }

  async getForEmployee(employeeId: string) {
    this.assertCanRead(employeeId);
    const contract = await this.db.employmentContract.findUnique({
      where: { employeeId },
    });
    if (!contract) throw new NotFoundException('No contract has been generated for this employee');
    return contract;
  }

  /** Generates a contract from the company template with placeholders resolved. */
  async createForEmployee(employeeId: string) {
    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { location: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const existing = await this.db.employmentContract.findUnique({ where: { employeeId } });
    if (existing)
      throw new ConflictException('A contract already exists for this employee — edit or delete it first');

    const [company, compensation, fallbackLocation, template] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: this.ctx.companyId },
        select: { name: true, rcNumber: true },
      }),
      this.db.compensation.findFirst({
        where: { employeeId },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      }),
      employee.location ? Promise.resolve(null) : this.db.location.findFirst({ orderBy: { createdAt: 'asc' } }),
      this.getTemplate(),
    ]);

    const loc = employee.location ?? fallbackLocation;
    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const values: Record<string, string> = {
      employeeName,
      employeeNo: employee.employeeNo,
      employeeAddress:
        joinAddress([employee.addressLine1, employee.city, employee.state, employee.country]) ?? '—',
      jobTitle: employee.jobTitle,
      startDate: longDate(employee.hireDate),
      salaryFigure: compensation
        ? `\u20a6${Number(compensation.baseSalary).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : '—',
      salaryWords: compensation ? nairaWords(compensation.baseSalary.toFixed(2)) : '—',
      salaryFrequency: compensation ? (FREQUENCY_WORDS[compensation.payFrequency] ?? '') : '',
      companyName: company.name,
      rcNumber: company.rcNumber ?? '—',
      companyAddress: joinAddress([loc?.addressLine1, loc?.city, loc?.state]) ?? '—',
      date: longDate(new Date()),
    };
    // Known tokens are replaced; unknown ones stay visible so typos surface
    // in the editable draft instead of silently vanishing.
    const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);

    const contract = await this.db.employmentContract.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        title: template.title,
        roleTitle: employee.jobTitle,
        clauses: template.clauses.map((c) => ({ heading: resolve(c.heading), body: resolve(c.body) })),
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('contract.created', {
      entity: 'EmploymentContract',
      entityId: contract.id,
      meta: { employeeId, employeeName },
    });
    return contract;
  }

  async update(id: string, input: ContractUpdateInput) {
    const existing = await this.db.employmentContract.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Contract not found');
    const contract = await this.db.employmentContract.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.roleTitle !== undefined ? { roleTitle: input.roleTitle } : {}),
        ...(input.clauses !== undefined ? { clauses: input.clauses } : {}),
      },
    });
    await this.audit.log('contract.updated', {
      entity: 'EmploymentContract',
      entityId: id,
      meta: { employeeId: existing.employeeId },
    });
    return contract;
  }

  async remove(id: string) {
    const existing = await this.db.employmentContract.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Contract not found');
    await this.db.employmentContract.delete({ where: { id } });
    await this.audit.log('contract.deleted', {
      entity: 'EmploymentContract',
      entityId: id,
      meta: { employeeId: existing.employeeId },
    });
    return { ok: true };
  }

  async pdf(id: string) {
    const contract = await this.db.employmentContract.findFirst({
      where: { id },
      include: { employee: { include: { location: true } } },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    this.assertCanRead(contract.employeeId);

    const [company, fallbackLocation] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: this.ctx.companyId },
        select: { name: true, rcNumber: true },
      }),
      contract.employee.location
        ? Promise.resolve(null)
        : this.db.location.findFirst({ orderBy: { createdAt: 'asc' } }),
    ]);
    const loc = contract.employee.location ?? fallbackLocation;
    const employeeName = `${contract.employee.firstName} ${contract.employee.lastName}`;

    const buffer = await renderContractPdf({
      companyName: company.name,
      rcNumber: company.rcNumber,
      companyAddress: joinAddress([loc?.addressLine1, loc?.city, loc?.state]),
      title: contract.title,
      roleTitle: contract.roleTitle,
      employeeName,
      employeeNo: contract.employee.employeeNo,
      employeeAddress: joinAddress([
        contract.employee.addressLine1,
        contract.employee.city,
        contract.employee.state,
        contract.employee.country,
      ]),
      startDate: longDate(contract.employee.hireDate),
      clauses: contract.clauses as unknown as ContractClause[],
    });
    await this.audit.log('contract.downloaded', { entity: 'EmploymentContract', entityId: id });
    return { buffer, filename: `contract-${contract.employee.employeeNo}.pdf` };
  }
}
