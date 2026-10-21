import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  contractTemplateUpdateSchema,
  contractUpdateSchema,
  type ContractTemplateUpdateInput,
  type ContractUpdateInput,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ContractsService } from './contracts.service';

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @RequirePermission('document.manage')
  @Get('template')
  getTemplate() {
    return this.contracts.getTemplate();
  }

  @RequirePermission('document.manage')
  @Put('template')
  updateTemplate(@Body(new ZodPipe(contractTemplateUpdateSchema)) body: ContractTemplateUpdateInput) {
    return this.contracts.updateTemplate(body);
  }

  // Self-or-manage: the service rejects employees reading anyone else's contract.
  @RequirePermission('document.read.self')
  @Get('employee/:employeeId')
  getForEmployee(@Param('employeeId') employeeId: string) {
    return this.contracts.getForEmployee(employeeId);
  }

  @RequirePermission('document.manage')
  @Post('employee/:employeeId')
  create(@Param('employeeId') employeeId: string) {
    return this.contracts.createForEmployee(employeeId);
  }

  @RequirePermission('document.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(contractUpdateSchema)) body: ContractUpdateInput) {
    return this.contracts.update(id, body);
  }

  @RequirePermission('document.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contracts.remove(id);
  }

  @RequirePermission('document.read.self')
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.contracts.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
