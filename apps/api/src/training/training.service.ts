import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CourseCreateInput, CourseUpdateInput, EnrollmentUpdateInput } from '@peopleflow/types';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const opt = (v?: string) => (v && v.trim() !== '' ? v : undefined);

@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  // ─────────────────────────── courses ───────────────────────────

  async listCourses() {
    return this.db.course.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { title: 'asc' },
    });
  }

  async createCourse(input: CourseCreateInput) {
    try {
      const course = await this.db.course.create({
        data: {
          companyId: this.ctx.companyId,
          title: input.title,
          description: opt(input.description) ?? null,
          provider: opt(input.provider) ?? null,
          url: opt(input.url) ?? null,
          durationHours: input.durationHours ?? null,
          mandatory: input.mandatory,
        },
      });
      await this.audit.log('training.course_created', { entity: 'Course', entityId: course.id, meta: { title: input.title } });
      return course;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A course with this title already exists');
      throw e;
    }
  }

  async updateCourse(id: string, input: CourseUpdateInput) {
    const course = await this.db.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    try {
      const updated = await this.db.course.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: opt(input.description) ?? null } : {}),
          ...(input.provider !== undefined ? { provider: opt(input.provider) ?? null } : {}),
          ...(input.url !== undefined ? { url: opt(input.url) ?? null } : {}),
          ...(input.durationHours !== undefined ? { durationHours: input.durationHours } : {}),
          ...(input.mandatory !== undefined ? { mandatory: input.mandatory } : {}),
        },
      });
      await this.audit.log('training.course_updated', { entity: 'Course', entityId: id });
      return updated;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A course with this title already exists');
      throw e;
    }
  }

  async deleteCourse(id: string) {
    const course = await this.db.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    await this.db.course.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log('training.course_deleted', { entity: 'Course', entityId: id });
    return { ok: true };
  }

  // ─────────────────────────── enrollments ───────────────────────────

  /** `training.manage` sees all enrollments; others see their own. */
  async listEnrollments(query: { courseId?: string; employeeId?: string }) {
    const selfId = this.ctx.employeeIdOrNull;
    const scope = this.ctx.can('training.manage')
      ? query.employeeId
        ? { employeeId: query.employeeId }
        : {}
      : { employeeId: selfId ?? '__none__' };
    return this.db.courseEnrollment.findMany({
      where: { ...scope, ...(query.courseId ? { courseId: query.courseId } : {}) },
      include: {
        course: { select: { id: true, title: true, provider: true, mandatory: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
      },
      orderBy: { enrolledAt: 'desc' },
      take: 500,
    });
  }

  async enroll(courseId: string, employeeId?: string) {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');

    const selfId = this.ctx.employeeIdOrNull;
    const targetId = opt(employeeId) ?? selfId;
    if (!targetId) throw new BadRequestException('No employee record linked to your membership');
    if (targetId !== selfId && !this.ctx.can('training.manage'))
      throw new ForbiddenException('You can only enroll yourself');

    const employee = await this.db.employee.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');

    try {
      const enrollment = await this.db.courseEnrollment.create({
        data: { companyId: this.ctx.companyId, courseId, employeeId: targetId },
      });
      await this.audit.log('training.enrolled', {
        entity: 'CourseEnrollment',
        entityId: enrollment.id,
        meta: { courseId, employeeId: targetId },
      });
      return enrollment;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('This employee is already enrolled in this course');
      throw e;
    }
  }

  async updateEnrollment(id: string, input: EnrollmentUpdateInput) {
    const enrollment = await this.db.courseEnrollment.findFirst({ where: { id } });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.employeeId !== this.ctx.employeeIdOrNull && !this.ctx.can('training.manage'))
      throw new ForbiddenException('You can only update your own enrollments');
    if (enrollment.status === 'COMPLETED' || enrollment.status === 'CANCELLED')
      throw new ConflictException(`This enrollment is already ${enrollment.status.toLowerCase()}`);

    const updated = await this.db.courseEnrollment.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.score !== undefined ? { score: input.score } : {}),
        ...(input.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
    });
    await this.audit.log('training.enrollment_updated', {
      entity: 'CourseEnrollment',
      entityId: id,
      meta: { status: input.status },
    });
    return updated;
  }
}
