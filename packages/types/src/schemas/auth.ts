import { z } from 'zod';
import { COMPANY_ROLES } from '../roles';
import { COMPANY_SECTORS } from '../sectors';

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200);

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  sector: z.enum(COMPANY_SECTORS),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().trim().min(6).max(10),
});

export const mfaEnableSchema = z.object({ code: z.string().trim().min(6).max(10) });
export const mfaDisableSchema = z.object({
  code: z.string().trim().min(6).max(10),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});
export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const switchCompanySchema = z.object({ companyId: z.string().min(1) });

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(COMPANY_ROLES),
  employeeId: z.string().optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const updateMemberRoleSchema = z.object({ role: z.enum(COMPANY_ROLES) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
