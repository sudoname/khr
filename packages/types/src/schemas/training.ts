import { z } from 'zod';

export const ENROLLMENT_STATUSES = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export const courseCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  provider: z.string().trim().max(120).optional().or(z.literal('')),
  url: z.string().trim().url().max(300).optional().or(z.literal('')),
  durationHours: z.coerce.number().min(0).max(1000).optional(),
  mandatory: z.boolean().default(false),
});
export type CourseCreateInput = z.infer<typeof courseCreateSchema>;

export const courseUpdateSchema = courseCreateSchema.partial();
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

/** Managers may enroll any employee; employees enroll themselves (omit employeeId). */
export const enrollSchema = z.object({
  employeeId: z.string().optional().or(z.literal('')),
});

export const enrollmentUpdateSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  score: z.coerce.number().int().min(0).max(100).optional(),
});
export type EnrollmentUpdateInput = z.infer<typeof enrollmentUpdateSchema>;
