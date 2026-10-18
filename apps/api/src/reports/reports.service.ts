import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { csvSafe } from '../common/csv';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── headcount ───────────────────────────

  async headcount() {
    const [byStatus, byType, departments, employees] = await Promise.all([
      this.db.employee.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.db.employee.groupBy({ by: ['employmentType'], where: { deletedAt: null }, _count: { _all: true } }),
      this.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      this.db.employee.findMany({
        where: { deletedAt: null },
        select: { departmentId: true, hireDate: true, terminationDate: true, status: true },
      }),
    ]);

    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const byDepartment = new Map<string, number>();
    for (const e of employees) {
      const key = e.departmentId ? (deptName.get(e.departmentId) ?? 'Unknown') : 'Unassigned';
      byDepartment.set(key, (byDepartment.get(key) ?? 0) + 1);
    }

    // Hires / exits over the trailing 12 months.
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
    }
    const hires = new Map<string, number>(months.map((m) => [m, 0]));
    const exits = new Map<string, number>(months.map((m) => [m, 0]));
    for (const e of employees) {
      const h = monthKey(e.hireDate);
      if (hires.has(h)) hires.set(h, (hires.get(h) ?? 0) + 1);
      if (e.terminationDate) {
        const x = monthKey(e.terminationDate);
        if (exits.has(x)) exits.set(x, (exits.get(x) ?? 0) + 1);
      }
    }

    return {
      total: employees.length,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byEmploymentType: byType.map((t) => ({ employmentType: t.employmentType, count: t._count._all })),
      byDepartment: [...byDepartment.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      trend: months.map((m) => ({ month: m, hires: hires.get(m) ?? 0, exits: exits.get(m) ?? 0 })),
    };
  }

  async headcountCsv(): Promise<string> {
    const employees = await this.db.employee.findMany({
      where: { deletedAt: null },
      select: {
        employeeNo: true,
        firstName: true,
        lastName: true,
        status: true,
        employmentType: true,
        jobTitle: true,
        hireDate: true,
        department: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { employeeNo: 'asc' },
    });
    await this.audit.log('report.exported', { entity: 'Report', meta: { report: 'headcount', rows: employees.length } });
    return stringify(
      employees.map((e) => ({
        employeeNo: csvSafe(e.employeeNo),
        firstName: csvSafe(e.firstName),
        lastName: csvSafe(e.lastName),
        status: e.status,
        employmentType: e.employmentType,
        jobTitle: csvSafe(e.jobTitle),
        hireDate: e.hireDate.toISOString().slice(0, 10),
        department: csvSafe(e.department?.name),
        location: csvSafe(e.location?.name),
      })),
      { header: true },
    );
  }

  // ─────────────────────────── leave ───────────────────────────

  async leave(year: number) {
    const balances = await this.db.leaveBalance.findMany({
      where: { year },
      select: {
        entitledDays: true,
        carriedOverDays: true,
        adjustmentDays: true,
        usedDays: true,
        leaveType: { select: { id: true, name: true, code: true } },
      },
    });
    const byType = new Map<string, { name: string; code: string; entitled: number; used: number; available: number; employees: number }>();
    for (const b of balances) {
      const entry = byType.get(b.leaveType.id) ?? {
        name: b.leaveType.name,
        code: b.leaveType.code,
        entitled: 0,
        used: 0,
        available: 0,
        employees: 0,
      };
      const entitled = Number(b.entitledDays) + Number(b.carriedOverDays) + Number(b.adjustmentDays);
      entry.entitled += entitled;
      entry.used += Number(b.usedDays);
      entry.available += entitled - Number(b.usedDays);
      entry.employees += 1;
      byType.set(b.leaveType.id, entry);
    }
    const pending = await this.db.leaveRequest.count({ where: { status: 'PENDING' } });
    return { year, pendingRequests: pending, byType: [...byType.values()] };
  }

  async leaveCsv(year: number): Promise<string> {
    const balances = await this.db.leaveBalance.findMany({
      where: { year },
      select: {
        entitledDays: true,
        carriedOverDays: true,
        adjustmentDays: true,
        usedDays: true,
        leaveType: { select: { name: true, code: true } },
        employee: { select: { employeeNo: true, firstName: true, lastName: true } },
      },
      orderBy: [{ employeeId: 'asc' }],
    });
    await this.audit.log('report.exported', { entity: 'Report', meta: { report: 'leave', year, rows: balances.length } });
    return stringify(
      balances.map((b) => {
        const entitled = Number(b.entitledDays) + Number(b.carriedOverDays) + Number(b.adjustmentDays);
        return {
          employeeNo: csvSafe(b.employee.employeeNo),
          firstName: csvSafe(b.employee.firstName),
          lastName: csvSafe(b.employee.lastName),
          leaveType: csvSafe(b.leaveType.name),
          code: csvSafe(b.leaveType.code),
          entitledDays: entitled.toFixed(2),
          usedDays: Number(b.usedDays).toFixed(2),
          availableDays: (entitled - Number(b.usedDays)).toFixed(2),
        };
      }),
      { header: true },
    );
  }

  // ─────────────────────────── attendance ───────────────────────────

  async attendance(from: string, to: string) {
    const records = await this.db.attendanceRecord.findMany({
      where: {
        day: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
      select: {
        late: true,
        clockOutAt: true,
        employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } },
      },
    });
    const byEmployee = new Map<string, { employeeNo: string; name: string; daysPresent: number; lateDays: number }>();
    for (const r of records) {
      const entry = byEmployee.get(r.employee.id) ?? {
        employeeNo: r.employee.employeeNo,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        daysPresent: 0,
        lateDays: 0,
      };
      entry.daysPresent += 1;
      if (r.late) entry.lateDays += 1;
      byEmployee.set(r.employee.id, entry);
    }
    return {
      from,
      to,
      totalRecords: records.length,
      lateTotal: records.filter((r) => r.late).length,
      byEmployee: [...byEmployee.values()].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo)),
    };
  }

  async attendanceCsv(from: string, to: string): Promise<string> {
    const report = await this.attendance(from, to);
    await this.audit.log('report.exported', {
      entity: 'Report',
      meta: { report: 'attendance', from, to, rows: report.byEmployee.length },
    });
    return stringify(
      report.byEmployee.map((e) => ({
        employeeNo: csvSafe(e.employeeNo),
        name: csvSafe(e.name),
        daysPresent: e.daysPresent,
        lateDays: e.lateDays,
      })),
      { header: true },
    );
  }

  // ─────────────────────────── payroll ───────────────────────────

  async payroll(year: number) {
    const runs = await this.db.payrollRun.findMany({
      where: { year },
      select: {
        id: true,
        month: true,
        status: true,
        totalGross: true,
        totalPaye: true,
        totalPensionEmployee: true,
        totalPensionEmployer: true,
        totalNhf: true,
        totalNhis: true,
        totalNet: true,
        payslips: { select: { id: true } },
      },
      orderBy: { month: 'asc' },
    });
    return {
      year,
      runs: runs.map((r) => ({
        id: r.id,
        month: r.month,
        status: r.status,
        employees: r.payslips.length,
        totalGross: r.totalGross,
        totalPaye: r.totalPaye,
        totalPensionEmployee: r.totalPensionEmployee,
        totalPensionEmployer: r.totalPensionEmployer,
        totalNhf: r.totalNhf,
        totalNhis: r.totalNhis,
        totalNet: r.totalNet,
      })),
    };
  }

  async payrollCsv(year: number): Promise<string> {
    const report = await this.payroll(year);
    await this.audit.log('report.exported', { entity: 'Report', meta: { report: 'payroll', year, rows: report.runs.length } });
    return stringify(
      report.runs.map((r) => ({
        month: r.month,
        status: r.status,
        employees: r.employees,
        totalGross: String(r.totalGross),
        totalPaye: String(r.totalPaye),
        totalPensionEmployee: String(r.totalPensionEmployee),
        totalPensionEmployer: String(r.totalPensionEmployer),
        totalNhf: String(r.totalNhf),
        totalNhis: String(r.totalNhis),
        totalNet: String(r.totalNet),
      })),
      { header: true },
    );
  }
}
