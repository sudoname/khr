import { z } from 'zod';

/** Platform-admin only: cross-tenant user directory query. */
export const platformUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformUsersQuery = z.infer<typeof platformUsersQuerySchema>;
