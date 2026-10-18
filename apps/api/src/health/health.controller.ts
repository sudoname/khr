import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { Public } from '../common/decorators';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis.provider';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, 'ok' | 'error'> = { database: 'error', redis: 'error' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      /* reported below */
    }
    try {
      if ((await this.redis.ping()) === 'PONG') checks.redis = 'ok';
    } catch {
      /* reported below */
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks, time: new Date().toISOString() };
  }
}
