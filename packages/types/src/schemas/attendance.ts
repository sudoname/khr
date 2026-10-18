import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });

export const attendancePolicyUpsertSchema = z.object({
  name: z.string().trim().min(1).max(80).default('Default'),
  workStartTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  workEndTime: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
  lateGraceMinutes: z.coerce.number().int().min(0).max(240).default(10),
  // ISO weekday numbers, 1 = Monday ... 7 = Sunday
  workDays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
});

export const attendanceListQuerySchema = z.object({
  employeeId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(31),
});

export const correctionCreateSchema = z.object({
  day: isoDate,
  proposedClockInAt: isoDateTime,
  proposedClockOutAt: isoDateTime.optional(),
  reason: z.string().trim().min(3).max(500),
});

export const correctionReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});
