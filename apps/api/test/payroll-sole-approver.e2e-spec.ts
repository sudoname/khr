/**
 * WP-10 — Sole-approver payroll break-glass (decision D2 = Yes).
 *
 * assertSeparationOfDuties() hard-blocked self-approval with no escape, so a
 * company whose only payroll.approve holder also prepared the run could never
 * finalize payroll. Self-approval is now allowed ONLY when the approver is
 * the sole member holding payroll.approve, gated behind a fresh TOTP code,
 * and audited as payroll.sod_override. With a second approver present the
 * hard PAYROLL_SOD_VIOLATION remains even with a valid code.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { PrismaService } from '../src/infra/prisma.service';
import { REDIS } from '../src/infra/redis.provider';

jest.setTimeout(120_000);

const STAMP = Date.now();
const PASSWORD = 'E2e-Password-123!';

describe('payroll sole-approver break-glass (WP-10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string; // sole COMPANY_ADMIN, prepares AND tries to approve
  let secondCookie: string; // second COMPANY_ADMIN added later
  let companyId: string;
  let secondOwnCompanyId: string;
  let mfaSecret: string;
  let run1: string; // sole-approver era
  let run2: string; // created after the second approver exists

  const adminEmail = `wp10.admin.${STAMP}@example.test`;
  const secondEmail = `wp10.second.${STAMP}@example.test`;

  const server = () => app.getHttpServer();

  async function flushRateLimits() {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
  }

  function sessionCookie(res: request.Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const match = raw?.find((c) => c.startsWith(`${config.sessionCookieName}=`));
    if (!match) throw new Error('Login did not set a session cookie');
    return match.split(';')[0];
  }

  async function register(companyName: string, email: string): Promise<{ cookie: string; companyId: string; userId: string }> {
    await request(server())
      .post('/auth/register')
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Wp10', lastName: 'User', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership created for ${email}`);
    return { cookie: sessionCookie(login), companyId: membership.companyId, userId: user.id };
  }

  async function makeSubmittedRun(year: number, month: number): Promise<string> {
    const run = await request(server())
      .post('/payroll/runs')
      .set('Cookie', adminCookie)
      .send({ year, month })
      .expect(201);
    await request(server()).post(`/payroll/runs/${run.body.id}/submit`).set('Cookie', adminCookie).expect(201);
    return run.body.id;
  }

  const approve = (runId: string, cookie: string, mfaCode?: string) =>
    request(server())
      .post(`/payroll/runs/${runId}/approve`)
      .set('Cookie', cookie)
      .send(mfaCode ? { mfaCode } : {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    const a = await register(`Wp10 Alpha ${STAMP}`, adminEmail);
    adminCookie = a.cookie;
    companyId = a.companyId;

    // TOTP enrolled after login (sessions are unaffected; the guard only
    // blocks privileged roles when MFA is NOT enabled).
    mfaSecret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: a.userId }, data: { mfaEnabled: true, mfaSecret } });

    // One employee with compensation so runs compute payslips.
    const emp = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Paid',
        lastName: 'Person',
        workEmail: `wp10.worker.${STAMP}@example.test`,
        hireDate: '2025-12-01',
        jobTitle: 'Engineer',
      })
      .expect(201);
    await request(server())
      .post(`/employees/${emp.body.id}/compensation`)
      .set('Cookie', adminCookie)
      .send({ effectiveDate: '2026-01-01', baseSalary: '450000.00', payFrequency: 'MONTHLY' })
      .expect(201);

    // Tax attestation gate stays in force: approve the required engine version.
    const status = await request(server())
      .get('/payroll/tax-status?year=2026&month=1')
      .set('Cookie', adminCookie)
      .expect(200);
    await request(server())
      .post('/payroll/settings/approve-tax-rules')
      .set('Cookie', adminCookie)
      .send({ version: status.body.requiredVersion })
      .expect(201);

    run1 = await makeSubmittedRun(2026, 1);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, secondOwnCompanyId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, secondEmail] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('sole approver without a TOTP code is rejected (403 SOD_OVERRIDE_MFA_REQUIRED)', async () => {
    const res = await approve(run1, adminCookie);
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.message?.code).toBe('SOD_OVERRIDE_MFA_REQUIRED');
    const row = await prisma.tenant(companyId).payrollRun.findUnique({ where: { id: run1 } });
    expect(row?.status).toBe('PENDING_APPROVAL');
  });

  it('sole approver with an invalid TOTP code is rejected (403 SOD_OVERRIDE_MFA_INVALID)', async () => {
    const res = await approve(run1, adminCookie, '000000');
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.message?.code).toBe('SOD_OVERRIDE_MFA_INVALID');
  });

  it('sole approver with a fresh TOTP code may self-approve, and the override is audited', async () => {
    const res = await approve(run1, adminCookie, authenticator.generate(mfaSecret));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
    const audit = await prisma.tenant(companyId).auditLog.findFirst({
      where: { action: 'payroll.sod_override', entityId: run1 },
    });
    expect(audit).toBeTruthy();
    expect((audit?.meta as { reason?: string })?.reason).toBe('sole-approver');
  });

  it('once a second approver exists, self-approval is a hard SoD violation even with a valid code', async () => {
    const s = await register(`Wp10 SecondOwn ${STAMP}`, secondEmail);
    secondOwnCompanyId = s.companyId;
    await request(server())
      .post('/members/invite')
      .set('Cookie', adminCookie)
      .send({ email: secondEmail, firstName: 'Second', lastName: 'Admin', role: 'COMPANY_ADMIN' })
      .expect(201);
    await request(server())
      .post('/auth/switch-company')
      .set('Cookie', s.cookie)
      .send({ companyId })
      .expect(201);
    secondCookie = s.cookie;

    run2 = await makeSubmittedRun(2026, 2);
    const res = await approve(run2, adminCookie, authenticator.generate(mfaSecret));
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.message?.code).toBe('PAYROLL_SOD_VIOLATION');
  });

  it('the second approver finalizes the run normally (no TOTP needed)', async () => {
    const res = await approve(run2, secondCookie);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
  });
});
