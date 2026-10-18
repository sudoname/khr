import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  balanceAdjustSchema,
  holidayCreateSchema,
  leaveDecisionSchema,
  leavePolicyUpsertSchema,
  leaveRequestCreateSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
} from '@peopleflow/types';
import type { LeaveRequestCreateInput } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LeaveService } from './leave.service';

@ApiTags('leave')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // types & policies
  @RequirePermission('leave.request.self')
  @Get('types')
  listTypes() {
    return this.leave.listTypes();
  }

  @RequirePermission('leave.policy.manage')
  @Post('types')
  createType(
    @Body(new ZodPipe(leaveTypeCreateSchema))
    body: { name: string; code: string; paid: boolean; allowHalfDay: boolean; color?: string },
  ) {
    return this.leave.createType(body);
  }

  @RequirePermission('leave.policy.manage')
  @Patch('types/:id')
  updateType(
    @Param('id') id: string,
    @Body(new ZodPipe(leaveTypeUpdateSchema))
    body: { name?: string; code?: string; paid?: boolean; allowHalfDay?: boolean; color?: string },
  ) {
    return this.leave.updateType(id, body);
  }

  @RequirePermission('leave.policy.manage')
  @Put('policies')
  upsertPolicy(
    @Body(new ZodPipe(leavePolicyUpsertSchema))
    body: {
      leaveTypeId: string;
      accrualMethod: 'ANNUAL_GRANT' | 'MONTHLY_ACCRUAL' | 'NONE';
      annualEntitlementDays: number;
      maxCarryoverDays: number;
      approvalLevels: number;
    },
  ) {
    return this.leave.upsertPolicy(body);
  }

  // holidays
  @RequirePermission('leave.request.self')
  @Get('holidays')
  listHolidays(@Query('year') year?: string) {
    return this.leave.listHolidays(year ? Number(year) : undefined);
  }

  @RequirePermission('leave.policy.manage')
  @Post('holidays')
  createHoliday(@Body(new ZodPipe(holidayCreateSchema)) body: { name: string; date: string }) {
    return this.leave.createHoliday(body);
  }

  @RequirePermission('leave.policy.manage')
  @Delete('holidays/:id')
  removeHoliday(@Param('id') id: string) {
    return this.leave.removeHoliday(id);
  }

  // balances
  @RequirePermission('leave.request.self')
  @Get('balances/me')
  myBalances(@Query('year') year?: string) {
    return this.leave.myBalances(year ? Number(year) : undefined);
  }

  @RequirePermission('leave.read.all')
  @Get('balances/:employeeId')
  balancesFor(@Param('employeeId') employeeId: string, @Query('year') year?: string) {
    return this.leave.balancesFor(employeeId, year ? Number(year) : undefined);
  }

  @RequirePermission('leave.balance.adjust')
  @Post('balances/adjust')
  adjust(
    @Body(new ZodPipe(balanceAdjustSchema))
    body: { employeeId: string; leaveTypeId: string; year: number; deltaDays: number; reason: string },
  ) {
    return this.leave.adjustBalance(body);
  }

  // requests
  @RequirePermission('leave.request.self')
  @Post('requests')
  createRequest(@Body(new ZodPipe(leaveRequestCreateSchema)) body: LeaveRequestCreateInput) {
    return this.leave.createRequest(body);
  }

  @RequirePermission('leave.request.self')
  @Get('requests/me')
  myRequests() {
    return this.leave.myRequests();
  }

  @RequirePermission('leave.approve')
  @Get('requests/pending')
  pendingApprovals() {
    return this.leave.pendingApprovals();
  }

  @RequirePermission('leave.read.all')
  @Get('requests')
  listAll(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    return this.leave.listAll(status);
  }

  @RequirePermission('leave.request.self')
  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    // Access-checked variant: owner, reporting-chain manager, or leave.read.all.
    return this.leave.getRequestForActor(id);
  }

  @RequirePermission('leave.approve')
  @Post('requests/:id/decision')
  decide(
    @Param('id') id: string,
    @Body(new ZodPipe(leaveDecisionSchema)) body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.leave.decide(id, body);
  }

  @RequirePermission('leave.request.self')
  @Post('requests/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.leave.cancel(id);
  }

  // calendar
  @RequirePermission('leave.request.self')
  @Get('calendar')
  calendar(@Query('from') from?: string, @Query('to') to?: string) {
    return this.leave.calendar(from, to);
  }
}
