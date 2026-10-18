import { z } from 'zod';

export const JOB_POSTING_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export const APPLICATION_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export const INTERVIEW_MODES = ['PHONE', 'VIDEO', 'ONSITE'] as const;
export const CANDIDATE_SOURCES = ['WEBSITE', 'REFERRAL', 'LINKEDIN', 'AGENCY', 'JOB_BOARD', 'OTHER'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected a decimal amount like 250000.00');

export const jobPostingCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  locationId: z.string().optional().or(z.literal('')),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY']).default('FULL_TIME'),
  openings: z.coerce.number().int().min(1).max(999).default(1),
  salaryMin: money.optional().or(z.literal('')),
  salaryMax: money.optional().or(z.literal('')),
});
export type JobPostingCreateInput = z.infer<typeof jobPostingCreateSchema>;

export const jobPostingUpdateSchema = jobPostingCreateSchema.partial().extend({
  status: z.enum(JOB_POSTING_STATUSES).optional(),
});
export type JobPostingUpdateInput = z.infer<typeof jobPostingUpdateSchema>;

export const candidateCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  linkedinUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;

export const candidateUpdateSchema = candidateCreateSchema.partial();
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;

export const applicationCreateSchema = z.object({
  jobPostingId: z.string().min(1),
  candidateId: z.string().min(1),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

/** Manual stage moves exclude OFFER and HIRED, which have dedicated endpoints. */
export const applicationStageSchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'REJECTED', 'WITHDRAWN']),
  rejectionReason: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type ApplicationStageInput = z.infer<typeof applicationStageSchema>;

export const interviewCreateSchema = z.object({
  scheduledAt: z.string().datetime(),
  mode: z.enum(INTERVIEW_MODES).default('VIDEO'),
  interviewerUserId: z.string().optional().or(z.literal('')),
});
export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

export const interviewFeedbackSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  feedback: z.string().trim().max(5000).optional().or(z.literal('')),
});
export type InterviewFeedbackInput = z.infer<typeof interviewFeedbackSchema>;

export const offerCreateSchema = z.object({
  salary: money,
  currency: z.string().trim().length(3).default('NGN'),
  startDate: isoDate,
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;

/** Converts an accepted offer into an employee record. */
export const hireSchema = z.object({
  jobTitle: z.string().trim().min(1).max(120),
  departmentId: z.string().optional().or(z.literal('')),
  locationId: z.string().optional().or(z.literal('')),
  managerId: z.string().optional().or(z.literal('')),
});
export type HireInput = z.infer<typeof hireSchema>;

export const applicationListQuerySchema = z.object({
  jobPostingId: z.string().optional(),
  stage: z.enum(APPLICATION_STAGES).optional(),
});
