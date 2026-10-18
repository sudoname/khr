import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  payrollRejectSchema,
  payrollRunCreateSchema,
  payrollSettingsSchema,
  payrollTaxApprovalSchema,
} from '@peopleflow/types';
import type {
  PayrollRunCreateInput,
  PayrollSettingsInput,
  PayrollTaxApprovalInput,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PayrollService } from './payroll.service';

@ApiTags('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // ───────── settings ─────────

  @RequirePermission('payroll.manage')
  @Get('settings')
  getSettings() {
    return this.payroll.getSettings();
  }

  @RequirePermission('payroll.manage')
  @Put('settings')
  updateSettings(@Body(new ZodPipe(payrollSettingsSchema)) body: PayrollSettingsInput) {
    return this.payroll.updateSettings(body);
  }

  @RequirePermission('payroll.manage')
  @Get('tax-status')
  taxStatus(@Query('year') year?: string, @Query('month') month?: string) {
    const y = year ? Number(year) : undefined;
    const m = month ? Number(month) : undefined;
    return this.payroll.taxStatus(
      Number.isInteger(y) ? y : undefined,
      Number.isInteger(m) ? m : undefined,
    );
  }

  @RequirePermission('payroll.approve')
  @Post('settings/approve-tax-rules')
  approveTaxRules(@Body(new ZodPipe(payrollTaxApprovalSchema)) body: PayrollTaxApprovalInput) {
    return this.payroll.approveTaxRules(body.version);
  }

  // ───────── self-service ─────────

  @RequirePermission('payroll.read.self')
  @Get('payslips/me')
  myPayslips() {
    return this.payroll.myPayslips();
  }

  // ───────── runs ─────────

  @RequirePermission('payroll.manage')
  @Get('runs')
  listRuns() {
    return this.payroll.listRuns();
  }

  @RequirePermission('payroll.manage')
  @Post('runs')
  createRun(@Body(new ZodPipe(payrollRunCreateSchema)) body: PayrollRunCreateInput) {
    return this.payroll.createRun(body);
  }

  @RequirePermission('payroll.manage')
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.payroll.getRun(id);
  }

  @RequirePermission('payroll.manage')
  @Post('runs/:id/recompute')
  recompute(@Param('id') id: string) {
    return this.payroll.compute(id);
  }

  @RequirePermission('payroll.manage')
  @Post('runs/:id/submit')
  submit(@Param('id') id: string) {
    return this.payroll.submit(id);
  }

  @RequirePermission('payroll.approve')
  @Post('runs/:id/approve')
  approve(@Param('id') id: string) {
    return this.payroll.approve(id);
  }

  @RequirePermission('payroll.approve')
  @Post('runs/:id/reject')
  reject(@Param('id') id: string, @Body(new ZodPipe(payrollRejectSchema)) body: { note: string }) {
    return this.payroll.reject(id, body.note);
  }

  @RequirePermission('payroll.approve')
  @Post('runs/:id/mark-paid')
  markPaid(@Param('id') id: string) {
    return this.payroll.markPaid(id);
  }

  @RequirePermission('payroll.manage')
  @Get('runs/:id/bank-schedule')
  async bankSchedule(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { csv, filename } = await this.payroll.bankScheduleCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
