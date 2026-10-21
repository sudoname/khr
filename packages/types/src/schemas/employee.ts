import { z } from 'zod';

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const employeeCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().max(80).optional().or(z.literal('')),
  workEmail: z.string().trim().toLowerCase().email(),
  personalEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  country: z.string().trim().max(2).optional().or(z.literal('')),
  dateOfBirth: isoDate.optional().or(z.literal('')),
  // Banking/identity details (field-level restricted server-side, like salary).
  bvn: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN is 11 digits')
    .optional()
    .or(z.literal('')),
  bankName: z.string().trim().max(120).optional().or(z.literal('')),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'NUBAN account numbers are 10 digits')
    .optional()
    .or(z.literal('')),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  hireDate: isoDate,
  probationEndsOn: isoDate.optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  jobTitle: z.string().trim().min(1).max(120),
  grade: z.string().trim().max(40).optional().or(z.literal('')),
  locationId: z.string().optional().or(z.literal('')),
  managerId: z.string().optional().or(z.literal('')),
  emergencyContact: z
    .object({
      name: z.string().trim().min(1).max(120),
      relationship: z.string().trim().max(60),
      phone: z.string().trim().min(3).max(40),
      email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
    })
    .optional(),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = employeeCreateSchema.partial();
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeSelfUpdateSchema = z.object({
  preferredName: z.string().trim().max(80).optional(),
  personalEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  emergencyContact: z
    .object({
      name: z.string().trim().min(1).max(120),
      relationship: z.string().trim().max(60),
      phone: z.string().trim().min(3).max(40),
      email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
    })
    .optional(),
});

export const terminateEmployeeSchema = z.object({
  terminationDate: isoDate,
  reason: z.string().trim().min(1).max(500),
});

export const rehireEmployeeSchema = z.object({
  hireDate: isoDate,
  jobTitle: z.string().trim().min(1).max(120),
  departmentId: z.string().optional().or(z.literal('')),
  managerId: z.string().optional().or(z.literal('')),
});

export const compensationCreateSchema = z.object({
  effectiveDate: isoDate,
  baseSalary: z
    .string()
    .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected a decimal amount like 250000.00'),
  currency: z.string().trim().length(3).default('NGN'),
  payFrequency: z.enum(['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'ANNUAL']).default('MONTHLY'),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export const changeManagerSchema = z.object({
  managerId: z.string().nullable(),
});

/**
 * NTA 2025 rent relief declaration (20% of annual rent, capped at ₦500,000).
 * Recorded by HR from the employee's documented declaration. Null clears it.
 */
export const rentDeclarationSchema = z.object({
  annualRentDeclared: z
    .string()
    .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected a decimal amount like 1200000.00')
    .nullable(),
});
export type RentDeclarationInput = z.infer<typeof rentDeclarationSchema>;

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
