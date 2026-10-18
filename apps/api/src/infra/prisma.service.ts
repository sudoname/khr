import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, tenantClient, TenantClient } from '@peopleflow/database';

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
}
