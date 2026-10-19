import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnboardingReviewInput, OnboardingSubmitInput } from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { QueueService } from '../infra/queue.service';

const DEFAULT_TERMS = `By accepting these terms of employment you confirm that:

1. The information you provided during profile setup is accurate and complete.
2. You will comply with the company's policies, procedures and code of conduct.
3. Your employment is governed by your offer letter and applicable Nigerian labour law.
4. You consent to the company processing your personal data for HR administration purposes.`;

/** '' → null, undefined stays undefined. */
function opt(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  private async ownEmployee() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { emergencyContacts: { select: { name: true, relationship: true, phone: true, email: true } } },
    });
    if (!employee) throw new NotFoundException('Employee record not found');
    return employee;
  }

  async me() {
    const employee = await this.ownEmployee();
    const company = await this.prisma.company.findUnique({
      where: { id: this.ctx.companyId },
      select: { termsOfEmployment: true },
    });
    return {
      status: employee.onboardingStatus,
      submittedAt: employee.onboardingSubmittedAt,
      reviewedAt: employee.onboardingReviewedAt,
      note: employee.onboardingNote,
      termsAcceptedAt: employee.termsAcceptedAt,
      terms: company?.termsOfEmployment || DEFAULT_TERMS,
      profile: {
        employeeNo: employee.employeeNo,
        firstName: employee.firstName,
        middleName: employee.middleName,
        lastName: employee.lastName,
        preferredName: employee.preferredName,
        workEmail: employee.workEmail,
        personalEmail: employee.personalEmail,
        phone: employee.phone,
        dateOfBirth: employee.dateOfBirth,
        gender: employee.gender,
        addressLine1: employee.addressLine1,
        city: employee.city,
        state: employee.state,
        country: employee.country,
        bankName: employee.bankName,
        bankAccountNumber: employee.bankAccountNumber,
        bvn: employee.bvn,
        emergencyContact: employee.emergencyContacts[0] ?? null,
      },
    };
  }

  async submit(input: OnboardingSubmitInput) {
    const employee = await this.ownEmployee();
    if (employee.onboardingStatus === 'SUBMITTED') {
      throw new ConflictException('Your profile is already submitted and awaiting review');
    }
    if (employee.onboardingStatus === 'APPROVED') {
      throw new ConflictException('Your profile has already been approved');
    }

    await this.db.employee.update({
      where: { id: employee.id },
      data: {
        middleName: opt(input.middleName) ?? null,
        preferredName: opt(input.preferredName) ?? null,
        personalEmail: opt(input.personalEmail) ?? null,
        phone: input.phone,
        dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`),
        gender: input.gender,
        addressLine1: input.addressLine1,
        city: opt(input.city) ?? null,
        state: input.state,
        country: input.country,
        bankName: input.bankName,
        bankAccountNumber: input.bankAccountNumber,
        bvn: opt(input.bvn) ?? null,
        onboardingStatus: 'SUBMITTED',
        onboardingSubmittedAt: new Date(),
        onboardingNote: null,
      },
    });
    if (input.emergencyContact) {
      await this.db.emergencyContact.deleteMany({ where: { employeeId: employee.id } });
      await this.db.emergencyContact.create({
        data: {
          companyId: this.ctx.companyId,
          employeeId: employee.id,
          name: input.emergencyContact.name,
          relationship: input.emergencyContact.relationship || null,
          phone: input.emergencyContact.phone,
          email: opt(input.emergencyContact.email) ?? null,
        },
      });
    }
    // BVN/account number never go into the audit trail.
    await this.audit.log('onboarding.submitted', { entity: 'Employee', entityId: employee.id });
    return this.me();
  }

  async acceptTerms() {
    const employee = await this.ownEmployee();
    if (employee.onboardingStatus !== 'APPROVED') {
      throw new ConflictException('Terms can be accepted once your profile has been approved');
    }
    if (!employee.termsAcceptedAt) {
      await this.db.employee.update({
        where: { id: employee.id },
        data: { termsAcceptedAt: new Date() },
      });
      await this.audit.log('onboarding.terms_accepted', { entity: 'Employee', entityId: employee.id });
    }
    return this.me();
  }

  // ───────────────────────── review (admin/HR) ─────────────────────────

  async pending() {
    const canSeeBankDetails = this.ctx.can('compensation.read');
    const rows = await this.db.employee.findMany({
      where: { onboardingStatus: 'SUBMITTED', deletedAt: null },
      orderBy: { onboardingSubmittedAt: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        emergencyContacts: { select: { name: true, relationship: true, phone: true, email: true } },
      },
    });
    return rows.map((e) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      firstName: e.firstName,
      middleName: e.middleName,
      lastName: e.lastName,
      workEmail: e.workEmail,
      personalEmail: e.personalEmail,
      jobTitle: e.jobTitle,
      department: e.department,
      phone: e.phone,
      dateOfBirth: e.dateOfBirth,
      gender: e.gender,
      addressLine1: e.addressLine1,
      city: e.city,
      state: e.state,
      country: e.country,
      submittedAt: e.onboardingSubmittedAt,
      emergencyContact: e.emergencyContacts[0] ?? null,
      // Field-level restriction mirrors salary handling.
      bankName: canSeeBankDetails ? e.bankName : null,
      bankAccountNumber: canSeeBankDetails ? e.bankAccountNumber : null,
      bvn: canSeeBankDetails ? e.bvn : null,
    }));
  }

  async review(employeeId: string, input: OnboardingReviewInput) {
    const employee = await this.db.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    // Four-eyes: a reviewer with employee.write may not decide their own profile.
    if (employee.userId != null && employee.userId === this.ctx.userIdOrNull) {
      throw new ForbiddenException({
        message: 'You cannot review your own onboarding profile',
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
    }
    if (employee.onboardingStatus !== 'SUBMITTED') {
      throw new ConflictException('This profile is not awaiting review');
    }

    const note = opt(input.note) ?? null;
    await this.db.employee.update({
      where: { id: employeeId },
      data: {
        onboardingStatus: input.decision,
        onboardingReviewedAt: new Date(),
        onboardingReviewedById: this.ctx.userIdOrNull,
        onboardingNote: note,
      },
    });
    await this.audit.log('onboarding.reviewed', {
      entity: 'Employee',
      entityId: employeeId,
      meta: { decision: input.decision },
    });

    await this.queue.sendEmail({
      to: employee.workEmail,
      subject:
        input.decision === 'APPROVED'
          ? 'Your employee profile has been approved'
          : 'Your employee profile needs changes',
      text:
        input.decision === 'APPROVED'
          ? 'Your profile setup was approved. Sign in to PeopleFlow HR and accept your terms of employment to complete onboarding.'
          : `Your profile setup was returned for changes${note ? `:\n\n${note}` : '.'}\n\nSign in to PeopleFlow HR, update your details and resubmit.`,
      companyId: this.ctx.companyId,
    });

    return { message: `Profile ${input.decision.toLowerCase()}` };
  }
}
