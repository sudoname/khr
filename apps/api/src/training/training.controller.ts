import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { courseCreateSchema, courseUpdateSchema, enrollSchema, enrollmentUpdateSchema } from '@peopleflow/types';
import type { CourseCreateInput, CourseUpdateInput, EnrollmentUpdateInput } from '@peopleflow/types';
import { z } from 'zod';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { TrainingService } from './training.service';

const enrollmentListQuerySchema = z.object({
  courseId: z.string().optional(),
  employeeId: z.string().optional(),
});

@ApiTags('training')
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @RequirePermission('training.read')
  @Get('courses')
  listCourses() {
    return this.training.listCourses();
  }

  @RequirePermission('training.manage')
  @Post('courses')
  createCourse(@Body(new ZodPipe(courseCreateSchema)) input: CourseCreateInput) {
    return this.training.createCourse(input);
  }

  @RequirePermission('training.manage')
  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body(new ZodPipe(courseUpdateSchema)) input: CourseUpdateInput) {
    return this.training.updateCourse(id, input);
  }

  @RequirePermission('training.manage')
  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string) {
    return this.training.deleteCourse(id);
  }

  @RequirePermission('training.read')
  @Get('enrollments')
  listEnrollments(
    @Query(new ZodPipe(enrollmentListQuerySchema)) query: { courseId?: string; employeeId?: string },
  ) {
    return this.training.listEnrollments(query);
  }

  @RequirePermission('training.read')
  @Post('courses/:id/enroll')
  enroll(@Param('id') courseId: string, @Body(new ZodPipe(enrollSchema)) input: { employeeId?: string }) {
    return this.training.enroll(courseId, input.employeeId);
  }

  @RequirePermission('training.read')
  @Patch('enrollments/:id')
  updateEnrollment(
    @Param('id') id: string,
    @Body(new ZodPipe(enrollmentUpdateSchema)) input: EnrollmentUpdateInput,
  ) {
    return this.training.updateEnrollment(id, input);
  }
}
