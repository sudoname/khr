import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { jobCreateSchema, jobUpdateSchema, type JobCreateInput, type JobUpdateInput } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @RequirePermission('job.read')
  @Get()
  list() {
    return this.jobs.list();
  }

  @RequirePermission('job.manage')
  @Post()
  create(@Body(new ZodPipe(jobCreateSchema)) body: JobCreateInput) {
    return this.jobs.create(body);
  }

  @RequirePermission('job.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(jobUpdateSchema)) body: JobUpdateInput) {
    return this.jobs.update(id, body);
  }

  @RequirePermission('job.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobs.remove(id);
  }
}
