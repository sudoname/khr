import { z } from 'zod';

const percent = z.coerce.number().min(0).max(100);

export const payrollSettingsSchema = z
  .object({
    basicPercent: percent.default(50),
    housingPercent: percent.default(25),
    transportPercent: percent.default(25),
    pensionEnabled: z.boolean().default(true),
    pensionEmployeePercent: percent.default(8),
    pensionEmployerPercent: percent.default(10),
    nhfEnabled: z.boolean().default(false),
    nhfPercent: percent.default(2.5),
    nhisEnabled: z.boolean().default(false),
    nhisPercent: percent.default(5),
    nsitfEnabled: z.boolean().default(false),
    nsitfPercent: percent.default(1),
    itfEnabled: z.boolean().default(false),
    itfPercent: percent.default(1),
  })
  .refine((v) => v.basicPercent + v.housingPercent + v.transportPercent <= 100, {
    message: 'Basic + housing + transport must not exceed 100%',
    path: ['basicPercent'],
  });
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;

/** Attestation that the named tax-engine version has been reviewed and approved. */
export const payrollTaxApprovalSchema = z.object({
  version: z.string().trim().min(3).max(60),
});
export type PayrollTaxApprovalInput = z.infer<typeof payrollTaxApprovalSchema>;

export const payrollRunCreateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;

export const payrollRejectSchema = z.object({
  note: z.string().trim().min(3).max(1000),
});
