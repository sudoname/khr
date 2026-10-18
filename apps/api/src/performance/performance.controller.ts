import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  goalCreateSchema,
  goalUpdateSchema,
  reviewCycleCreateSchema,
  reviewCycleStatusSchema,
  reviewUpsertSchema,
} from '@peopleflow/types';
import type {
  GoalCreateInput,
  GoalUpdateInput,
  ReviewCycleCreateInput,
  ReviewUpsertInput,
} from '@peopleflow/types';
import { z } from 'zod';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PerformanceService } from './performance.service';

const goalListQuerySchema = z.object({
  cycleId: z.string().optional(),
  employeeId: z.string().optional(),
});

const reviewListQuerySchema = z.object({
  cycleId: z.string().optional(),
});

@ApiTags('performance')
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  // cycles

  @RequirePermission('performance.read.self')
  @Get('cycles')
  listCycles() {
    return this.performance.listCycles();
  }

  @RequirePermission('performance.manage')
  @Post('cycles')
  createCycle(@Body(new ZodPipe(reviewCycleCreateSchema)) input: ReviewCycleCreateInput) {
    return this.performance.createCycle(input);
  }

  @RequirePermission('performance.manage')
  @Post('cycles/:id/status')
  setCycleStatus(
    @Param('id') id: string,
    @Body(new ZodPipe(reviewCycleStatusSchema)) input: { status: 'DRAFT' | 'ACTIVE' | 'CLOSED' },
  ) {
    return this.performance.setCycleStatus(id, input.status);
  }

  // goals

  @RequirePermission('performance.read.self')
  @Get('goals')
  listGoals(@Query(new ZodPipe(goalListQuerySchema)) query: { cycleId?: string; employeeId?: string }) {
    return this.performance.listGoals(query);
  }

  @RequirePermission('performance.read.self')
  @Post('goals')
  createGoal(@Body(new ZodPipe(goalCreateSchema)) input: GoalCreateInput) {
    return this.performance.createGoal(input);
  }

  @RequirePermission('performance.read.self')
  @Patch('goals/:id')
  updateGoal(@Param('id') id: string, @Body(new ZodPipe(goalUpdateSchema)) input: GoalUpdateInput) {
    return this.performance.updateGoal(id, input);
  }

  // reviews

  @RequirePermission('performance.read.self')
  @Get('reviews')
  listReviews(@Query(new ZodPipe(reviewListQuerySchema)) query: { cycleId?: string }) {
    return this.performance.listReviews(query);
  }

  @RequirePermission('performance.review')
  @Put('reviews')
  upsertReview(@Body(new ZodPipe(reviewUpsertSchema)) input: ReviewUpsertInput) {
    return this.performance.upsertReview(input);
  }

  @RequirePermission('performance.read.self')
  @Post('reviews/:id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.performance.acknowledge(id);
  }
}
