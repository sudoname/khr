import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import type {
  EmployeeCreateInput,
  EmployeeUpdateInput,
} from '@peopleflow/types';
import { csvSafe } from '../common/csv';
import { sniffImageMime } from '../common/image-sniff';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { createsReportingCycle } from '../org/org-cycle';

/** Fields anyone with `employee.read` may see (the directory view). */
const DIRECTORY_SELECT = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  workEmail: true,
  jobTitle: true,
  status: true,
  photoUrl: true,
  managerId: true,
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} as const;

const FULL_INCLUDE = {
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true, jobTitle: true, employeeNo: true } },
  emergencyContacts: { select: { id: true, name: true, relationship: true, phone: true, email: true } },
} as const;

interface ListQuery {
  q?: string;
  departmentId?: string;
  locationId?: string;
  status?: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
  page: number;
  pageSize: number;
}

const importRowSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  workEmail: z.string().trim().toLowerCase().email(),
  jobTitle: z.string().trim().min(1),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  middleName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY']).optional(),
  department: z.string().trim().optional(),
  location: z.string().trim().optional(),
  managerEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
});

/** '' → null, undefined stays undefined. */
function opt(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

function toDate(value: string | undefined): Date | null | undefined {
  const v = opt(value);
  if (v === undefined) return undefined;
  return v === null ? null : new Date(`${v}T00:00:00.000Z`);
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── directory & profile ───────────────────────────

  async list(query: ListQuery) {
    const where = {
      deletedAt: null,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
              { preferredName: { contains: query.q, mode: 'insensitive' as const } },
              { workEmail: { contains: query.q, mode: 'insensitive' as const } },
              { employeeNo: { contains: query.q, mode: 'insensitive' as const } },
              { jobTitle: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.employee.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.employee.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** True when the current actor's employee record is an ancestor in `employeeId`'s reporting chain. */
  private async managesEmployee(employeeId: string): Promise<boolean> {
    const selfId = this.ctx.employeeIdOrNull;
    if (!selfId) return false;
    let cursor: string | null = employeeId;
    for (let depth = 0; depth < 50; depth++) {
      const row: { managerId: string | null } | null = await this.db.employee.findFirst({
        where: { id: cursor as string },
        select: { managerId: true },
      });
      cursor = row?.managerId ?? null;
      if (!cursor) return false;
      if (cursor === selfId) return true;
    }
    return false;
  }

  private async canSeeFullProfile(employeeId: string): Promise<boolean> {
    if (this.ctx.can('employee.write')) return true;
    if (this.ctx.employeeIdOrNull === employeeId) return true;
    if (this.ctx.can('employee.read.team') && (await this.managesEmployee(employeeId))) return true;
    return false;
  }

  /**
   * BVN, bank details and the rent-relief declaration are field-level
   * restricted like salary: only the employee themself and holders of
   * `compensation.read` may see them.
   */
  private stripBankDetails<
    T extends {
      bvn: string | null;
      bankName: string | null;
      bankAccountNumber: string | null;
      annualRentDeclared: unknown;
    },
  >(employee: T, employeeId: string): T {
    if (this.ctx.employeeIdOrNull === employeeId || this.ctx.can('compensation.read')) return employee;
    return { ...employee, bvn: null, bankName: null, bankAccountNumber: null, annualRentDeclared: null };
  }

  async get(id: string) {
    const employee = await this.db.employee.findFirst({
      where: { id, deletedAt: null },
      include: FULL_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (await this.canSeeFullProfile(id)) return this.stripBankDetails(employee, id);
    // Directory-level projection for everyone else. Salary is NEVER here —
    // compensation lives behind its own endpoints and permission.
    return {
      id: employee.id,
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      lastName: employee.lastName,
      preferredName: employee.preferredName,
      workEmail: employee.workEmail,
      jobTitle: employee.jobTitle,
      status: employee.status,
      photoUrl: employee.photoUrl,
      managerId: employee.managerId,
      department: employee.department,
      location: employee.location,
      manager: employee.manager,
    };
  }

  async me() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: FULL_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee record not found');
    return employee;
  }

  async updateSelf(input: {
    preferredName?: string;
    personalEmail?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    emergencyContact?: { name: string; relationship?: string; phone: string; email?: string };
  }) {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    const employee = await this.db.employee.update({
      where: { id: employeeId },
      data: {
        ...(input.preferredName !== undefined ? { preferredName: opt(input.preferredName) } : {}),
        ...(input.personalEmail !== undefined ? { personalEmail: opt(input.personalEmail) } : {}),
        ...(input.phone !== undefined ? { phone: opt(input.phone) } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: opt(input.addressLine1) } : {}),
        ...(input.city !== undefined ? { city: opt(input.city) } : {}),
        ...(input.state !== undefined ? { state: opt(input.state) } : {}),
      },
    });
    if (input.emergencyContact) await this.replaceEmergencyContact(employeeId, input.emergencyContact);
    await this.audit.log('employee.self_updated', { entity: 'Employee', entityId: employeeId });
    return this.me().catch(() => employee);
  }

  // ─────────────────────────── profile photo ───────────────────────────

  async uploadAvatar(file: Express.Multer.File) {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    // Validate by magic bytes, not the client-supplied mimetype, and store the
    // sniffed type so the served Content-Type always matches the actual bytes.
    const mime = sniffImageMime(file.buffer);
    if (!mime) throw new BadRequestException('Profile photo must be a JPEG, PNG or WebP image');
    await this.db.employeeAvatar.upsert({
      where: { employeeId },
      create: { companyId: this.ctx.companyId, employeeId, mime, data: file.buffer },
      update: { mime, data: file.buffer },
    });
    // Cache-busting version so browsers pick up the new photo immediately.
    const photoUrl = `/api/employees/${employeeId}/avatar?v=${Date.now()}`;
    await this.db.employee.update({ where: { id: employeeId }, data: { photoUrl } });
    await this.audit.log('employee.avatar_updated', { entity: 'Employee', entityId: employeeId });
    return { photoUrl };
  }

  async removeAvatar() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    await this.db.employeeAvatar.deleteMany({ where: { employeeId } });
    await this.db.employee.update({ where: { id: employeeId }, data: { photoUrl: null } });
    await this.audit.log('employee.avatar_removed', { entity: 'Employee', entityId: employeeId });
    return { photoUrl: null };
  }

  /** Avatars are directory-level data: any authenticated member may view them. */
  async getAvatar(employeeId: string) {
    const avatar = await this.db.employeeAvatar.findFirst({ where: { employeeId } });
    if (!avatar) throw new NotFoundException('No profile photo');
    return avatar;
  }

  // ─────────────────────────── lifecycle ───────────────────────────

  private async validateReferences(input: { departmentId?: string | null; locationId?: string | null; managerId?: string | null }) {
    if (input.departmentId) {
      const dept = await this.db.department.findFirst({ where: { id: input.departmentId, deletedAt: null } });
      if (!dept) throw new BadRequestException('Unknown department');
    }
    if (input.locationId) {
      const loc = await this.db.location.findFirst({ where: { id: input.locationId, deletedAt: null } });
      if (!loc) throw new BadRequestException('Unknown location');
    }
    if (input.managerId) {
      const mgr = await this.db.employee.findFirst({
        where: { id: input.managerId, deletedAt: null, status: { not: 'TERMINATED' } },
      });
      if (!mgr) throw new BadRequestException('Unknown or inactive manager');
    }
  }

  /**
   * Allocates the next employee number via an atomic counter on Company, so
   * concurrent hires can never be handed the same number (the old count+1
   * approach raced). The unique constraint + retry in create() stays as a
   * final backstop.
   */
  private async nextEmployeeNo(): Promise<string> {
    const { employeeNoSeq } = await this.prisma.company.update({
      where: { id: this.ctx.companyId },
      data: { employeeNoSeq: { increment: 1 } },
      select: { employeeNoSeq: true },
    });
    return `EMP-${String(employeeNoSeq).padStart(4, '0')}`;
  }

  private async replaceEmergencyContact(
    employeeId: string,
    contact: { name: string; relationship?: string; phone: string; email?: string },
  ) {
    await this.db.emergencyContact.deleteMany({ where: { employeeId } });
    await this.db.emergencyContact.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        name: contact.name,
        relationship: contact.relationship || null,
        phone: contact.phone,
        email: opt(contact.email) ?? null,
      },
    });
  }

  async create(input: EmployeeCreateInput) {
    await this.validateReferences({
      departmentId: opt(input.departmentId) ?? null,
      locationId: opt(input.locationId) ?? null,
      managerId: opt(input.managerId) ?? null,
    });

    const duplicate = await this.db.employee.findFirst({
      where: { workEmail: input.workEmail, deletedAt: null },
    });
    if (duplicate) throw new ConflictException('An employee with this work email already exists');

    let employee: { id: string; employeeNo: string } | null = null;
    for (let attempt = 0; attempt < 5 && !employee; attempt++) {
      const employeeNo = await this.nextEmployeeNo();
      try {
        employee = await this.db.employee.create({
          data: {
            companyId: this.ctx.companyId,
            employeeNo,
            firstName: input.firstName,
            middleName: opt(input.middleName) ?? null,
            lastName: input.lastName,
            preferredName: opt(input.preferredName) ?? null,
            workEmail: input.workEmail,
            personalEmail: opt(input.personalEmail) ?? null,
            phone: opt(input.phone) ?? null,
            addressLine1: opt(input.addressLine1) ?? null,
            city: opt(input.city) ?? null,
            state: opt(input.state) ?? null,
            country: opt(input.country) ?? null,
            dateOfBirth: toDate(input.dateOfBirth) ?? null,
            bvn: opt(input.bvn) ?? null,
            bankName: opt(input.bankName) ?? null,
            bankAccountNumber: opt(input.bankAccountNumber) ?? null,
            employmentType: input.employmentType,
            hireDate: toDate(input.hireDate) as Date,
            probationEndsOn: toDate(input.probationEndsOn) ?? null,
            jobTitle: input.jobTitle,
            grade: opt(input.grade) ?? null,
            departmentId: opt(input.departmentId) ?? null,
            locationId: opt(input.locationId) ?? null,
            managerId: opt(input.managerId) ?? null,
          },
        });
      } catch (err: unknown) {
        // Retry only on employeeNo uniqueness races; re-throw everything else.
        const code = (err as { code?: string }).code;
        if (code !== 'P2002') throw err;
      }
    }
    if (!employee) throw new ConflictException('Could not allocate an employee number, please retry');

    if (input.emergencyContact) await this.replaceEmergencyContact(employee.id, input.emergencyContact);

    await this.db.employmentEvent.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId: employee.id,
        type: 'HIRE',
        effectiveDate: toDate(input.hireDate) as Date,
        details: { jobTitle: input.jobTitle },
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('employee.created', {
      entity: 'Employee',
      entityId: employee.id,
      meta: { employeeNo: employee.employeeNo, workEmail: input.workEmail },
    });
    return this.get(employee.id);
  }

  async update(id: string, input: EmployeeUpdateInput) {
    const existing = await this.db.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Employee not found');

    const departmentId = opt(input.departmentId);
    const locationId = opt(input.locationId);
    const managerId = opt(input.managerId);
    await this.validateReferences({
      departmentId: departmentId ?? null,
      locationId: locationId ?? null,
      managerId: managerId ?? null,
    });

    if (managerId !== undefined && managerId !== existing.managerId) {
      const cycle = await createsReportingCycle(id, managerId, async (cursor) => {
        const row = await this.db.employee.findFirst({ where: { id: cursor }, select: { managerId: true } });
        return row?.managerId ?? null;
      });
      if (cycle) throw new BadRequestException('This manager assignment would create a reporting cycle');
    }

    if (input.workEmail && input.workEmail !== existing.workEmail) {
      const duplicate = await this.db.employee.findFirst({
        where: { workEmail: input.workEmail, deletedAt: null, id: { not: id } },
      });
      if (duplicate) throw new ConflictException('An employee with this work email already exists');
    }

    const employee = await this.db.employee.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.middleName !== undefined ? { middleName: opt(input.middleName) } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.preferredName !== undefined ? { preferredName: opt(input.preferredName) } : {}),
        ...(input.workEmail !== undefined ? { workEmail: input.workEmail } : {}),
        ...(input.personalEmail !== undefined ? { personalEmail: opt(input.personalEmail) } : {}),
        ...(input.phone !== undefined ? { phone: opt(input.phone) } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: opt(input.addressLine1) } : {}),
        ...(input.city !== undefined ? { city: opt(input.city) } : {}),
        ...(input.state !== undefined ? { state: opt(input.state) } : {}),
        ...(input.country !== undefined ? { country: opt(input.country) } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: toDate(input.dateOfBirth) } : {}),
        ...(input.bvn !== undefined ? { bvn: opt(input.bvn) } : {}),
        ...(input.bankName !== undefined ? { bankName: opt(input.bankName) } : {}),
        ...(input.bankAccountNumber !== undefined ? { bankAccountNumber: opt(input.bankAccountNumber) } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
        ...(input.hireDate !== undefined ? { hireDate: toDate(input.hireDate) as Date } : {}),
        ...(input.probationEndsOn !== undefined ? { probationEndsOn: toDate(input.probationEndsOn) } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.grade !== undefined ? { grade: opt(input.grade) } : {}),
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        ...(managerId !== undefined ? { managerId } : {}),
      },
    });
    if (input.emergencyContact) await this.replaceEmergencyContact(id, input.emergencyContact);

    const today = new Date();
    const events: { type: 'TRANSFER' | 'MANAGER_CHANGE' | 'PROMOTION'; details: Record<string, unknown> }[] = [];
    if (departmentId !== undefined && departmentId !== existing.departmentId)
      events.push({ type: 'TRANSFER', details: { fromDepartmentId: existing.departmentId, toDepartmentId: departmentId } });
    if (managerId !== undefined && managerId !== existing.managerId)
      events.push({ type: 'MANAGER_CHANGE', details: { fromManagerId: existing.managerId, toManagerId: managerId } });
    if (input.jobTitle !== undefined && input.jobTitle !== existing.jobTitle)
      events.push({ type: 'PROMOTION', details: { fromTitle: existing.jobTitle, toTitle: input.jobTitle } });
    for (const event of events) {
      await this.db.employmentEvent.create({
        data: {
          companyId: this.ctx.companyId,
          employeeId: id,
          type: event.type,
          effectiveDate: today,
          details: event.details,
          createdById: this.ctx.userIdOrNull,
        },
      });
    }

    await this.audit.log('employee.updated', { entity: 'Employee', entityId: id, meta: { fields: Object.keys(input) } });
    // Write responses must redact exactly like the read path: employee.write
    // does not imply compensation.read.
    return this.stripBankDetails(employee, id);
  }

  async terminate(id: string, input: { terminationDate: string; reason: string }) {
    const companyId = this.ctx.companyId;
    const existing = await this.db.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.status === 'TERMINATED') throw new ConflictException('Employee is already terminated');
    if (this.ctx.employeeIdOrNull === id) throw new ForbiddenException('You cannot terminate yourself');

    // If the employee has a login, their workspace membership is revoked as part of
    // termination. Check the last-admin invariant before touching anything.
    const membership = existing.userId
      ? await this.db.membership.findUnique({
          where: { userId_companyId: { userId: existing.userId, companyId } },
        })
      : null;
    if (membership?.role === 'COMPANY_ADMIN') {
      const admins = await this.db.membership.count({ where: { companyId, role: 'COMPANY_ADMIN' } });
      if (admins <= 1) {
        throw new BadRequestException(
          'This employee is the only company administrator. Transfer the admin role before terminating them.',
        );
      }
    }

    const terminationDate = toDate(input.terminationDate) as Date;
    const employee = await this.db.employee.update({
      where: { id },
      data: { status: 'TERMINATED', terminationDate },
    });
    await this.db.employmentEvent.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId: id,
        type: 'TERMINATION',
        effectiveDate: terminationDate,
        details: { reason: input.reason },
        createdById: this.ctx.userIdOrNull,
      },
    });

    // Revoke access: drop the membership, unlink the login from the employee record and
    // unpin any live session from this company. Employment history is keyed by employeeId,
    // so nothing is lost — a rehired employee can simply be invited again.
    if (membership) {
      await this.prisma.$transaction([
        // Fail-closed RLS: multi-statement transaction needs the tenant GUC.
        this.prisma.$executeRaw`SELECT set_config('app.company_id', ${companyId}, TRUE)`,
        this.prisma.membership.delete({ where: { id: membership.id } }),
        this.prisma.employee.updateMany({ where: { id, companyId }, data: { userId: null } }),
        this.prisma.session.updateMany({
          where: { userId: membership.userId, activeCompanyId: companyId },
          data: { activeCompanyId: null },
        }),
      ]);
    }

    await this.audit.log('employee.terminated', {
      entity: 'Employee',
      entityId: id,
      meta: { reason: input.reason, accessRevoked: Boolean(membership) },
    });
    return this.stripBankDetails(employee, id);
  }

  async rehire(id: string, input: { hireDate: string; jobTitle: string; departmentId?: string; managerId?: string }) {
    const existing = await this.db.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.status !== 'TERMINATED') throw new ConflictException('Only terminated employees can be rehired');

    const departmentId = opt(input.departmentId);
    const managerId = opt(input.managerId);
    await this.validateReferences({ departmentId: departmentId ?? null, managerId: managerId ?? null });

    const hireDate = toDate(input.hireDate) as Date;
    const employee = await this.db.employee.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        terminationDate: null,
        hireDate,
        jobTitle: input.jobTitle,
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(managerId !== undefined ? { managerId } : {}),
      },
    });
    await this.db.employmentEvent.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId: id,
        type: 'REHIRE',
        effectiveDate: hireDate,
        details: { jobTitle: input.jobTitle },
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('employee.rehired', { entity: 'Employee', entityId: id });
    return this.stripBankDetails(employee, id);
  }

  async history(id: string) {
    const employee = await this.db.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!(await this.canSeeFullProfile(id))) throw new ForbiddenException('Not allowed to view this history');
    return this.db.employmentEvent.findMany({
      where: { employeeId: id },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // ─────────────────────────── compensation (field-level restricted) ───────────────────────────

  async listCompensation(id: string) {
    const employee = await this.db.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.db.compensation.findMany({
      where: { employeeId: id },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  async addCompensation(
    id: string,
    input: { effectiveDate: string; baseSalary: string; currency: string; payFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'ANNUAL'; note?: string },
  ) {
    const employee = await this.db.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    const record = await this.db.compensation.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId: id,
        effectiveDate: toDate(input.effectiveDate) as Date,
        baseSalary: input.baseSalary,
        currency: input.currency,
        payFrequency: input.payFrequency,
        note: opt(input.note) ?? null,
        createdById: this.ctx.userIdOrNull,
      },
    });
    // Event intentionally omits the amount so salary never leaks through history.
    await this.db.employmentEvent.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId: id,
        type: 'COMPENSATION_CHANGE',
        effectiveDate: toDate(input.effectiveDate) as Date,
        details: { currency: input.currency, payFrequency: input.payFrequency },
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('compensation.created', { entity: 'Compensation', entityId: record.id, meta: { employeeId: id } });
    return record;
  }

  /**
   * NTA 2025 rent relief (s.30): 20% of documented annual rent, capped at
   * ₦500,000, deductible from chargeable income from 2026. HR records the
   * employee's declaration here; the payroll engine applies the cap. Null
   * clears the declaration (no declaration → no relief).
   */
  async setRentDeclaration(id: string, annualRentDeclared: string | null) {
    const existing = await this.db.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Employee not found');
    const employee = await this.db.employee.update({
      where: { id },
      data: { annualRentDeclared },
      select: { id: true, annualRentDeclared: true },
    });
    await this.audit.log('employee.rent_declaration_updated', {
      entity: 'Employee',
      entityId: id,
      meta: { declared: annualRentDeclared !== null },
    });
    return employee;
  }

  // ─────────────────────────── CSV import / export ───────────────────────────

  async importCsv(buffer: Buffer) {
    let rows: Record<string, string>[];
    try {
      rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('Could not parse CSV file');
    }
    if (rows.length === 0) throw new BadRequestException('CSV file contains no data rows');
    if (rows.length > 1000) throw new BadRequestException('CSV import is limited to 1000 rows per file');

    const [departments, locations] = await Promise.all([
      this.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      this.db.location.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));

    const errors: { row: number; message: string }[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // 1-based + header row
      const parsed = importRowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({ row: rowNo, message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
        continue;
      }
      const row = parsed.data;

      const departmentId = row.department ? deptByName.get(row.department.toLowerCase()) : undefined;
      if (row.department && !departmentId) {
        errors.push({ row: rowNo, message: `Unknown department "${row.department}"` });
        continue;
      }
      const locationId = row.location ? locByName.get(row.location.toLowerCase()) : undefined;
      if (row.location && !locationId) {
        errors.push({ row: rowNo, message: `Unknown location "${row.location}"` });
        continue;
      }
      let managerId: string | undefined;
      if (row.managerEmail) {
        const manager = await this.db.employee.findFirst({
          where: { workEmail: row.managerEmail, deletedAt: null },
          select: { id: true },
        });
        if (!manager) {
          errors.push({ row: rowNo, message: `Unknown manager email "${row.managerEmail}"` });
          continue;
        }
        managerId = manager.id;
      }
      const duplicate = await this.db.employee.findFirst({ where: { workEmail: row.workEmail, deletedAt: null } });
      if (duplicate) {
        errors.push({ row: rowNo, message: `Employee with work email "${row.workEmail}" already exists` });
        continue;
      }

      try {
        await this.create({
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          workEmail: row.workEmail,
          phone: row.phone,
          jobTitle: row.jobTitle,
          hireDate: row.hireDate,
          employmentType: row.employmentType ?? 'FULL_TIME',
          departmentId,
          locationId,
          managerId,
        } as EmployeeCreateInput);
        created++;
      } catch (err: unknown) {
        errors.push({ row: rowNo, message: err instanceof Error ? err.message : 'Failed to create employee' });
      }
    }

    await this.audit.log('employee.imported', { entity: 'Employee', meta: { created, failed: errors.length } });
    return { created, failed: errors.length, errors };
  }

  async exportCsv(): Promise<string> {
    const employees = await this.db.employee.findMany({
      where: { deletedAt: null },
      select: {
        employeeNo: true,
        firstName: true,
        middleName: true,
        lastName: true,
        workEmail: true,
        jobTitle: true,
        status: true,
        employmentType: true,
        hireDate: true,
        department: { select: { name: true } },
        location: { select: { name: true } },
        manager: { select: { workEmail: true } },
      },
      orderBy: { employeeNo: 'asc' },
    });
    await this.audit.log('employee.exported', { entity: 'Employee', meta: { count: employees.length } });
    // Salary/compensation is deliberately excluded from exports.
    return stringify(
      employees.map((e) => ({
        employeeNo: csvSafe(e.employeeNo),
        firstName: csvSafe(e.firstName),
        middleName: csvSafe(e.middleName),
        lastName: csvSafe(e.lastName),
        workEmail: csvSafe(e.workEmail),
        jobTitle: csvSafe(e.jobTitle),
        status: e.status,
        employmentType: e.employmentType,
        hireDate: e.hireDate.toISOString().slice(0, 10),
        department: csvSafe(e.department?.name),
        location: csvSafe(e.location?.name),
        managerEmail: csvSafe(e.manager?.workEmail),
      })),
      { header: true },
    );
  }
}
