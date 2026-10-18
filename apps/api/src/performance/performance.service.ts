import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GoalCreateInput,
  GoalUpdateInput,
  ReviewCycleCreateInput,
  ReviewUpsertInput,
} from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const opt = (v?: string) => (v && v.trim() !== '' ? v : undefined);

const EMPLOYEE_SELECT = { select: { id: true, firstName: true, lastName: true, employeeNo: true } } as const;

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── cycles ───────────────────────────

  async listCycles() {
    return this.db.reviewCycle.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { goals: true, reviews: true } } },
    });
  }

  async createCycle(input: ReviewCycleCreateInput) {
    const duplicate = await this.db.reviewCycle.findFirst({ where: { name: input.name } });
    if (duplicate) throw new ConflictException('A cycle with this name already exists');
    const cycle = await this.db.reviewCycle.create({
      data: {
        companyId: this.ctx.companyId,
        name: input.name,
        startDate: new Date(`${input.startDate}T00:00:00.000Z`),
        endDate: new Date(`${input.endDate}T00:00:00.000Z`),
      },
    });
    await this.audit.log('performance.cycle_created', { entity: 'ReviewCycle', entityId: cycle.id, meta: { name: input.name } });
    return cycle;
  }

  async setCycleStatus(id: string, status: 'DRAFT' | 'ACTIVE' | 'CLOSED') {
    const cycle = await this.db.reviewCycle.findFirst({ where: { id } });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    const updated = await this.db.reviewCycle.update({ where: { id }, data: { status } });
    await this.audit.log('performance.cycle_status_changed', {
      entity: 'ReviewCycle',
      entityId: id,
      meta: { from: cycle.status, to: status },
    });
    return updated;
  }

  // ─────────────────────────── goals ───────────────────────────

  /** `performance.manage` sees all goals; others see their own. */
  async listGoals(query: { cycleId?: string; employeeId?: string }) {
    const selfId = this.ctx.employeeIdOrNull;
    const scope = this.ctx.can('performance.manage')
      ? query.employeeId
        ? { employeeId: query.employeeId }
        : {}
      : { employeeId: selfId ?? '__none__' };
    return this.db.goal.findMany({
      where: { ...scope, ...(query.cycleId ? { cycleId: query.cycleId } : {}) },
      include: { employee: EMPLOYEE_SELECT, cycle: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async createGoal(input: GoalCreateInput) {
    const cycle = await this.db.reviewCycle.findFirst({ where: { id: input.cycleId } });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status === 'CLOSED') throw new ConflictException('This cycle is closed');

    const selfId = this.ctx.employeeIdOrNull;
    const targetId = opt(input.employeeId) ?? selfId;
    if (!targetId) throw new BadRequestException('No employee record linked to your membership');
    if (targetId !== selfId && !this.ctx.can('performance.manage'))
      throw new ForbiddenException('You can only create goals for yourself');

    const employee = await this.db.employee.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');

    const goal = await this.db.goal.create({
      data: {
        companyId: this.ctx.companyId,
        cycleId: cycle.id,
        employeeId: targetId,
        title: input.title,
        description: opt(input.description) ?? null,
        weight: input.weight,
        createdById: this.ctx.userIdOrNull,
      },
    });
    await this.audit.log('performance.goal_created', { entity: 'Goal', entityId: goal.id, meta: { cycleId: cycle.id, employeeId: targetId } });
    return goal;
  }

  async updateGoal(id: string, input: GoalUpdateInput) {
    const goal = await this.db.goal.findFirst({ where: { id } });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.employeeId !== this.ctx.employeeIdOrNull && !this.ctx.can('performance.manage'))
      throw new ForbiddenException('You can only update your own goals');

    const updated = await this.db.goal.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: opt(input.description) ?? null } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
      },
    });
    await this.audit.log('performance.goal_updated', { entity: 'Goal', entityId: id });
    return updated;
  }

  // ─────────────────────────── reviews ───────────────────────────

  /**
   * Visibility: `performance.manage` sees everything; a reviewer sees reviews
   * they wrote; an employee sees their own reviews once submitted (drafts
   * stay private to the reviewer).
   */
  async listReviews(query: { cycleId?: string }) {
    const cycleFilter = query.cycleId ? { cycleId: query.cycleId } : {};
    if (this.ctx.can('performance.manage')) {
      return this.db.performanceReview.findMany({
        where: cycleFilter,
        include: { employee: EMPLOYEE_SELECT, cycle: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      });
    }
    const selfEmployeeId = this.ctx.employeeIdOrNull;
    const selfUserId = this.ctx.userIdOrNull;
    return this.db.performanceReview.findMany({
      where: {
        ...cycleFilter,
        OR: [
          ...(selfUserId ? [{ reviewerUserId: selfUserId }] : []),
          ...(selfEmployeeId
            ? [{ employeeId: selfEmployeeId, status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] as never[] } }]
            : []),
        ],
      },
      include: { employee: EMPLOYEE_SELECT, cycle: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
  }

  /** Create or update the actor's review of an employee for a cycle. */
  async upsertReview(input: ReviewUpsertInput) {
    const cycle = await this.db.reviewCycle.findFirst({ where: { id: input.cycleId } });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status === 'CLOSED') throw new ConflictException('This cycle is closed');

    const employee = await this.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (input.employeeId === this.ctx.employeeIdOrNull)
      throw new ForbiddenException('You cannot review yourself');
    if (!this.ctx.can('performance.manage') && !(await this.managesEmployee(input.employeeId)))
      throw new ForbiddenException('You can only review employees in your reporting chain');

    const existing = await this.db.performanceReview.findFirst({
      where: { cycleId: input.cycleId, employeeId: input.employeeId },
    });
    if (existing && existing.status !== 'DRAFT')
      throw new ConflictException('This review has already been submitted');
    if (existing && existing.reviewerUserId && existing.reviewerUserId !== this.ctx.userIdOrNull)
      throw new ConflictException('Another reviewer owns this review');

    const data = {
      reviewerUserId: this.ctx.userIdOrNull,
      rating: input.rating,
      strengths: opt(input.strengths) ?? null,
      improvements: opt(input.improvements) ?? null,
      comment: opt(input.comment) ?? null,
      ...(input.submit ? { status: 'SUBMITTED' as const, submittedAt: new Date() } : {}),
    };
    const review = existing
      ? await this.db.performanceReview.update({ where: { id: existing.id }, data })
      : await this.db.performanceReview.create({
          data: { companyId: this.ctx.companyId, cycleId: input.cycleId, employeeId: input.employeeId, ...data },
        });

    await this.audit.log(input.submit ? 'performance.review_submitted' : 'performance.review_saved', {
      entity: 'PerformanceReview',
      entityId: review.id,
      meta: { cycleId: input.cycleId, employeeId: input.employeeId, rating: input.rating },
    });
    return review;
  }

  async acknowledge(id: string) {
    const review = await this.db.performanceReview.findFirst({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.employeeId !== this.ctx.employeeIdOrNull)
      throw new ForbiddenException('You can only acknowledge your own review');
    if (review.status !== 'SUBMITTED') throw new ConflictException('Only submitted reviews can be acknowledged');

    const updated = await this.db.performanceReview.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    await this.audit.log('performance.review_acknowledged', { entity: 'PerformanceReview', entityId: id });
    return updated;
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
