import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * Tenant-scoped dashboard counters. Any authenticated member may call it;
   * sections the caller's role cannot see come back as null.
   */
  @Get('overview')
  overview() {
    return this.stats.overview();
  }
}
