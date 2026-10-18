import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { changeManagerSchema } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { OrgService } from './org.service';

@ApiTags('org')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @RequirePermission('org.read')
  @Get('chart')
  chart() {
    return this.org.chart();
  }

  @RequirePermission('org.manage')
  @Patch('employees/:id/manager')
  changeManager(
    @Param('id') id: string,
    @Body(new ZodPipe(changeManagerSchema)) body: { managerId: string | null },
  ) {
    return this.org.changeManager(id, body.managerId);
  }
}
