import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
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
    const result = await this.auth.login(body.email, body.password, req.ip, req.headers['user-agent']);
    if (result.mfaRequired) return { mfaRequired: true, mfaToken: result.mfaToken };
    res.cookie(config.sessionCookieName, result.token, this.sessions.cookieOptions(result.session.expiresAt));
    return { mfaRequired: false, companies: result.memberships.map((m) => ({ ...m.company, role: m.role })) };
  }

  @Public()
  @Post('mfa/verify')
  async mfaVerify(
    @Body(new ZodPipe(mfaVerifySchema)) body: { mfaToken: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.completeMfaLogin(body.mfaToken, body.code, req.ip, req.headers['user-agent']);
    res.cookie(config.sessionCookieName, result.token, this.sessions.cookieOptions(result.session.expiresAt));
    return { mfaRequired: false, companies: result.memberships.map((m) => ({ ...m.company, role: m.role })) };
  }

  @AllowWithoutMfa()
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    const actor = this.ctx.actor;
    await this.sessions.revoke(actor.sessionId, actor.userId);
    res.clearCookie(config.sessionCookieName, this.sessions.cookieOptions());
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
