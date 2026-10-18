import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  companyUpdateSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  type CompanyRole,
  type InviteMemberInput,
} from '@peopleflow/types';
import { RequirePermission, RequirePlatformAdmin } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CompaniesService } from './companies.service';

@ApiTags('companies')
@Controller()
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('company')
  current() {
    return this.companies.current();
  }

  @RequirePermission('company.manage')
  @Patch('company')
  update(@Body(new ZodPipe(companyUpdateSchema)) body: Record<string, string>) {
    return this.companies.update(body);
  }

  @RequirePermission('members.manage')
  @Get('members')
  listMembers() {
    return this.companies.listMembers();
  }

  @RequirePermission('members.manage')
  @Post('members/invite')
  invite(@Body(new ZodPipe(inviteMemberSchema)) body: InviteMemberInput) {
    return this.companies.invite(body);
  }

  @RequirePermission('members.manage')
  @Patch('members/:id/role')
  updateRole(@Param('id') id: string, @Body(new ZodPipe(updateMemberRoleSchema)) body: { role: CompanyRole }) {
    return this.companies.updateRole(id, body.role);
  }

  @RequirePermission('members.manage')
  @Delete('members/:id')
  remove(@Param('id') id: string) {
    return this.companies.removeMember(id);
  }

  @RequirePlatformAdmin()
  @Get('platform/companies')
  platformCompanies() {
    return this.companies.platformListCompanies();
  }
}
