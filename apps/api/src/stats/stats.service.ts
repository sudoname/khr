import { Injectable } from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { PrismaService } from '../infra/prisma.service';

export interface StatsOverview {
  /** Present only for roles with `employee.read`. */
  headcount: { total: number; active: number; onLeave: number; suspended: number; terminated: number } | null;
  byDepartment: { name: string; count: number }[] | null;
  byStatus: { status: string; count: number }[] | null;
  attendanceToday: { clockedIn: number; late: number } | null;
  /** Present only for roles with `leave.approve`. */
  pendingLeave: number | null;
  /** Present only for roles with `attendance.correct.review`. */
  pendingCorrections: number | null;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  async overview(): Promise<StatsOverview> {
    const canPeople = this.ctx.can('employee.read');
    const canLeave = this.ctx.can('leave.approve');
    const canCorrections = this.ctx.can('attendance.correct.review');

    const [people, pendingLeave, pendingCorrections] = await Promise.all([
      canPeople ? this.peopleStats() : Promise.resolve(null),
      canLeave ? this.db.leaveRequest.count({ where: { status: 'PENDING' } }) : Promise.resolve(null),
      canCorrections
        ? this.db.attendanceCorrection.count({ where: { status: 'PENDING' } })
        : Promise.resolve(null),
    ]);

    return {
      headcount: people?.headcount ?? null,
      byDepartment: people?.byDepartment ?? null,
      byStatus: people?.byStatus ?? null,
      attendanceToday: people?.attendanceToday ?? null,
      pendingLeave,
      pendingCorrections,
    };
  }

  private async peopleStats() {
    const [statusGroups, deptGroups, departments, attendance] = await Promise.all([
      this.db.employee.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.db.employee.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, status: { not: 'TERMINATED' } },
        _count: { _all: true },
      }),
      this.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      this.attendanceToday(),
    ]);

    const count = (status: string) => statusGroups.find((g) => g.status === status)?._count._all ?? 0;
    const headcount = {
      active: count('ACTIVE'),
      onLeave: count('ON_LEAVE'),
      suspended: count('SUSPENDED'),
      terminated: count('TERMINATED'),
      total: statusGroups.reduce((sum, g) => sum + g._count._all, 0),
    };

    const deptNames = new Map(departments.map((d) => [d.id, d.name]));
    const byDepartment = deptGroups
      .map((g) => ({
        name: g.departmentId ? (deptNames.get(g.departmentId) ?? 'Unknown') : 'Unassigned',
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const byStatus = statusGroups
      .map((g) => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    return { headcount, byDepartment, byStatus, attendanceToday: attendance };
  }

  /** Clock-ins for the company-local "today" bucket (same bucketing as the attendance module). */
  private async attendanceToday(): Promise<{ clockedIn: number; late: number }> {
    const company = await this.prisma.company.findUnique({
      where: { id: this.ctx.companyId },
      select: { timezone: true },
    });
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: company?.timezone || 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    const day = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00.000Z`);

    const [clockedIn, late] = await Promise.all([
      this.db.attendanceRecord.count({ where: { day } }),
      this.db.attendanceRecord.count({ where: { day, late: true } }),
    ]);
    return { clockedIn, late };
  }
}
