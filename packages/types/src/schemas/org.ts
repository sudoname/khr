import { z } from 'zod';

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().optional().or(z.literal('')),
  headEmployeeId: z.string().optional().or(z.literal('')),
});
export const departmentUpdateSchema = departmentCreateSchema.partial();

export const locationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  country: z.string().trim().length(2).default('NG'),
  timezone: z.string().trim().max(60).default('Africa/Lagos'),
});
export const locationUpdateSchema = locationCreateSchema.partial();

export const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  country: z.string().trim().length(2).optional(),
  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).optional(),
  termsOfEmployment: z.string().trim().max(20000).optional().or(z.literal('')),
});
