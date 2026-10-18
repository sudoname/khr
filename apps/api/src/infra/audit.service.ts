import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@peopleflow/database';
import { AppContext } from '../context/app-context';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: AppContext,
  ) {}

  /** Best-effort audit write; failures are logged, never thrown. */
  async log(
    action: string,
    opts: {
      entity?: string;
      entityId?: string;
      meta?: Prisma.InputJsonValue;
      companyId?: string | null;
      userId?: string | null;
    } = {},
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          entity: opts.entity,
          entityId: opts.entityId,
          meta: opts.meta,
          companyId: opts.companyId !== undefined ? opts.companyId : this.ctx.companyIdOrNull,
          userId: opts.userId !== undefined ? opts.userId : this.ctx.userIdOrNull,
          ip: this.ctx.ip,
        },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${action}: ${(err as Error).message}`);
    }
  }
}
