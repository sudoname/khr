import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { JobCreateInput, JobUpdateInput } from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * Company job catalog: each job is a title with its defined responsibilities.
 * Employees link to a job; profiles and the {{responsibilities}} contract
 * placeholder read from here.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  async list() {
    const jobs = await this.db.job.findMany({
      where: { deletedAt: null },
      orderBy: { title: 'asc' },
      include: { _count: { select: { employees: { where: { deletedAt: null, status: { not: 'TERMINATED' } } } } } },
    });
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      description: j.description,
      responsibilities: j.responsibilities as string[],
      employeeCount: j._count.employees,
    }));
  }

  async create(input: JobCreateInput) {
    // The (companyId, title) unique index also covers soft-deleted rows, so
    // re-creating a previously deleted title revives that row instead.
    const existing = await this.db.job.findFirst({ where: { title: input.title } });
    if (existing && !existing.deletedAt) throw new ConflictException('A job with this title already exists');
    const description = input.description || null;
    const job = existing
      ? await this.db.job.update({
          where: { id: existing.id },
          data: { description, responsibilities: input.responsibilities, deletedAt: null },
        })
      : await this.db.job.create({
          data: {
            companyId: this.ctx.companyId,
            title: input.title,
            description,
            responsibilities: input.responsibilities,
          },
        });
    await this.audit.log('job.created', { entity: 'Job', entityId: job.id, meta: { title: job.title } });
    return job;
  }

  async update(id: string, input: JobUpdateInput) {
    const existing = await this.db.job.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Job not found');
    if (input.title && input.title !== existing.title) {
      const duplicate = await this.db.job.findFirst({ where: { title: input.title, id: { not: id } } });
      if (duplicate) throw new ConflictException('A job with this title already exists');
    }
    const job = await this.db.job.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.responsibilities !== undefined ? { responsibilities: input.responsibilities } : {}),
      },
    });
    await this.audit.log('job.updated', { entity: 'Job', entityId: id, meta: { fields: Object.keys(input) } });
    return job;
  }

  async remove(id: string) {
    const existing = await this.db.job.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Job not found');
    const employeeCount = await this.db.employee.count({
      where: { jobId: id, deletedAt: null, status: { not: 'TERMINATED' } },
    });
    if (employeeCount > 0) {
      throw new BadRequestException('Reassign employees before deleting this job');
    }
    await this.db.job.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log('job.deleted', { entity: 'Job', entityId: id, meta: { title: existing.title } });
    return { message: 'Job removed' };
  }
}
