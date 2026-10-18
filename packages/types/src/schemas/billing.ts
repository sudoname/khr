import { z } from 'zod';

export const BILLING_PLANS = ['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'] as const;
export type BillingPlanValue = (typeof BILLING_PLANS)[number];

export const BILLING_PLAN_LABELS: Record<BillingPlanValue, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

/** Platform-admin only: assign a company's billing plan. */
export const planUpdateSchema = z.object({
  plan: z.enum(BILLING_PLANS),
});
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
