import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Falls back to these when the company has never saved a policy. */
const DEFAULT_POLICY = {
  name: 'Default',
  workStartTime: '09:00',
  workEndTime: '17:00',
  lateGraceMinutes: 10,
  workDays: [1, 2, 3, 4, 5],
};

interface PolicyShape {
  workStartTime: string;
  lateGraceMinutes: number;
  workDays: number[];
}

interface ListQuery {
  employeeId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── policy ───────────────────────────

  async policy() {
    const existing = await this.db.attendancePolicy.findFirst({});
    return existing ?? { ...DEFAULT_POLICY, companyId: this.ctx.companyId, persisted: false };
  }

  async upsertPolicy(input: {
    name: string;
    workStartTime: string;
    workEndTime: string;
    lateGraceMinutes: number;
    workDays: number[];
  }) {
    const policy = await this.db.attendancePolicy.upsert({
      where: { companyId: this.ctx.companyId },
      create: { ...input, companyId: this.ctx.companyId },
      update: { ...input },
    });
    await this.audit.log('attendance.policy_upserted', { entity: 'AttendancePolicy', entityId: policy.id });
    return policy;
  }

  // ─────────────────────────── clock in / out ───────────────────────────

  /**
   * Timestamps are ALWAYS the server clock stored in UTC; the client never
   * supplies times. The "day" bucket is derived from the company timezone so
   * a Lagos employee clocking in at 07:00 local lands on the right date.
   */
  async clockIn() {
    const employeeId = this.requireSelfEmployee();
    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null, status: { notIn: ['TERMINATED', 'SUSPENDED'] } },
      select: { id: true },
    });
    if (!employee) throw new ForbiddenException('Your employee record is not active');

    const now = new Date();
    const tz = await this.companyTimezone();
    const { day } = this.localParts(now, tz);

    const existing = await this.db.attendanceRecord.findFirst({ where: { employeeId, day: toDate(day) } });
    if (existing) throw new ConflictException('Already clocked in today');

    const policy = await this.effectivePolicy();
    const late = this.computeLate(now, tz, policy);

    try {
      const record = await this.db.attendanceRecord.create({
        data: {
          companyId: this.ctx.companyId,
          employeeId,
          day: toDate(day),
          clockInAt: now,
          late,
          source: 'WEB',
          clockInIp: this.ctx.ip ?? null,
        },
      });
      await this.audit.log('attendance.clock_in', { entity: 'AttendanceRecord', entityId: record.id, meta: { day, late } });
      return record;
    } catch (err: unknown) {
      // Unique (employeeId, day) race: two parallel clock-ins.
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('Already clocked in today');
      throw err;
    }
  }

  async clockOut() {
    const employeeId = this.requireSelfEmployee();
    const now = new Date();
    const tz = await this.companyTimezone();
    const { day } = this.localParts(now, tz);

    const record = await this.db.attendanceRecord.findFirst({ where: { employeeId, day: toDate(day) } });
    if (!record) throw new ConflictException('You have not clocked in today');
    if (record.clockOutAt) throw new ConflictException('Already clocked out today');

    const updated = await this.db.attendanceRecord.update({ where: { id: record.id }, data: { clockOutAt: now } });
    await this.audit.log('attendance.clock_out', { entity: 'AttendanceRecord', entityId: record.id, meta: { day } });
    return updated;
  }

  async today() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) return { day: null, record: null };
    const tz = await this.companyTimezone();
    const { day } = this.localParts(new Date(), tz);
    const record = await this.db.attendanceRecord.findFirst({ where: { employeeId, day: toDate(day) } });
    return { day, record };
  }

  // ─────────────────────────── listing ───────────────────────────

  /**
   * Scope rules: `attendance.read.all` sees anyone; otherwise an actor sees
   * themselves, and managers may see employees in their reporting chain.
   */
  async list(query: ListQuery) {
    const selfId = this.ctx.employeeIdOrNull;
    let employeeFilter: { employeeId?: string } = {};

    if (this.ctx.can('attendance.read.all')) {
      if (query.employeeId) employeeFilter = { employeeId: query.employeeId };
    } else {
      const target = query.employeeId ?? selfId;
      if (!target) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      if (target !== selfId && !(await this.managesEmployee(target))) {
        throw new ForbiddenException('You can only view attendance for yourself or your reporting chain');
      }
      employeeFilter = { employeeId: target };
    }

    const where = {
      ...employeeFilter,
      ...(query.from || query.to
        ? {
            day: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.attendanceRecord.findMany({
        where,
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } },
        orderBy: [{ day: 'desc' }, { clockInAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.attendanceRecord.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  // ─────────────────────────── corrections ───────────────────────────

  async requestCorrection(input: { day: string; proposedClockInAt: string; proposedClockOutAt?: string; reason: string }) {
    const employeeId = this.requireSelfEmployee();
    const day = toDate(input.day);
    const clockInAt = new Date(input.proposedClockInAt);
    const clockOutAt = input.proposedClockOutAt ? new Date(input.proposedClockOutAt) : null;
    if (clockOutAt && clockOutAt <= clockInAt)
      throw new BadRequestException('Clock-out must be after clock-in');

    const tz = await this.companyTimezone();
    const { day: todayKey } = this.localParts(new Date(), tz);
    if (input.day > todayKey) throw new BadRequestException('Cannot request a correction for a future day');

    // The proposed clock-in must land on the day being corrected (in the
    // company timezone). Otherwise review() computes lateness from the wrong
    // weekday and the record's day bucket disagrees with its timestamps.
    const { day: proposedDay } = this.localParts(clockInAt, tz);
    if (proposedDay !== input.day)
      throw new BadRequestException('Proposed clock-in must fall on the day being corrected');

    const pending = await this.db.attendanceCorrection.findFirst({
      where: { employeeId, day, status: 'PENDING' },
    });
    if (pending) throw new ConflictException('A pending correction already exists for this day');

    const correction = await this.db.attendanceCorrection.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        day,
        proposedClockInAt: clockInAt,
        proposedClockOutAt: clockOutAt,
        reason: input.reason,
        requestedById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('attendance.correction_requested', {
      entity: 'AttendanceCorrection',
      entityId: correction.id,
      meta: { day: input.day },
    });
    return correction;
  }

  async myCorrections() {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) return [];
    return this.db.attendanceCorrection.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Pending corrections the current actor is allowed to review. */
  async pendingCorrections() {
    const pending = await this.db.attendanceCorrection.findMany({
      where: { status: 'PENDING' },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (this.ctx.can('attendance.read.all')) {
      return pending.filter((c) => c.employeeId !== this.ctx.employeeIdOrNull);
    }
    const visible = [];
    for (const correction of pending) {
      if (correction.employeeId === this.ctx.employeeIdOrNull) continue;
      if (await this.managesEmployee(correction.employeeId)) visible.push(correction);
    }
    return visible;
  }

  async review(id: string, input: { decision: 'APPROVED' | 'REJECTED'; note?: string }) {
    const correction = await this.db.attendanceCorrection.findFirst({ where: { id } });
    if (!correction) throw new NotFoundException('Correction not found');
    if (correction.status !== 'PENDING') throw new ConflictException('This correction has already been reviewed');
    if (correction.employeeId === this.ctx.employeeIdOrNull)
      throw new ForbiddenException('You cannot review your own correction');
    if (!this.ctx.can('attendance.read.all') && !(await this.managesEmployee(correction.employeeId)))
      throw new ForbiddenException('You can only review corrections from your reporting chain');

    const now = new Date();
    const updated = await this.db.attendanceCorrection.update({
      where: { id },
      data: {
        status: input.decision,
        reviewedById: this.ctx.userIdOrNull,
        reviewNote: input.note || null,
        reviewedAt: now,
      },
    });

    if (input.decision === 'APPROVED') {
      const tz = await this.companyTimezone();
      const policy = await this.effectivePolicy();
      const late = this.computeLate(correction.proposedClockInAt, tz, policy);
      const existing = await this.db.attendanceRecord.findFirst({
        where: { employeeId: correction.employeeId, day: correction.day },
      });
      if (existing) {
        await this.db.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            clockInAt: correction.proposedClockInAt,
            clockOutAt: correction.proposedClockOutAt,
            late,
            source: 'CORRECTION',
          },
        });
      } else {
        await this.db.attendanceRecord.create({
          data: {
            companyId: this.ctx.companyId,
            employeeId: correction.employeeId,
            day: correction.day,
            clockInAt: correction.proposedClockInAt,
            clockOutAt: correction.proposedClockOutAt,
            late,
            source: 'CORRECTION',
          },
        });
      }
    }

    await this.audit.log('attendance.correction_reviewed', {
      entity: 'AttendanceCorrection',
      entityId: id,
      meta: { decision: input.decision },
    });
    return updated;
  }

  // ─────────────────────────── helpers ───────────────────────────

  private requireSelfEmployee(): string {
    const employeeId = this.ctx.employeeIdOrNull;
    if (!employeeId) throw new BadRequestException('No employee record linked to your membership');
    return employeeId;
  }

  private async companyTimezone(): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: this.ctx.companyId },
      select: { timezone: true },
    });
    return company?.timezone || 'Africa/Lagos';
  }

  private async effectivePolicy(): Promise<PolicyShape> {
    const policy = await this.db.attendancePolicy.findFirst({});
    return policy ?? DEFAULT_POLICY;
  }

  /** Breaks an instant into the company-local day key, minutes-of-day and ISO weekday. */
  private localParts(instant: Date, timeZone: string): { day: string; minutes: number; isoWeekday: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return {
      day: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: Number(hour) * 60 + Number(get('minute')),
      isoWeekday: WEEKDAYS[get('weekday')] ?? 0,
    };
  }

  private computeLate(instant: Date, timeZone: string, policy: PolicyShape): boolean {
    const { minutes, isoWeekday } = this.localParts(instant, timeZone);
    if (!policy.workDays.includes(isoWeekday)) return false;
    const [h, m] = policy.workStartTime.split(':').map(Number);
    return minutes > h * 60 + m + policy.lateGraceMinutes;
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
}
