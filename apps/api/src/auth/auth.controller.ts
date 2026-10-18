import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  switchCompanySchema,
  verifyEmailSchema,
  acceptInviteSchema,
  SLUG_RE,
  type RegisterInput,
} from '@peopleflow/types';
import { AllowWithoutMfa, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { AppContext } from '../context/app-context';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly ctx: AppContext,
  ) {}

  /**
   * Sets the session cookie. When a cross-subdomain cookie domain is configured,
   * first clears any stale host-only cookie from before the domain rollout so it
   * cannot shadow the new one.
   */
  private setSessionCookie(res: Response, token: string, expires: Date) {
    if (config.cookieDomain) res.clearCookie(config.sessionCookieName, { path: '/' });
    res.cookie(config.sessionCookieName, token, this.sessions.cookieOptions(expires));
  }

  /** Validated workspace slug from the middleware-injected header, if any. */
  private workspaceSlug(req: Request): string | undefined {
    const raw = req.headers['x-workspace-slug'];
    const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
    return slug && SLUG_RE.test(slug) ? slug : undefined;
  }

  @Public()
  @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: Request) {
    return this.auth.register(body, req.ip);
  }

  @Public()
  @Post('login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      body.email,
      body.password,
      req.ip,
      req.headers['user-agent'],
      this.workspaceSlug(req),
    );
    if (result.mfaRequired) return { mfaRequired: true, mfaToken: result.mfaToken };
    this.setSessionCookie(res, result.token, result.session.expiresAt);
    return { mfaRequired: false, companies: result.memberships.map((m) => ({ ...m.company, role: m.role })) };
  }

  // ───────────────────────── Google OAuth ─────────────────────────

  private static readonly OAUTH_STATE_COOKIE = 'pf_oauth_state';

  @Public()
  @Get('providers')
  providers() {
    return { google: this.auth.googleEnabled };
  }

  @Public()
  @Get('google')
  googleStart(@Query('workspace') workspace: string | undefined, @Res() res: Response) {
    const slug = typeof workspace === 'string' && SLUG_RE.test(workspace) ? workspace : undefined;
    const { url, state } = this.auth.googleStart(slug);
    res.cookie(AuthController.OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      path: '/',
      maxAge: 10 * 60 * 1000,
      // The flow may start on a workspace subdomain while the Google redirect
      // URI lands on the apex — the state cookie must span both.
      ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    });
    res.redirect(url);
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const stateCookie = (req.cookies as Record<string, string> | undefined)?.[AuthController.OAUTH_STATE_COOKIE];
    res.clearCookie(AuthController.OAUTH_STATE_COOKIE, { path: '/' });
    if (config.cookieDomain) {
      res.clearCookie(AuthController.OAUTH_STATE_COOKIE, { path: '/', domain: config.cookieDomain });
    }
    try {
      const result = await this.auth.googleCallback(
        String(req.query.code ?? ''),
        String(req.query.state ?? ''),
        stateCookie,
        req.ip,
        req.headers['user-agent'],
      );
      if (result.kind === 'no_account') {
        return res.redirect(`${config.webBaseUrl}/register?google=no_account&email=${encodeURIComponent(result.email)}`);
      }
      if (result.kind === 'mfa') {
        const ws = result.workspaceSlug ? `&workspace=${encodeURIComponent(result.workspaceSlug)}` : '';
        return res.redirect(`${config.webBaseUrl}/login?mfaToken=${encodeURIComponent(result.mfaToken)}${ws}`);
      }
      this.setSessionCookie(res, result.token, result.session.expiresAt);
      // Flows that started on a workspace subdomain land back there — but only
      // for members; non-members stay on the apex dashboard.
      const target =
        config.baseDomain && result.workspaceSlug && result.workspaceMember
          ? `https://${result.workspaceSlug}.${config.baseDomain}/dashboard`
          : `${config.webBaseUrl}/dashboard`;
      return res.redirect(target);
    } catch {
      return res.redirect(`${config.webBaseUrl}/login?error=google`);
    }
  }

  @Public()
  @Post('mfa/verify')
  async mfaVerify(
    @Body(new ZodPipe(mfaVerifySchema)) body: { mfaToken: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.completeMfaLogin(
      body.mfaToken,
      body.code,
      req.ip,
      req.headers['user-agent'],
      this.workspaceSlug(req),
    );
    this.setSessionCookie(res, result.token, result.session.expiresAt);
    return { mfaRequired: false, companies: result.memberships.map((m) => ({ ...m.company, role: m.role })) };
  }

  @AllowWithoutMfa()
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    const actor = this.ctx.actor;
    await this.sessions.revoke(actor.sessionId, actor.userId);
    res.clearCookie(config.sessionCookieName, this.sessions.cookieOptions());
    // Also clear any stale host-only cookie from before the domain rollout.
    if (config.cookieDomain) res.clearCookie(config.sessionCookieName, { path: '/' });
    return { message: 'Signed out' };
  }

  @AllowWithoutMfa()
  @Get('me')
  me() {
    return this.auth.me();
  }

  @AllowWithoutMfa()
  @Post('switch-company')
  switchCompany(@Body(new ZodPipe(switchCompanySchema)) body: { companyId: string }) {
    return this.auth.switchCompany(body.companyId);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }, @Req() req: Request) {
    return this.auth.forgotPassword(body.email, req.ip);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(@Body(new ZodPipe(acceptInviteSchema)) body: { token: string; password: string }) {
    return this.auth.acceptInvite(body.token, body.password);
  }

  @Post('change-password')
  changePassword(
    @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
  ) {
    return this.auth.changePassword(body.currentPassword, body.newPassword);
  }

  @AllowWithoutMfa()
  @Get('sessions')
  listSessions() {
    const actor = this.ctx.actor;
    return this.sessions.listForUser(actor.userId, actor.sessionId);
  }

  @AllowWithoutMfa()
  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string) {
    await this.sessions.revoke(id, this.ctx.userId);
    return { message: 'Session revoked' };
  }

  @AllowWithoutMfa()
  @Post('mfa/setup')
  mfaSetup() {
    return this.auth.mfaSetup();
  }

  @AllowWithoutMfa()
  @Post('mfa/enable')
  mfaEnable(@Body(new ZodPipe(mfaEnableSchema)) body: { code: string }) {
    return this.auth.mfaEnable(body.code);
  }

  @Post('mfa/disable')
  mfaDisable(@Body(new ZodPipe(mfaDisableSchema)) body: { code: string; password: string }) {
    return this.auth.mfaDisable(body.code, body.password);
  }
}
