import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const leaveTypeCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, 'Uppercase letters, digits and underscores only'),
  paid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  color: z.string().trim().max(20).optional().or(z.literal('')),
});
export const leaveTypeUpdateSchema = leaveTypeCreateSchema.partial();

export const leavePolicyUpsertSchema = z.object({
  leaveTypeId: z.string().min(1),
  accrualMethod: z.enum(['ANNUAL_GRANT', 'MONTHLY_ACCRUAL', 'NONE']).default('ANNUAL_GRANT'),
  annualEntitlementDays: z.coerce.number().min(0).max(366),
  maxCarryoverDays: z.coerce.number().min(0).max(366).default(0),
  approvalLevels: z.coerce.number().int().min(1).max(2).default(1),
});

export const leaveRequestCreateSchema = z.object({
  employeeId: z.string().optional(), // defaults to self; requires leave.request.any otherwise
  leaveTypeId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  startHalfDay: z.boolean().default(false),
  endHalfDay: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type LeaveRequestCreateInput = z.infer<typeof leaveRequestCreateSchema>;

export const leaveDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const balanceAdjustSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  deltaDays: z.coerce.number().min(-366).max(366),
  reason: z.string().trim().min(3).max(500),
});

export const holidayCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: isoDate,
});
