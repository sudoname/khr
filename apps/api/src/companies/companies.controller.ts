import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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

  @RequirePermission('company.manage')
  @Post('company/logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Upload an image in the "file" field');
    return this.companies.uploadLogo(file);
  }

  @RequirePermission('company.manage')
  @Delete('company/logo')
  removeLogo() {
    return this.companies.removeLogo();
  }

  @Get('company/logo')
  async logo(@Res() res: Response) {
    const logo = await this.companies.getLogo();
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(logo.data));
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
