import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { createsReportingCycle } from './org-cycle';

interface ChartNode {
  id: string;
  employeeNo: string;
  name: string;
  jobTitle: string;
  photoUrl: string | null;
  department: string | null;
  departmentId: string | null;
  managerId: string | null;
  reports: ChartNode[];
}

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  /** Builds the reporting forest in memory from all non-terminated employees. */
  async chart(): Promise<{ roots: ChartNode[]; totalEmployees: number }> {
    const employees = await this.db.employee.findMany({
      where: { deletedAt: null, status: { not: 'TERMINATED' } },
      select: {
        id: true,
        employeeNo: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: true,
        photoUrl: true,
        managerId: true,
        departmentId: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const nodes = new Map<string, ChartNode>();
    for (const e of employees) {
      nodes.set(e.id, {
        id: e.id,
        employeeNo: e.employeeNo,
        name: `${e.preferredName || e.firstName} ${e.lastName}`,
        jobTitle: e.jobTitle,
        photoUrl: e.photoUrl,
        department: e.department?.name ?? null,
        departmentId: e.departmentId,
        managerId: e.managerId,
        reports: [],
      });
    }

    const roots: ChartNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.managerId ? nodes.get(node.managerId) : undefined;
      if (parent) parent.reports.push(node);
      else roots.push(node); // no manager, or manager is terminated/missing
    }
    return { roots, totalEmployees: employees.length };
  }

  async changeManager(employeeId: string, managerId: string | null) {
    const employee = await this.db.employee.findFirst({
      where: { id: employeeId, deletedAt: null, status: { not: 'TERMINATED' } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (managerId) {
      const manager = await this.db.employee.findFirst({
        where: { id: managerId, deletedAt: null, status: { not: 'TERMINATED' } },
      });
      if (!manager) throw new BadRequestException('Unknown or inactive manager');
    }

    const cycle = await createsReportingCycle(employeeId, managerId, async (cursor) => {
      const row = await this.db.employee.findFirst({ where: { id: cursor }, select: { managerId: true } });
      return row?.managerId ?? null;
    });
    if (cycle) throw new BadRequestException('This manager assignment would create a reporting cycle');

    const updated = await this.db.employee.update({ where: { id: employeeId }, data: { managerId } });
    await this.db.employmentEvent.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        type: 'MANAGER_CHANGE',
        effectiveDate: new Date(),
        details: { fromManagerId: employee.managerId, toManagerId: managerId },
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('org.manager_changed', {
      entity: 'Employee',
      entityId: employeeId,
      meta: { fromManagerId: employee.managerId, toManagerId: managerId },
    });
    return { id: updated.id, managerId: updated.managerId };
  }
}
