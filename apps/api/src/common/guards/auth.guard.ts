import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { MFA_REQUIRED_ROLES, SLUG_RE } from '@peopleflow/types';
import { config } from '../../config';
import { AppContext, RequestActor } from '../../context/app-context';
import { PrismaService } from '../../infra/prisma.service';
import { ALLOW_NO_MFA_KEY, IS_PUBLIC_KEY } from '../decorators';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly ctx: AppContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { actor?: RequestActor }>();
    const token = (req.cookies?.[config.sessionCookieName] as string | undefined) ?? '';
    if (!token) throw new UnauthorizedException('Not signed in');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    const actor: RequestActor = {
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      isPlatformAdmin: session.user.isPlatformAdmin,
      ip: req.ip,
    };

    const workspaceSlug = this.workspaceSlug(req);
    if (workspaceSlug) {
      // The request arrived on a workspace subdomain: the host is authoritative
      // for tenant selection; session.activeCompanyId is ignored here. Pinning
      // is in-memory only (no session write).
      const company = await this.prisma.company.findFirst({
        where: { slug: workspaceSlug, deletedAt: null },
        select: { id: true, name: true },
      });
      if (company) {
        // Auth-scoped read: RLS only exposes the user's own membership rows.
        const membership = await this.prisma.auth(session.userId).membership.findUnique({
          where: { userId_companyId: { userId: session.userId, companyId: company.id } },
        });
        if (membership) {
          actor.companyId = membership.companyId;
          actor.role = membership.role;
          actor.employeeId = membership.employeeId ?? undefined;
          actor.workspace = { slug: workspaceSlug, companyId: company.id, name: company.name, member: true };
        } else {
          // Non-member: tenant context stays unset so tenant-scoped routes 403.
          actor.workspace = { slug: workspaceSlug, companyId: company.id, name: company.name, member: false };
        }
      } else {
        actor.workspace = { slug: workspaceSlug, companyId: null, name: null, member: false };
      }
    } else if (session.activeCompanyId) {
      // Membership is re-verified on EVERY request; a revoked membership
      // immediately drops tenant access even for live sessions. Auth-scoped
      // read: RLS only exposes the user's own membership rows.
      const membership = await this.prisma.auth(session.userId).membership.findUnique({
        where: { userId_companyId: { userId: session.userId, companyId: session.activeCompanyId } },
      });
      if (membership) {
        actor.companyId = membership.companyId;
        actor.role = membership.role;
        actor.employeeId = membership.employeeId ?? undefined;
      }
    }

    if (
      config.enforceMfaForPrivileged &&
      actor.role &&
      MFA_REQUIRED_ROLES.includes(actor.role) &&
      !session.user.mfaEnabled
    ) {
      const allowNoMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowNoMfa) {
        throw new ForbiddenException({
          message: 'Multi-factor authentication is required for your role. Enroll MFA to continue.',
          code: 'MFA_SETUP_REQUIRED',
        });
      }
    }

    this.ctx.setActor(actor);
    req.actor = actor;
    return true;
  }

  /** Validated workspace slug from the middleware-injected header, if any. */
  private workspaceSlug(req: Request): string | null {
    const raw = req.headers['x-workspace-slug'];
    const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
    return slug && SLUG_RE.test(slug) ? slug : null;
  }
}
