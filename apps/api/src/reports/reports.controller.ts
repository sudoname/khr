import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const rangeQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: 'from must be before to', path: ['from'] });

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission('report.read')
  @Get('headcount')
  headcount() {
    return this.reports.headcount();
  }

  @RequirePermission('report.read')
  @Get('headcount.csv')
  async headcountCsv(@Res() res: Response) {
    sendCsv(res, 'headcount.csv', await this.reports.headcountCsv());
  }

  @RequirePermission('report.read')
  @Get('leave')
  leave(@Query(new ZodPipe(yearQuerySchema)) query: { year: number }) {
    return this.reports.leave(query.year);
  }

  @RequirePermission('report.read')
  @Get('leave.csv')
  async leaveCsv(@Query(new ZodPipe(yearQuerySchema)) query: { year: number }, @Res() res: Response) {
    sendCsv(res, `leave-${query.year}.csv`, await this.reports.leaveCsv(query.year));
  }

  @RequirePermission('report.read')
  @Get('attendance')
  attendance(@Query(new ZodPipe(rangeQuerySchema)) query: { from: string; to: string }) {
    return this.reports.attendance(query.from, query.to);
  }

  @RequirePermission('report.read')
  @Get('attendance.csv')
  async attendanceCsv(@Query(new ZodPipe(rangeQuerySchema)) query: { from: string; to: string }, @Res() res: Response) {
    sendCsv(res, `attendance-${query.from}-${query.to}.csv`, await this.reports.attendanceCsv(query.from, query.to));
  }

  @RequirePermission('report.read')
  @Get('payroll')
  payroll(@Query(new ZodPipe(yearQuerySchema)) query: { year: number }) {
    return this.reports.payroll(query.year);
  }

  @RequirePermission('report.read')
  @Get('payroll.csv')
  async payrollCsv(@Query(new ZodPipe(yearQuerySchema)) query: { year: number }, @Res() res: Response) {
    sendCsv(res, `payroll-${query.year}.csv`, await this.reports.payrollCsv(query.year));
  }
}
