import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

interface DepartmentInput {
  name?: string;
  parentId?: string;
  headEmployeeId?: string;
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  async list() {
    const departments = await this.db.department.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: { where: { deletedAt: null, status: { not: 'TERMINATED' } } } } } },
    });
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      headEmployeeId: d.headEmployeeId,
      employeeCount: d._count.employees,
    }));
  }

  async create(input: DepartmentInput) {
    await this.validateRefs(input);
    const dept = await this.db.department.create({
      data: {
        companyId: this.ctx.companyId,
        name: input.name!,
        parentId: input.parentId || null,
        headEmployeeId: input.headEmployeeId || null,
      },
    });
    await this.audit.log('department.created', { entity: 'Department', entityId: dept.id, meta: { name: dept.name } });
    return dept;
  }

  async update(id: string, input: DepartmentInput) {
    const existing = await this.db.department.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Department not found');
    await this.validateRefs(input, id);
    const dept = await this.db.department.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
        ...(input.headEmployeeId !== undefined ? { headEmployeeId: input.headEmployeeId || null } : {}),
      },
    });
    await this.audit.log('department.updated', { entity: 'Department', entityId: id, meta: input as never });
    return dept;
  }

  async remove(id: string) {
    const existing = await this.db.department.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Department not found');
    const employeeCount = await this.db.employee.count({
      where: { departmentId: id, deletedAt: null, status: { not: 'TERMINATED' } },
    });
    if (employeeCount > 0) {
      throw new BadRequestException('Reassign employees before deleting this department');
    }
    await this.db.department.update({ where: { id }, data: { deletedAt: new Date(), parentId: null } });
    await this.db.department.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await this.audit.log('department.deleted', { entity: 'Department', entityId: id });
    return { message: 'Department removed' };
  }

  /** Validates parent/head references exist in-tenant and prevents cycles in the department tree. */
  private async validateRefs(input: DepartmentInput, selfId?: string) {
    if (input.parentId) {
      if (selfId && input.parentId === selfId) throw new BadRequestException('A department cannot be its own parent');
      const parent = await this.db.department.findFirst({ where: { id: input.parentId, deletedAt: null } });
      if (!parent) throw new BadRequestException('Parent department not found');
      if (selfId) {
        // walk up from the proposed parent; reject if we encounter self
        let cursor: string | null = parent.parentId;
        for (let depth = 0; cursor && depth < 100; depth++) {
          if (cursor === selfId) throw new BadRequestException('This change would create a department cycle');
          const next: { parentId: string | null } | null = await this.db.department.findFirst({
            where: { id: cursor },
            select: { parentId: true },
          });
          cursor = next?.parentId ?? null;
        }
      }
    }
    if (input.headEmployeeId) {
      const head = await this.db.employee.findFirst({ where: { id: input.headEmployeeId, deletedAt: null } });
      if (!head) throw new BadRequestException('Department head employee not found');
    }
  }
}
