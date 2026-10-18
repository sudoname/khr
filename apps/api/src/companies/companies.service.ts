import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import type { CompanyRole, CompanySector, InviteMemberInput } from '@peopleflow/types';
import { sniffImageMime } from '../common/image-sniff';
import { config } from '../config';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { renderEmail } from '../infra/email-template';
import { PrismaService } from '../infra/prisma.service';
import { QueueService } from '../infra/queue.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  async current() {
    const company = await this.prisma.company.findUnique({ where: { id: this.ctx.companyId } });
    if (!company || company.deletedAt) throw new NotFoundException('Company not found');
    return company;
  }

  async update(data: {
    name?: string;
    country?: string;
    timezone?: string;
    currency?: string;
    sector?: CompanySector;
    rcNumber?: string;
    termsOfEmployment?: string;
  }) {
    const { termsOfEmployment, rcNumber, ...rest } = data;
    const company = await this.prisma.company.update({
      where: { id: this.ctx.companyId },
      data: {
        ...rest,
        ...(rcNumber !== undefined ? { rcNumber: rcNumber || null } : {}),
        ...(termsOfEmployment !== undefined ? { termsOfEmployment: termsOfEmployment || null } : {}),
      },
    });
    // Terms text can be long — audit the touched fields, not the payload.
    await this.audit.log('company.updated', { entity: 'Company', entityId: company.id, meta: { fields: Object.keys(data) } });
    return company;
  }

  // ───────────────────────── logo ─────────────────────────

  async uploadLogo(file: Express.Multer.File) {
    const companyId = this.ctx.companyId;
    // Content-based validation; the client-supplied mimetype is ignored.
    const mime = sniffImageMime(file.buffer);
    if (!mime) throw new BadRequestException('Company logo must be a JPEG, PNG or WebP image');

    await this.prisma.companyLogo.upsert({
      where: { companyId },
      create: { companyId, mime, data: file.buffer },
      update: { mime, data: file.buffer },
    });
    const logoUrl = `/api/company/logo?v=${Date.now()}`;
    await this.prisma.company.update({ where: { id: companyId }, data: { logoUrl } });
    await this.audit.log('company.logo_updated', { entity: 'Company', entityId: companyId });
    return { logoUrl };
  }

  async removeLogo() {
    const companyId = this.ctx.companyId;
    await this.prisma.companyLogo.deleteMany({ where: { companyId } });
    await this.prisma.company.update({ where: { id: companyId }, data: { logoUrl: null } });
    await this.audit.log('company.logo_removed', { entity: 'Company', entityId: companyId });
    return { logoUrl: null };
  }

  async getLogo() {
    const logo = await this.prisma.companyLogo.findUnique({ where: { companyId: this.ctx.companyId } });
    if (!logo) throw new NotFoundException('No company logo');
    return logo;
  }

  // ───────────────────────── members ─────────────────────────

  async listMembers() {
    const members = await this.prisma.membership.findMany({
      where: { companyId: this.ctx.companyId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, emailVerifiedAt: true, mfaEnabled: true } },
        employee: { select: { id: true, employeeNo: true, jobTitle: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      role: m.role,
      user: m.user,
      employee: m.employee,
      createdAt: m.createdAt,
    }));
  }

  async invite(input: InviteMemberInput) {
    const companyId = this.ctx.companyId;

    // Employees may optionally be linked at invite time; the link is validated
    // against the active tenant to prevent cross-company linking.
    let employeeId: string | null = null;
    if (input.employeeId) {
      const employee = await this.prisma.tenant(companyId).employee.findFirst({ where: { id: input.employeeId } });
      if (!employee) throw new BadRequestException('Employee not found in this company');
      if (employee.userId) throw new BadRequestException('Employee is already linked to a user');
      employeeId = employee.id;
    }

    let user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const isNewUser = !user;
    if (!user) {
      // Placeholder credential; the invite token flow sets the real password.
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: sha256(randomBytes(32).toString('hex')), // unusable: not an argon2 hash
        },
      });
    }

    const existing = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (existing) throw new BadRequestException('This user is already a member of the company');

    await this.prisma.$transaction(async (tx) => {
      await tx.membership.create({
        data: { userId: user!.id, companyId, role: input.role, employeeId },
      });
      if (employeeId) {
        await tx.employee.update({ where: { id: employeeId }, data: { userId: user!.id } });
      }
    });

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });
    if (isNewUser) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.securityToken.create({
        data: {
          userId: user.id,
          type: 'INVITE',
          tokenHash: sha256(token),
          meta: { companyId },
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });
      const inviteUrl = `${config.webBaseUrl}/accept-invite?token=${token}`;
      await this.queue.sendEmail({
        to: user.email,
        subject: 'You have been invited to PeopleFlow HR',
        text: `You have been invited to join "${company.name}" on PeopleFlow HR as ${input.role}.\n\nActivate your account: ${inviteUrl}\n\nThe link expires in 72 hours.`,
        html: renderEmail({
          heading: `Join ${company.name}`,
          bodyLines: [
            `You have been invited to join "${company.name}" on PeopleFlow HR as ${input.role}.`,
            'Set your password to activate your account.',
          ],
          button: { label: 'Activate account', url: inviteUrl },
          footerNote: 'The link expires in 72 hours.',
        }),
        companyId,
      });
    } else {
      const signInUrl = `${config.webBaseUrl}/login`;
      await this.queue.sendEmail({
        to: user.email,
        subject: 'You have been added to a PeopleFlow HR workspace',
        text: `You now have access to "${company.name}" on PeopleFlow HR as ${input.role}. Sign in and use the company switcher to access it.`,
        html: renderEmail({
          heading: `You now have access to ${company.name}`,
          bodyLines: [
            `You have been added to "${company.name}" on PeopleFlow HR as ${input.role}.`,
            'Sign in and use the company switcher to open the workspace.',
          ],
          button: { label: 'Open workspace', url: signInUrl },
        }),
        companyId,
      });
    }

    await this.audit.log('member.invited', { entity: 'User', entityId: user.id, meta: { role: input.role, email: input.email } });
    return { message: 'Invitation sent' };
  }

  async updateRole(membershipId: string, role: CompanyRole) {
    const companyId = this.ctx.companyId;
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, companyId } });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.userId === this.ctx.userId) {
      throw new ForbiddenException('You cannot change your own role');
    }
    if (membership.role === 'COMPANY_ADMIN' && role !== 'COMPANY_ADMIN') {
      const admins = await this.prisma.membership.count({ where: { companyId, role: 'COMPANY_ADMIN' } });
      if (admins <= 1) throw new BadRequestException('A company must keep at least one administrator');
    }
    const updated = await this.prisma.membership.update({ where: { id: membership.id }, data: { role } });
    await this.audit.log('member.role_changed', {
      entity: 'Membership',
      entityId: membership.id,
      meta: { from: membership.role, to: role },
    });
    return updated;
  }

  async removeMember(membershipId: string) {
    const companyId = this.ctx.companyId;
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, companyId } });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.userId === this.ctx.userId) throw new ForbiddenException('You cannot remove yourself');
    if (membership.role === 'COMPANY_ADMIN') {
      const admins = await this.prisma.membership.count({ where: { companyId, role: 'COMPANY_ADMIN' } });
      if (admins <= 1) throw new BadRequestException('A company must keep at least one administrator');
    }
    await this.prisma.$transaction(async (tx) => {
      if (membership.employeeId) {
        await tx.employee.updateMany({ where: { id: membership.employeeId, companyId }, data: { userId: null } });
      }
      await tx.membership.delete({ where: { id: membership.id } });
      // Drop tenant access from any live session pinned to this company.
      await tx.session.updateMany({
        where: { userId: membership.userId, activeCompanyId: companyId },
        data: { activeCompanyId: null },
      });
    });
    await this.audit.log('member.removed', { entity: 'Membership', entityId: membership.id, meta: { userId: membership.userId } });
    return { message: 'Member removed' };
  }

  // ───────────────────────── platform admin ─────────────────────────

  async platformListCompanies() {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { memberships: true } } },
    });
    await this.audit.log('platform.companies_listed', { companyId: null });
    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      country: c.country,
      sector: c.sector,
      createdAt: c.createdAt,
      members: c._count.memberships,
    }));
  }
}
