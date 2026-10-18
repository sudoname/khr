import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AuditClient,
  AuthClient,
  PlatformClient,
  PrismaClient,
  TenantClient,
  auditClient,
  authClient,
  platformClient,
  tenantClient,
} from '@peopleflow/database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Returns a client whose queries are forcibly scoped to the given tenant.
   * All tenant-model access in feature services MUST go through this.
   */
  tenant(companyId: string): TenantClient {
    return tenantClient(this, companyId);
  }

  /**
   * Auth-scoped client for pre-tenant flows (session guard, login, company
   * switcher): may read ONLY the given user's own Membership rows.
   */
  auth(userId: string): AuthClient {
    return authClient(this, userId);
  }

  /** Audit-writer scope: INSERT into AuditLog only, no reads. */
  auditWriter(): AuditClient {
    return auditClient(this);
  }

  /**
   * Platform-admin scope: read-only, cross-tenant. Callers MUST be gated by
   * the platform-admin authorization check and audit every use.
   */
  platform(): PlatformClient {
    return platformClient(this);
  }
}
