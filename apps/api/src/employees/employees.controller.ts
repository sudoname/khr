import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  compensationCreateSchema,
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeSelfUpdateSchema,
  employeeUpdateSchema,
  rehireEmployeeSchema,
  rentDeclarationSchema,
  terminateEmployeeSchema,
} from '@peopleflow/types';
import type { EmployeeCreateInput, EmployeeUpdateInput, RentDeclarationInput } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employee.read')
  @Get()
  list(@Query(new ZodPipe(employeeListQuerySchema)) query: {
    q?: string;
    departmentId?: string;
    locationId?: string;
    status?: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
    page: number;
    pageSize: number;
  }) {
    return this.employees.list(query);
  }

  @RequirePermission('employee.read.self')
  @Get('me')
  me() {
    return this.employees.me();
  }

  @RequirePermission('employee.read.self')
  @Patch('me')
  updateMe(@Body(new ZodPipe(employeeSelfUpdateSchema)) body: Record<string, never>) {
    return this.employees.updateSelf(body);
  }

  @RequirePermission('employee.read.self')
  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadAvatar(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Upload an image in the "file" field');
    return this.employees.uploadAvatar(file);
  }

  @RequirePermission('employee.read.self')
  @Delete('me/avatar')
  removeAvatar() {
    return this.employees.removeAvatar();
  }

  @RequirePermission('employee.read.self')
  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Res() res: Response) {
    const avatar = await this.employees.getAvatar(id);
    res.setHeader('Content-Type', avatar.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(avatar.data));
  }

  @RequirePermission('employee.export')
  @Get('export')
  async exportCsv(@Res({ passthrough: true }) res: Response) {
    const csv = await this.employees.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    return csv;
  }

  @RequirePermission('employee.import')
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Upload a CSV file in the "file" field');
    return this.employees.importCsv(file.buffer);
  }

  @RequirePermission('employee.write')
  @Post()
  create(@Body(new ZodPipe(employeeCreateSchema)) body: EmployeeCreateInput) {
    return this.employees.create(body);
  }

  @RequirePermission('employee.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.employees.get(id);
  }

  @RequirePermission('employee.write')
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(employeeUpdateSchema)) body: EmployeeUpdateInput) {
    return this.employees.update(id, body);
  }

  @RequirePermission('employee.terminate')
  @Post(':id/terminate')
  terminate(
    @Param('id') id: string,
    @Body(new ZodPipe(terminateEmployeeSchema)) body: { terminationDate: string; reason: string },
  ) {
    return this.employees.terminate(id, body);
  }

  @RequirePermission('employee.terminate')
  @Post(':id/rehire')
  rehire(
    @Param('id') id: string,
    @Body(new ZodPipe(rehireEmployeeSchema)) body: { hireDate: string; jobTitle: string; departmentId?: string; managerId?: string },
  ) {
    return this.employees.rehire(id, body);
  }

  @RequirePermission('employee.read')
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.employees.history(id);
  }

  @RequirePermission('compensation.read')
  @Get(':id/compensation')
  listCompensation(@Param('id') id: string) {
    return this.employees.listCompensation(id);
  }

  @RequirePermission('compensation.write')
  @Put(':id/rent-declaration')
  setRentDeclaration(
    @Param('id') id: string,
    @Body(new ZodPipe(rentDeclarationSchema)) body: RentDeclarationInput,
  ) {
    return this.employees.setRentDeclaration(id, body.annualRentDeclared);
  }

  @RequirePermission('compensation.write')
  @Post(':id/compensation')
  addCompensation(
    @Param('id') id: string,
    @Body(new ZodPipe(compensationCreateSchema))
    body: { effectiveDate: string; baseSalary: string; currency: string; payFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'ANNUAL'; note?: string },
  ) {
    return this.employees.addCompensation(id, body);
  }
}
