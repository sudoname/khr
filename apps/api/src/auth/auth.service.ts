import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import type { RegisterInput } from '@peopleflow/types';
import { RESERVED_SLUGS } from '@peopleflow/types';
import { SecurityTokenType } from '@peopleflow/database';
import { config } from '../config';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { renderEmail } from '../infra/email-template';
import { PrismaService } from '../infra/prisma.service';
import { QueueService } from '../infra/queue.service';
import { RateLimitService } from '../infra/rate-limit.service';
import { SessionService } from './session.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// Constant-cost dummy hash so login timing does not reveal whether an email exists.
const DUMMY_HASH_PROMISE = argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'company';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly queue: QueueService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  // ───────────────────────── tokens ─────────────────────────

  private async issueToken(userId: string, type: SecurityTokenType, ttlMinutes: number, meta?: object) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.securityToken.create({
      data: {
        userId,
        type,
        tokenHash: sha256(token),
        meta: meta as never,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });
    return token;
  }

  private async consumeToken(token: string, type: SecurityTokenType) {
    const row = await this.prisma.securityToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    await this.prisma.securityToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }

  // ───────────────────────── registration ─────────────────────────

  async register(input: RegisterInput, ip?: string) {
    await this.rateLimit.hit(`register:${ip ?? 'unknown'}`, 10, 3600);

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Do not reveal registration state to the caller.
      return { message: 'If this email is available, your workspace has been created. Check your inbox.' };
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const baseSlug = slugify(input.companyName);
    let slug = baseSlug;
    // Reserved names (www, api, mail, …) collide with infrastructure subdomains.
    for (let i = 0; RESERVED_SLUGS.has(slug) || (await this.prisma.company.findUnique({ where: { slug } })); i++) {
      slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
      if (i > 5) throw new BadRequestException('Could not allocate a workspace identifier');
    }

    const { user, company } = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: input.companyName, slug, sector: input.sector },
      });
      // Fail-closed RLS: the membership insert below needs the tenant GUC.
      await tx.$executeRaw`SELECT set_config('app.company_id', ${company.id}, TRUE)`;
      const user = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
        },
      });
      await tx.membership.create({
        data: { userId: user.id, companyId: company.id, role: 'COMPANY_ADMIN' },
      });
      return { user, company };
    });

    const token = await this.issueToken(user.id, 'VERIFY_EMAIL', 60 * 24);
    const verifyUrl = `${config.webBaseUrl}/verify-email?token=${token}`;
    await this.queue.sendEmail({
      to: user.email,
      subject: 'Verify your PeopleFlow HR email',
      text: `Welcome to PeopleFlow HR, ${user.firstName}.\n\nYour workspace "${company.name}" was created.\nVerify your email: ${verifyUrl}\n\nThe link expires in 24 hours.`,
      html: renderEmail({
        heading: `Welcome, ${user.firstName}`,
        bodyLines: [
          `Your workspace "${company.name}" was created on PeopleFlow HR.`,
          'Confirm your email address to activate your account.',
        ],
        button: { label: 'Verify my email', url: verifyUrl },
        footerNote: 'The link expires in 24 hours.',
      }),
    });
    await this.audit.log('auth.register', { companyId: company.id, userId: user.id, entity: 'Company', entityId: company.id });

    return { message: 'If this email is available, your workspace has been created. Check your inbox.' };
  }

  async verifyEmail(token: string) {
    const row = await this.consumeToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.audit.log('auth.email_verified', { userId: row.userId, companyId: null });
    return { message: 'Email verified. You can sign in now.' };
  }

  // ───────────────────────── login / MFA ─────────────────────────

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    await this.rateLimit.hit(`login:ip:${ip ?? 'unknown'}`, 30, 900);
    await this.rateLimit.hit(`login:email:${email}`, 10, 900);

    const user = await this.prisma.user.findUnique({ where: { email } });
    const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!user || !valid) {
      await this.audit.log('auth.login_failed', { meta: { email }, userId: user?.id ?? null, companyId: null });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED' });
    }

    if (user.mfaEnabled) {
      const mfaToken = await this.issueToken(user.id, 'MFA_CHALLENGE', 10);
      return { mfaRequired: true as const, mfaToken };
    }
    return this.startSession(user.id, ip, userAgent);
  }

  async completeMfaLogin(mfaToken: string, code: string, ip?: string, userAgent?: string) {
    await this.rateLimit.hit(`mfa:ip:${ip ?? 'unknown'}`, 20, 900);
    const row = await this.consumeToken(mfaToken, 'MFA_CHALLENGE');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    if (!this.checkTotpOrRecovery(user.mfaSecret, user.mfaRecoveryCodes, code)) {
      await this.audit.log('auth.mfa_failed', { userId: user.id, companyId: null });
      throw new UnauthorizedException('Invalid authentication code');
    }
    if (user.mfaRecoveryCodes.includes(sha256(code.replace(/\s+/g, '').toLowerCase()))) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((c) => c !== sha256(code.replace(/\s+/g, '').toLowerCase())) },
      });
    }
    return this.startSession(user.id, ip, userAgent);
  }

  private checkTotpOrRecovery(secret: string | null, recoveryHashes: string[], code: string): boolean {
    const normalized = code.replace(/\s+/g, '');
    if (secret && authenticator.verify({ token: normalized, secret })) return true;
    return recoveryHashes.includes(sha256(normalized.toLowerCase()));
  }

  private async startSession(userId: string, ip?: string, userAgent?: string) {
    const memberships = await this.prisma.auth(userId).membership.findMany({
      where: { userId },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });
    const activeCompanyId = memberships.length === 1 ? memberships[0].companyId : null;
    const { token, session } = await this.sessions.create(userId, { activeCompanyId, ip, userAgent });
    await this.audit.log('auth.login', { userId, companyId: activeCompanyId });
    return { mfaRequired: false as const, token, session, memberships };
  }

  // ───────────────────────── session info ─────────────────────────

  async me() {
    const actor = this.ctx.actor;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { id: true, email: true, firstName: true, lastName: true, mfaEnabled: true, isPlatformAdmin: true },
    });
    const memberships = await this.prisma.auth(actor.userId).membership.findMany({
      where: { userId: actor.userId },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });
    let employee: {
      id: string;
      employeeNo: string;
      jobTitle: string;
      onboardingStatus: string;
      termsAcceptedAt: Date | null;
    } | null = null;
    if (actor.companyId && actor.employeeId) {
      employee = await this.prisma
        .tenant(actor.companyId)
        .employee.findFirst({
          where: { id: actor.employeeId },
          select: { id: true, employeeNo: true, jobTitle: true, onboardingStatus: true, termsAcceptedAt: true },
        });
    }
    return {
      user,
      activeCompanyId: actor.companyId ?? null,
      role: actor.role ?? null,
      employee,
      companies: memberships.map((m) => ({ ...m.company, role: m.role })),
      workspace: actor.workspace
        ? {
            slug: actor.workspace.slug,
            name: actor.workspace.name,
            exists: actor.workspace.companyId !== null,
            member: actor.workspace.member,
          }
        : null,
    };
  }

  async switchCompany(companyId: string) {
    const actor = this.ctx.actor;
    const membership = await this.prisma.auth(actor.userId).membership.findUnique({
      where: { userId_companyId: { userId: actor.userId, companyId } },
    });
    if (!membership) throw new ForbiddenException('You are not a member of that company');
    await this.sessions.setActiveCompany(actor.sessionId, companyId);
    await this.audit.log('auth.switch_company', { companyId, userId: actor.userId });
    return { activeCompanyId: companyId, role: membership.role };
  }

  // ───────────────────────── password lifecycle ─────────────────────────

  async forgotPassword(email: string, ip?: string) {
    await this.rateLimit.hit(`forgot:${ip ?? 'unknown'}`, 8, 3600);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await this.issueToken(user.id, 'PASSWORD_RESET', 60);
      const resetUrl = `${config.webBaseUrl}/reset-password?token=${token}`;
      await this.queue.sendEmail({
        to: user.email,
        subject: 'Reset your PeopleFlow HR password',
        text: `Reset your password: ${resetUrl}\n\nThe link expires in 1 hour. If you did not request this, ignore this email.`,
        html: renderEmail({
          heading: 'Reset your password',
          bodyLines: ['We received a request to reset your PeopleFlow HR password.'],
          button: { label: 'Reset password', url: resetUrl },
          footerNote: 'The link expires in 1 hour. If you did not request this, ignore this email.',
        }),
      });
    }
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'PASSWORD_RESET');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await this.sessions.revokeAllForUser(row.userId);
    await this.audit.log('auth.password_reset', { userId: row.userId, companyId: null });
    return { message: 'Password updated. Sign in with your new password.' };
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const actor = this.ctx.actor;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.sessions.revokeAllForUser(user.id, actor.sessionId);
    await this.audit.log('auth.password_changed', { userId: user.id });
    return { message: 'Password changed. Other sessions were signed out.' };
  }

  // ───────────────────────── MFA enrollment ─────────────────────────

  async mfaSetup() {
    const actor = this.ctx.actor;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });
    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email, 'PeopleFlow HR', secret),
    };
  }

  async mfaEnable(code: string) {
    const actor = this.ctx.actor;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    if (!user.mfaSecret || !authenticator.verify({ token: code.replace(/\s+/g, ''), secret: user.mfaSecret })) {
      throw new BadRequestException('Invalid authentication code');
    }
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaRecoveryCodes: recoveryCodes.map((c) => sha256(c)) },
    });
    await this.audit.log('auth.mfa_enabled', { userId: user.id });
    return { message: 'MFA enabled', recoveryCodes };
  }

  async mfaDisable(code: string, password: string) {
    const actor = this.ctx.actor;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.mfaEnabled) throw new BadRequestException('MFA is not enabled');
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      throw new UnauthorizedException('Password is incorrect');
    }
    if (!this.checkTotpOrRecovery(user.mfaSecret, user.mfaRecoveryCodes, code)) {
      throw new UnauthorizedException('Invalid authentication code');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });
    await this.audit.log('auth.mfa_disabled', { userId: user.id });
    return { message: 'MFA disabled' };
  }

  // ───────────────────────── Google OAuth ─────────────────────────

  get googleEnabled(): boolean {
    return Boolean(config.google.clientId && config.google.clientSecret);
  }

  private get googleRedirectUri() {
    // The API is reached through the web origin's /api proxy, so the public
    // callback URL is first-party and the session cookie Just Works.
    return `${config.webBaseUrl}/api/auth/google/callback`;
  }

  googleStart() {
    if (!this.googleEnabled) throw new BadRequestException('Google sign-in is not configured');
    const state = randomBytes(16).toString('base64url');
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: this.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
  }

  async googleCallback(code: string, state: string, stateCookie: string | undefined, ip?: string, userAgent?: string) {
    if (!this.googleEnabled) throw new BadRequestException('Google sign-in is not configured');
    await this.rateLimit.hit(`oauth:ip:${ip ?? 'unknown'}`, 20, 900);
    if (!code || !state || !stateCookie || state !== stateCookie) {
      throw new UnauthorizedException('Invalid OAuth state');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: this.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed');
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new UnauthorizedException('Google token exchange failed');

    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
    if (!infoRes.ok || !info.email || info.email_verified === false) {
      throw new UnauthorizedException('Google account email is not verified');
    }
    const email = info.email.toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // No local account: send them to registration rather than silently creating
      // a user with no workspace.
      return { kind: 'no_account' as const, email };
    }
    if (!user.emailVerifiedAt) {
      // Google asserts ownership of the address, which satisfies verification.
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    if (user.mfaEnabled) {
      const mfaToken = await this.issueToken(user.id, 'MFA_CHALLENGE', 10);
      return { kind: 'mfa' as const, mfaToken };
    }
    const session = await this.startSession(user.id, ip, userAgent);
    await this.audit.log('auth.google_login', { userId: user.id, companyId: null });
    return { kind: 'session' as const, token: session.token, session: session.session };
  }

  // ───────────────────────── invites ─────────────────────────

  async acceptInvite(token: string, password: string) {
    const row = await this.consumeToken(token, 'INVITE');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    });
    await this.audit.log('auth.invite_accepted', { userId: row.userId, companyId: (row.meta as { companyId?: string } | null)?.companyId ?? null });
    return { message: 'Account activated. Sign in with your new password.' };
  }
}
