import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

/** The 36 Nigerian states + FCT, for the onboarding address form. */
export const NIGERIAN_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'Federal Capital Territory',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
] as const;

/**
 * Common Nigerian banks offered as suggestions in the onboarding form.
 * Bank name is free text so microfinance banks and new entrants are not blocked.
 */
export const NIGERIAN_BANKS = [
  'Access Bank',
  'Citibank Nigeria',
  'Ecobank',
  'Fidelity Bank',
  'First Bank of Nigeria',
  'FCMB',
  'Globus Bank',
  'GTBank',
  'Jaiz Bank',
  'Keystone Bank',
  'Kuda MFB',
  'Lotus Bank',
  'Moniepoint MFB',
  'Opay',
  'Optimus Bank',
  'PalmPay',
  'Parallex Bank',
  'Polaris Bank',
  'Premium Trust Bank',
  'Providus Bank',
  'Stanbic IBTC Bank',
  'Standard Chartered Bank',
  'Sterling Bank',
  'SunTrust Bank',
  'TAJ Bank',
  'Titan Trust Bank',
  'Union Bank',
  'United Bank for Africa',
  'Unity Bank',
  'Wema Bank',
  'Zenith Bank',
] as const;

/**
 * Employee self-service profile setup ("Setup Employee").
 * Deliberately limited to personal data — employee number, grade, department,
 * designation, location, employment dates/type/status stay admin-managed.
 */
export const onboardingSubmitSchema = z.object({
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  preferredName: z.string().trim().max(80).optional().or(z.literal('')),
  personalEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: z.string().trim().min(7, 'Enter a valid mobile number').max(40),
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS),
  addressLine1: z.string().trim().min(3, 'Enter your address').max(200),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().min(2).max(80),
  country: z.string().trim().length(2).default('NG'),
  bankName: z.string().trim().min(2, 'Select or enter your bank').max(120),
  bankAccountNumber: z.string().trim().regex(/^\d{10}$/, 'NUBAN account numbers are 10 digits'),
  bvn: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN is 11 digits')
    .optional()
    .or(z.literal('')),
  emergencyContact: z
    .object({
      name: z.string().trim().min(1).max(120),
      relationship: z.string().trim().max(60),
      phone: z.string().trim().min(3).max(40),
      email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
    })
    .optional(),
});
export type OnboardingSubmitInput = z.infer<typeof onboardingSubmitSchema>;

export const onboardingReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});
export type OnboardingReviewInput = z.infer<typeof onboardingReviewSchema>;

export const ONBOARDING_STATUSES = ['NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type OnboardingStatusValue = (typeof ONBOARDING_STATUSES)[number];
