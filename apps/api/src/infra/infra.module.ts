import { Global, Module } from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';
import { RateLimitService } from './rate-limit.service';
import { redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [PrismaService, redisProvider, QueueService, RateLimitService, AuditService, AppContext],
  exports: [PrismaService, redisProvider, QueueService, RateLimitService, AuditService, AppContext],
})
export class InfraModule {}
