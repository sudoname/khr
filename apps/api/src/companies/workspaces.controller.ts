import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SLUG_RE } from '@peopleflow/types';
import { Public } from '../common/decorators';
import { PrismaService } from '../infra/prisma.service';
import { RateLimitService } from '../infra/rate-limit.service';

/**
 * Public, pre-auth workspace lookup used to brand the login page on
 * `<slug>.khr.ng`. Exposes only what the subdomain itself already reveals:
 * the company name and logo. Rate-limited to slow slug enumeration.
 */
@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async lookup(slug: string, ip?: string) {
    await this.rateLimit.hit(`workspace:${ip ?? 'unknown'}`, 60, 300);
    if (!SLUG_RE.test(slug)) throw new NotFoundException('Workspace not found');
    // Company itself is not an RLS table; the slug resolves the tenant whose
    // logo (RLS-protected) is then read through the tenant-scoped client.
    const company = await this.prisma.company.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
    if (!company) throw new NotFoundException('Workspace not found');
    return company;
  }

  @Public()
  @Get(':slug')
  async get(@Param('slug') slug: string, @Req() req: Request) {
    const company = await this.lookup(slug, req.ip);
    const logo = await this.prisma.tenant(company.id).companyLogo.findUnique({
      where: { companyId: company.id },
      select: { updatedAt: true },
    });
    return {
      name: company.name,
      slug: company.slug,
      hasLogo: !!logo,
      logoVersion: logo ? logo.updatedAt.getTime() : null,
    };
  }

  @Public()
  @Get(':slug/logo')
  async logo(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const company = await this.lookup(slug, req.ip);
    const logo = await this.prisma.tenant(company.id).companyLogo.findUnique({
      where: { companyId: company.id },
    });
    if (!logo) throw new NotFoundException('No logo');
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(logo.data));
  }
}
