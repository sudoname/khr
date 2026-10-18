import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attendanceListQuerySchema,
  attendancePolicyUpsertSchema,
  correctionCreateSchema,
  correctionReviewSchema,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // policy
  @RequirePermission('attendance.clock.self')
  @Get('policy')
  policy() {
    return this.attendance.policy();
  }

  @RequirePermission('attendance.policy.manage')
  @Put('policy')
  upsertPolicy(
    @Body(new ZodPipe(attendancePolicyUpsertSchema))
    body: { name: string; workStartTime: string; workEndTime: string; lateGraceMinutes: number; workDays: number[] },
  ) {
    return this.attendance.upsertPolicy(body);
  }

  // clocking
  @RequirePermission('attendance.clock.self')
  @Post('clock-in')
  clockIn() {
    return this.attendance.clockIn();
  }

  @RequirePermission('attendance.clock.self')
  @Post('clock-out')
  clockOut() {
    return this.attendance.clockOut();
  }

  @RequirePermission('attendance.clock.self')
  @Get('today')
  today() {
    return this.attendance.today();
  }

  // records (scoping enforced in the service)
  @RequirePermission('attendance.clock.self')
  @Get('records')
  list(
    @Query(new ZodPipe(attendanceListQuerySchema))
    query: { employeeId?: string; from?: string; to?: string; page: number; pageSize: number },
  ) {
    return this.attendance.list(query);
  }

  // corrections
  @RequirePermission('attendance.correct.request')
  @Post('corrections')
  requestCorrection(
    @Body(new ZodPipe(correctionCreateSchema))
    body: { day: string; proposedClockInAt: string; proposedClockOutAt?: string; reason: string },
  ) {
    return this.attendance.requestCorrection(body);
  }

  @RequirePermission('attendance.correct.request')
  @Get('corrections/me')
  myCorrections() {
    return this.attendance.myCorrections();
  }

  @RequirePermission('attendance.correct.review')
  @Get('corrections/pending')
  pendingCorrections() {
    return this.attendance.pendingCorrections();
  }

  @RequirePermission('attendance.correct.review')
  @Post('corrections/:id/review')
  review(
    @Param('id') id: string,
    @Body(new ZodPipe(correctionReviewSchema)) body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.attendance.review(id, body);
  }
}
