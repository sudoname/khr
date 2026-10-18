import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApplicationCreateInput,
  ApplicationStageInput,
  CandidateCreateInput,
  CandidateUpdateInput,
  HireInput,
  InterviewCreateInput,
  InterviewFeedbackInput,
  JobPostingCreateInput,
  JobPostingUpdateInput,
  OfferCreateInput,
} from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { EmployeesService } from '../employees/employees.service';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const opt = (v?: string) => (v && v.trim() !== '' ? v : undefined);

/** Stages an application can still move out of. */
const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;

const CANDIDATE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  linkedinUrl: true,
  source: true,
  notes: true,
  createdAt: true,
} as const;

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
    private readonly employees: EmployeesService,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── job postings ───────────────────────────

  async listPostings() {
    const postings = await this.db.jobPosting.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { applications: true } } },
    });
    return postings.map((p) => ({ ...p, applicationCount: p._count.applications, _count: undefined }));
  }

  async createPosting(input: JobPostingCreateInput) {
    const posting = await this.db.jobPosting.create({
      data: {
        companyId: this.ctx.companyId,
        title: input.title,
        description: opt(input.description) ?? null,
        departmentId: opt(input.departmentId) ?? null,
        locationId: opt(input.locationId) ?? null,
        employmentType: input.employmentType,
        openings: input.openings,
        salaryMin: opt(input.salaryMin) ?? null,
        salaryMax: opt(input.salaryMax) ?? null,
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('recruitment.posting_created', { entity: 'JobPosting', entityId: posting.id, meta: { title: input.title } });
    return posting;
  }

  async updatePosting(id: string, input: JobPostingUpdateInput) {
    const existing = await this.db.jobPosting.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Job posting not found');

    const posting = await this.db.jobPosting.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: opt(input.description) ?? null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: opt(input.departmentId) ?? null } : {}),
        ...(input.locationId !== undefined ? { locationId: opt(input.locationId) ?? null } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
        ...(input.openings !== undefined ? { openings: input.openings } : {}),
        ...(input.salaryMin !== undefined ? { salaryMin: opt(input.salaryMin) ?? null } : {}),
        ...(input.salaryMax !== undefined ? { salaryMax: opt(input.salaryMax) ?? null } : {}),
        ...(input.status !== undefined
          ? { status: input.status, closedAt: input.status === 'CLOSED' ? new Date() : null }
          : {}),
      },
    });
    await this.audit.log('recruitment.posting_updated', { entity: 'JobPosting', entityId: id });
    return posting;
  }

  // ─────────────────────────── candidates ───────────────────────────

  async listCandidates() {
    return this.db.candidate.findMany({
      select: { ...CANDIDATE_SELECT, applications: { select: { id: true, stage: true, jobPosting: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async createCandidate(input: CandidateCreateInput) {
    const duplicate = await this.db.candidate.findFirst({ where: { email: input.email } });
    if (duplicate) throw new ConflictException('A candidate with this email already exists');
    const candidate = await this.db.candidate.create({
      data: {
        companyId: this.ctx.companyId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: opt(input.phone) ?? null,
        linkedinUrl: opt(input.linkedinUrl) ?? null,
        source: input.source ?? null,
        notes: opt(input.notes) ?? null,
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('recruitment.candidate_created', { entity: 'Candidate', entityId: candidate.id, meta: { email: input.email } });
    return candidate;
  }

  async updateCandidate(id: string, input: CandidateUpdateInput) {
    const existing = await this.db.candidate.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Candidate not found');
    const candidate = await this.db.candidate.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: opt(input.phone) ?? null } : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: opt(input.linkedinUrl) ?? null } : {}),
        ...(input.source !== undefined ? { source: input.source ?? null } : {}),
        ...(input.notes !== undefined ? { notes: opt(input.notes) ?? null } : {}),
      },
    });
    await this.audit.log('recruitment.candidate_updated', { entity: 'Candidate', entityId: id });
    return candidate;
  }

  // ─────────────────────────── applications ───────────────────────────

  async listApplications(query: { jobPostingId?: string; stage?: string }) {
    return this.db.application.findMany({
      where: {
        ...(query.jobPostingId ? { jobPostingId: query.jobPostingId } : {}),
        ...(query.stage ? { stage: query.stage as never } : {}),
      },
      include: {
        candidate: { select: CANDIDATE_SELECT },
        jobPosting: { select: { id: true, title: true, status: true } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async getApplication(id: string) {
    const application = await this.db.application.findFirst({
      where: { id },
      include: {
        candidate: { select: CANDIDATE_SELECT },
        jobPosting: { select: { id: true, title: true, status: true, employmentType: true, departmentId: true, locationId: true } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  async createApplication(input: ApplicationCreateInput) {
    const [posting, candidate] = await Promise.all([
      this.db.jobPosting.findFirst({ where: { id: input.jobPostingId } }),
      this.db.candidate.findFirst({ where: { id: input.candidateId } }),
    ]);
    if (!posting) throw new NotFoundException('Job posting not found');
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (posting.status === 'CLOSED') throw new ConflictException('This job posting is closed');

    try {
      const application = await this.db.application.create({
        data: { companyId: this.ctx.companyId, jobPostingId: posting.id, candidateId: candidate.id },
      });
      await this.audit.log('recruitment.application_created', {
        entity: 'Application',
        entityId: application.id,
        meta: { jobPostingId: posting.id, candidateId: candidate.id },
      });
      return application;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002')
        throw new ConflictException('This candidate has already applied to this posting');
      throw err;
    }
  }

  async changeStage(id: string, input: ApplicationStageInput) {
    const application = await this.db.application.findFirst({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    if (!OPEN_STAGES.includes(application.stage as (typeof OPEN_STAGES)[number]))
      throw new ConflictException(`Application is already ${application.stage}`);
    if (input.stage === 'REJECTED' && !opt(input.rejectionReason))
      throw new BadRequestException('A rejection reason is required');

    const terminal = input.stage === 'REJECTED' || input.stage === 'WITHDRAWN';
    const updated = await this.db.application.update({
      where: { id },
      data: {
        stage: input.stage,
        rejectionReason: input.stage === 'REJECTED' ? (opt(input.rejectionReason) ?? null) : null,
        decidedAt: terminal ? new Date() : null,
      },
    });
    await this.audit.log('recruitment.stage_changed', {
      entity: 'Application',
      entityId: id,
      meta: { from: application.stage, to: input.stage },
    });
    return updated;
  }

  // ─────────────────────────── interviews ───────────────────────────

  async scheduleInterview(applicationId: string, input: InterviewCreateInput) {
    const application = await this.db.application.findFirst({ where: { id: applicationId } });
    if (!application) throw new NotFoundException('Application not found');
    if (!OPEN_STAGES.includes(application.stage as (typeof OPEN_STAGES)[number]))
      throw new ConflictException(`Application is already ${application.stage}`);

    const interview = await this.db.interview.create({
      data: {
        companyId: this.ctx.companyId,
        applicationId,
        scheduledAt: new Date(input.scheduledAt),
        mode: input.mode,
        interviewerUserId: opt(input.interviewerUserId) ?? null,
      },
    });
    // Move the pipeline forward when still in early stages.
    if (application.stage === 'APPLIED' || application.stage === 'SCREENING') {
      await this.db.application.update({ where: { id: applicationId }, data: { stage: 'INTERVIEW' } });
    }
    await this.audit.log('recruitment.interview_scheduled', {
      entity: 'Interview',
      entityId: interview.id,
      meta: { applicationId, scheduledAt: input.scheduledAt },
    });
    return interview;
  }

  async interviewFeedback(id: string, input: InterviewFeedbackInput) {
    const interview = await this.db.interview.findFirst({ where: { id } });
    if (!interview) throw new NotFoundException('Interview not found');
    if (interview.status !== 'SCHEDULED') throw new ConflictException('This interview has already been closed out');

    const updated = await this.db.interview.update({
      where: { id },
      data: {
        status: input.status,
        rating: input.rating ?? null,
        feedback: opt(input.feedback) ?? null,
      },
    });
    await this.audit.log('recruitment.interview_feedback', {
      entity: 'Interview',
      entityId: id,
      meta: { status: input.status, rating: input.rating ?? null },
    });
    return updated;
  }

  // ─────────────────────────── offer + hire ───────────────────────────

  async makeOffer(id: string, input: OfferCreateInput) {
    const application = await this.db.application.findFirst({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    if (!OPEN_STAGES.includes(application.stage as (typeof OPEN_STAGES)[number]))
      throw new ConflictException(`Application is already ${application.stage}`);

    const updated = await this.db.application.update({
      where: { id },
      data: {
        stage: 'OFFER',
        offerSalary: input.salary,
        offerCurrency: input.currency,
        offerStartDate: new Date(`${input.startDate}T00:00:00.000Z`),
        offerNote: opt(input.note) ?? null,
      },
    });
    await this.audit.log('recruitment.offer_made', {
      entity: 'Application',
      entityId: id,
      meta: { startDate: input.startDate },
    });
    return updated;
  }

  /**
   * Converts an application in OFFER stage into a real employee record,
   * reusing the employee-number allocation and HIRE event in EmployeesService.
   */
  async hire(id: string, input: HireInput) {
    const application = await this.db.application.findFirst({
      where: { id },
      include: { candidate: true, jobPosting: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.stage !== 'OFFER') throw new ConflictException('Only applications in OFFER stage can be hired');
    if (!application.offerStartDate) throw new ConflictException('The offer has no start date');

    const employee = await this.employees.create({
      firstName: application.candidate.firstName,
      lastName: application.candidate.lastName,
      workEmail: application.candidate.email,
      phone: application.candidate.phone ?? '',
      employmentType: application.jobPosting.employmentType,
      hireDate: application.offerStartDate.toISOString().slice(0, 10),
      jobTitle: input.jobTitle,
      departmentId: opt(input.departmentId) ?? '',
      locationId: opt(input.locationId) ?? '',
      managerId: opt(input.managerId) ?? '',
    });

    const updated = await this.db.application.update({
      where: { id },
      data: { stage: 'HIRED', hiredEmployeeId: employee.id, decidedAt: new Date() },
    });
    await this.audit.log('recruitment.hired', {
      entity: 'Application',
      entityId: id,
      meta: { employeeId: employee.id, candidateEmail: application.candidate.email },
    });
    return { application: updated, employee };
  }
}
