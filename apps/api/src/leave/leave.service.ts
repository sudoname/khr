import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveRequestCreateInput } from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { computeLeaveDays } from './leave-days.util';

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── types & policies ───────────────────────────

  listTypes() {
    return this.db.leaveType.findMany({
      where: { deletedAt: null },
      include: { policies: true },
      orderBy: { name: 'asc' },
    });
  }

  async createType(input: { name: string; code: string; paid: boolean; allowHalfDay: boolean; color?: string }) {
    const duplicate = await this.db.leaveType.findFirst({ where: { code: input.code, deletedAt: null } });
    if (duplicate) throw new ConflictException('A leave type with this code already exists');
    const type = await this.db.leaveType.create({
      data: {
        companyId: this.ctx.companyId,
        name: input.name,
        code: input.code,
        paid: input.paid,
        allowHalfDay: input.allowHalfDay,
        color: input.color || null,
      },
    });
    await this.audit.log('leave.type_created', { entity: 'LeaveType', entityId: type.id, meta: { code: type.code } });
    return type;
  }

  async updateType(id: string, input: { name?: string; code?: string; paid?: boolean; allowHalfDay?: boolean; color?: string }) {
    const existing = await this.db.leaveType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Leave type not found');
    if (input.code && input.code !== existing.code) {
      const duplicate = await this.db.leaveType.findFirst({ where: { code: input.code, deletedAt: null, id: { not: id } } });
      if (duplicate) throw new ConflictException('A leave type with this code already exists');
    }
    const type = await this.db.leaveType.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.paid !== undefined ? { paid: input.paid } : {}),
        ...(input.allowHalfDay !== undefined ? { allowHalfDay: input.allowHalfDay } : {}),
        ...(input.color !== undefined ? { color: input.color || null } : {}),
      },
    });
    await this.audit.log('leave.type_updated', { entity: 'LeaveType', entityId: id });
    return type;
  }

  async upsertPolicy(input: {
    leaveTypeId: string;
    accrualMethod: 'ANNUAL_GRANT' | 'MONTHLY_ACCRUAL' | 'NONE';
    annualEntitlementDays: number;
    maxCarryoverDays: number;
    approvalLevels: number;
  }) {
    const type = await this.db.leaveType.findFirst({ where: { id: input.leaveTypeId, deletedAt: null } });
    if (!type) throw new NotFoundException('Leave type not found');
    const existing = await this.db.leavePolicy.findFirst({ where: { leaveTypeId: input.leaveTypeId } });
    const data = {
      accrualMethod: input.accrualMethod,
      annualEntitlementDays: input.annualEntitlementDays,
      maxCarryoverDays: input.maxCarryoverDays,
      approvalLevels: input.approvalLevels,
    };
    const policy = existing
      ? await this.db.leavePolicy.update({ where: { id: existing.id }, data })
      : await this.db.leavePolicy.create({
          data: { companyId: this.ctx.companyId, leaveTypeId: input.leaveTypeId, ...data },
        });
    await this.audit.log('leave.policy_upserted', { entity: 'LeavePolicy', entityId: policy.id, meta: { leaveTypeId: input.leaveTypeId } });
    return policy;
  }

  // ─────────────────────────── holidays ───────────────────────────

  listHolidays(year?: number) {
    const y = year ?? new Date().getUTCFullYear();
    return this.db.holiday.findMany({
      where: { date: { gte: toDate(`${y}-01-01`), lte: toDate(`${y}-12-31`) } },
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(input: { name: string; date: string }) {
    const holiday = await this.db.holiday.create({
      data: { companyId: this.ctx.companyId, name: input.name, date: toDate(input.date) },
    });
    await this.audit.log('leave.holiday_created', { entity: 'Holiday', entityId: holiday.id, meta: { date: input.date } });
    return holiday;
  }

  async removeHoliday(id: string) {
    const existing = await this.db.holiday.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Holiday not found');
    await this.db.holiday.delete({ where: { id } });
    await this.audit.log('leave.holiday_deleted', { entity: 'Holiday', entityId: id });
    return { message: 'Holiday removed' };
  }

  // ─────────────────────────── balances ───────────────────────────

  private async ensureBalance(employeeId: string, leaveTypeId: string, year: number) {
    const existing = await this.db.leaveBalance.findFirst({ where: { employeeId, leaveTypeId, year } });
    if (existing) return existing;
    const policy = await this.db.leavePolicy.findFirst({ where: { leaveTypeId } });
    return this.db.leaveBalance.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        leaveTypeId,
        year,
        entitledDays: policy ? policy.annualEntitlementDays : 0,
      },
    });
  }

  async balancesFor(employeeId: string, year?: number) {
    const y = year ?? new Date().getUTCFullYear();
    const employee = await this.db.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    const types = await this.db.leaveType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
    const balances = [];
    for (const type of types) {
      const b = await this.ensureBalance(employeeId, type.id, y);
      const available =
        Number(b.entitledDays) + Number(b.carriedOverDays) + Number(b.adjustmentDays) - Number(b.usedDays);
      balances.push({
        leaveTypeId: type.id,
        leaveType: { id: type.id, name: type.name, code: type.code, paid: type.paid, color: type.color },
        year: y,
        entitledDays: Number(b.entitledDays),
        carriedOverDays: Number(b.carriedOverDays),
        adjustmentDays: Number(b.adjustmentDays),
        usedDays: Number(b.usedDays),
        availableDays: available,
      });
    }
    return balances;
  }

  async myBalances(year?: number) {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new NotFoundException('No employee record linked to your membership');
    return this.balancesFor(employeeId, year);
  }

  async adjustBalance(input: { employeeId: string; leaveTypeId: string; year: number; deltaDays: number; reason: string }) {
    const employee = await this.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    const type = await this.db.leaveType.findFirst({ where: { id: input.leaveTypeId, deletedAt: null } });
    if (!type) throw new NotFoundException('Leave type not found');
    const balance = await this.ensureBalance(input.employeeId, input.leaveTypeId, input.year);
    const updated = await this.db.leaveBalance.update({
      where: { id: balance.id },
      data: { adjustmentDays: { increment: input.deltaDays } },
    });
    await this.audit.log('leave.balance_adjusted', {
      entity: 'LeaveBalance',
      entityId: balance.id,
      meta: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, deltaDays: input.deltaDays, reason: input.reason },
    });
    return updated;
  }

  // ─────────────────────────── requests ───────────────────────────

  private async workDaysAndHolidays(start: Date, end: Date) {
    const [policy, holidays] = await Promise.all([
      this.db.attendancePolicy.findFirst({}),
      this.db.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } }),
    ]);
    return {
      workDays: policy?.workDays?.length ? policy.workDays : [1, 2, 3, 4, 5],
      holidaySet: new Set(holidays.map((h) => isoDay(h.date))),
    };
  }

  /** True when the actor's employee record is an ancestor in `employeeId`'s reporting chain. */
  private async managesEmployee(employeeId: string): Promise<boolean> {
    const selfId = this.ctx.employeeIdOrNull;
    if (!selfId) return false;
    let cursor: string | null = employeeId;
    for (let depth = 0; depth < 50; depth++) {
      const row: { managerId: string | null } | null = await this.db.employee.findFirst({
        where: { id: cursor as string },
        select: { managerId: true },
      });
      cursor = row?.managerId ?? null;
      if (!cursor) return false;
      if (cursor === selfId) return true;
    }
    return false;
  }

  async createRequest(input: LeaveRequestCreateInput) {
    const selfEmployeeId = this.ctx.employeeIdOrNull;
    const employeeId = input.employeeId || selfEmployeeId;
    if (!employeeId) throw new BadRequestException('No employee record linked to your membership');
    if (employeeId !== selfEmployeeId) this.ctx.require('leave.request.any');

    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null, status: { not: 'TERMINATED' } },
      select: { id: true, managerId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found or inactive');

    const type = await this.db.leaveType.findFirst({
      where: { id: input.leaveTypeId, deletedAt: null },
      include: { policies: true },
    });
    if (!type) throw new NotFoundException('Leave type not found');
    const policy = type.policies[0];

    const start = toDate(input.startDate);
    const end = toDate(input.endDate);
    if (end < start) throw new BadRequestException('endDate must be on or after startDate');
    if ((input.startHalfDay || input.endHalfDay) && !type.allowHalfDay)
      throw new BadRequestException('Half days are not allowed for this leave type');

    const { workDays, holidaySet } = await this.workDaysAndHolidays(start, end);
    const totalDays = computeLeaveDays(start, end, workDays, holidaySet, input.startHalfDay, input.endHalfDay);
    if (totalDays <= 0) throw new BadRequestException('The selected range contains no working days');

    const overlap = await this.db.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap) throw new ConflictException('An overlapping leave request already exists');

    if (type.paid) {
      const balance = await this.ensureBalance(employeeId, type.id, start.getUTCFullYear());
      const available =
        Number(balance.entitledDays) + Number(balance.carriedOverDays) + Number(balance.adjustmentDays) - Number(balance.usedDays);
      if (totalDays > available)
        throw new BadRequestException(`Insufficient balance: ${available} day(s) available, ${totalDays} requested`);
    }

    const approvalLevels = policy?.approvalLevels ?? 1;
    const request = await this.db.leaveRequest.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        leaveTypeId: type.id,
        startDate: start,
        endDate: end,
        startHalfDay: input.startHalfDay,
        endHalfDay: input.endHalfDay,
        totalDays,
        reason: input.reason || null,
        status: 'PENDING',
        currentLevel: 1,
        requestedById: this.ctx.userIdOrNull,
      },
    });
    for (let level = 1; level <= approvalLevels; level++) {
      await this.db.leaveApproval.create({
        data: { companyId: this.ctx.companyId, leaveRequestId: request.id, level },
      });
    }
    await this.audit.log('leave.requested', {
      entity: 'LeaveRequest',
      entityId: request.id,
      meta: { employeeId, leaveTypeId: type.id, totalDays },
    });
    return this.getRequest(request.id);
  }

  private requestInclude() {
    return {
      leaveType: { select: { id: true, name: true, code: true, paid: true, color: true } },
      employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, departmentId: true } },
      approvals: { orderBy: { level: 'asc' as const } },
    };
  }

  async getRequest(id: string) {
    const request = await this.db.leaveRequest.findFirst({ where: { id }, include: this.requestInclude() });
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }

  /** Request detail, visible only to the owner, chain managers, or `leave.read.all` holders. */
  async getRequestForActor(id: string) {
    const request = await this.getRequest(id);
    if (request.employee.id === this.ctx.employeeIdOrNull) return request;
    if (this.ctx.can('leave.read.all')) return request;
    if (this.ctx.can('leave.approve') && (await this.managesEmployee(request.employee.id))) return request;
    throw new ForbiddenException('Not allowed to view this leave request');
  }

  async myRequests() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) return [];
    return this.db.leaveRequest.findMany({
      where: { employeeId },
      include: this.requestInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Pending requests the current actor is allowed to decide. */
  async pendingApprovals() {
    const pending = await this.db.leaveRequest.findMany({
      where: { status: 'PENDING' },
      include: this.requestInclude(),
      orderBy: { createdAt: 'asc' },
    });
    if (this.ctx.can('leave.read.all')) {
      return pending.filter((r) => r.employee.id !== this.ctx.employeeIdOrNull);
    }
    // Managers without company-wide read only see their reporting chain.
    const visible = [];
    for (const request of pending) {
      if (request.employee.id === this.ctx.employeeIdOrNull) continue;
      if (await this.managesEmployee(request.employee.id)) visible.push(request);
    }
    return visible;
  }

  async listAll(status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    return this.db.leaveRequest.findMany({
      where: { ...(status ? { status } : {}) },
      include: this.requestInclude(),
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async decide(id: string, input: { decision: 'APPROVED' | 'REJECTED'; note?: string }) {
    const request = await this.getRequest(id);
    if (request.status !== 'PENDING') throw new ConflictException('This request has already been decided');
    if (request.employee.id === this.ctx.employeeIdOrNull)
      throw new ForbiddenException('You cannot decide your own leave request');
    if (!this.ctx.can('leave.read.all') && !(await this.managesEmployee(request.employee.id)))
      throw new ForbiddenException('You can only decide requests from your reporting chain');

    const approval = request.approvals.find((a) => a.level === request.currentLevel);
    if (!approval) throw new ConflictException('Approval step missing for this request');
    const now = new Date();

    await this.db.leaveApproval.update({
      where: { id: approval.id },
      data: { decision: input.decision, note: input.note || null, approverUserId: this.ctx.userIdOrNull, decidedAt: now },
    });

    if (input.decision === 'REJECTED') {
      await this.db.leaveRequest.update({ where: { id }, data: { status: 'REJECTED', decidedAt: now } });
      await this.audit.log('leave.rejected', { entity: 'LeaveRequest', entityId: id, meta: { level: request.currentLevel } });
      return this.getRequest(id);
    }

    const totalLevels = request.approvals.length;
    if (request.currentLevel < totalLevels) {
      await this.db.leaveRequest.update({ where: { id }, data: { currentLevel: request.currentLevel + 1 } });
      await this.audit.log('leave.approved_level', { entity: 'LeaveRequest', entityId: id, meta: { level: request.currentLevel } });
      return this.getRequest(id);
    }

    // Final approval: mark approved and deduct the balance atomically.
    await this.db.leaveRequest.update({ where: { id }, data: { status: 'APPROVED', decidedAt: now } });
    if (request.leaveType.paid) {
      const year = request.startDate.getUTCFullYear();
      const balance = await this.ensureBalance(request.employee.id, request.leaveType.id, year);
      await this.db.leaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: { increment: Number(request.totalDays) } },
      });
    }
    await this.audit.log('leave.approved', { entity: 'LeaveRequest', entityId: id, meta: { totalDays: Number(request.totalDays) } });
    return this.getRequest(id);
  }

  async cancel(id: string) {
    const request = await this.getRequest(id);
    const isOwn = request.employee.id === this.ctx.employeeIdOrNull;
    if (!isOwn) this.ctx.require('leave.request.any');
    if (request.status !== 'PENDING' && request.status !== 'APPROVED')
      throw new ConflictException('Only pending or approved requests can be cancelled');

    const wasApproved = request.status === 'APPROVED';
    await this.db.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    if (wasApproved && request.leaveType.paid) {
      const year = request.startDate.getUTCFullYear();
      const balance = await this.ensureBalance(request.employee.id, request.leaveType.id, year);
      await this.db.leaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: { decrement: Number(request.totalDays) } },
      });
    }
    await this.audit.log('leave.cancelled', { entity: 'LeaveRequest', entityId: id, meta: { wasApproved } });
    return this.getRequest(id);
  }

  // ─────────────────────────── calendar ───────────────────────────

  async calendar(from?: string, to?: string) {
    const now = new Date();
    const start = from ? toDate(from) : toDate(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`);
    const end = to ? toDate(to) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));

    let employeeFilter: { departmentId?: string | null } = {};
    if (!this.ctx.can('leave.read.all')) {
      const selfId = this.ctx.employeeIdOrNull;
      if (!selfId) return { from: isoDay(start), to: isoDay(end), entries: [] };
      const self = await this.db.employee.findFirst({ where: { id: selfId }, select: { departmentId: true } });
      employeeFilter = { departmentId: self?.departmentId ?? null };
    }

    const requests = await this.db.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: end },
        endDate: { gte: start },
        employee: { deletedAt: null, ...employeeFilter },
      },
      include: {
        leaveType: { select: { name: true, code: true, color: true } },
        employee: { select: { id: true, firstName: true, lastName: true, departmentId: true } },
      },
      orderBy: { startDate: 'asc' },
    });
    return {
      from: isoDay(start),
      to: isoDay(end),
      entries: requests.map((r) => ({
        id: r.id,
        employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}` },
        leaveType: r.leaveType,
        startDate: isoDay(r.startDate),
        endDate: isoDay(r.endDate),
        totalDays: Number(r.totalDays),
      })),
    };
  }
}
