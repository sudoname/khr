import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { departmentCreateSchema, departmentUpdateSchema } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @RequirePermission('department.read')
  @Get()
  list() {
    return this.departments.list();
  }

  @RequirePermission('department.manage')
  @Post()
  create(@Body(new ZodPipe(departmentCreateSchema)) body: { name: string; parentId?: string; headEmployeeId?: string }) {
    return this.departments.create(body);
  }

  @RequirePermission('department.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(departmentUpdateSchema)) body: { name?: string; parentId?: string; headEmployeeId?: string },
  ) {
    return this.departments.update(id, body);
  }

  @RequirePermission('department.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.departments.remove(id);
  }
}
