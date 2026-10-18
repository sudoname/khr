import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { CookieOptions } from 'express';
import { config } from '../config';
import { hashSessionToken } from '../common/guards/auth.guard';
import { PrismaService } from '../infra/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      path: '/',
      expires,
      ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    };
  }

  async create(userId: string, opts: { activeCompanyId?: string | null; ip?: string; userAgent?: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
    const session = await this.prisma.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId,
        activeCompanyId: opts.activeCompanyId ?? null,
        ip: opts.ip,
        userAgent: opts.userAgent?.slice(0, 300),
        expiresAt,
      },
    });
    return { token, session };
  }

  async revoke(sessionId: string, userId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  async listForUser(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async setActiveCompany(sessionId: string, companyId: string | null) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
  }
}
