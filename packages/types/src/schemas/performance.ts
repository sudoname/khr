import { z } from 'zod';

export const REVIEW_CYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export const GOAL_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const reviewCycleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.startDate < v.endDate, { message: 'End date must be after start date', path: ['endDate'] });
export type ReviewCycleCreateInput = z.infer<typeof reviewCycleCreateSchema>;

export const reviewCycleStatusSchema = z.object({
  status: z.enum(REVIEW_CYCLE_STATUSES),
});

export const goalCreateSchema = z.object({
  cycleId: z.string().min(1),
  /** Omitted = goal for the actor's own employee record. */
  employeeId: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  weight: z.coerce.number().min(0).max(100).default(0),
});
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  weight: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
});
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

export const reviewUpsertSchema = z.object({
  cycleId: z.string().min(1),
  employeeId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  strengths: z.string().trim().max(5000).optional().or(z.literal('')),
  improvements: z.string().trim().max(5000).optional().or(z.literal('')),
  comment: z.string().trim().max(5000).optional().or(z.literal('')),
  submit: z.boolean().default(false),
});
export type ReviewUpsertInput = z.infer<typeof reviewUpsertSchema>;
