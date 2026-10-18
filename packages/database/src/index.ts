export * from '@prisma/client';
export { Prisma, PrismaClient } from '@prisma/client';
export { tenantClient, authClient, auditClient, platformClient, TENANT_MODELS } from './tenant';
export type { TenantClient, AuthClient, AuditClient, PlatformClient } from './tenant';
