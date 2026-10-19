/**
 * WP-8 — Onboarding self-approval.
 *
 * POST /onboarding/:employeeId/review only required employee.write, so an HR
 * user whose own employee profile was awaiting review could approve it
 * themselves. review() now rejects when the target employee record is linked
 * to the reviewing user (403 SELF_APPROVAL_FORBIDDEN); a different reviewer
 * still succeeds.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { PrismaService } from '../src/infra/prisma.service';
import { REDIS } from '../src/infra/redis.provider';

jest.setTimeout(120_000);

const STAMP = Date.now();
const PASSWORD = 'E2e-Password-123!';

describe('onboarding self-approval (WP-8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string; // COMPANY_ADMIN — the legitimate reviewer
  let hrCookie: string; // HR_ADMIN — owns the profile under review
  let companyAId: string;
  let hrOwnCompanyId: string;
  let empId: string;

  const adminEmail = `wp8.admin.${STAMP}@example.test`;
  const hrEmail = `wp8.hr.${STAMP}@example.test`;

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
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Wp8', lastName: 'User', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership created for ${email}`);
    return { cookie: sessionCookie(login), companyId: membership.companyId, userId: user.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    const a = await register(`Wp8 Alpha ${STAMP}`, adminEmail);
    adminCookie = a.cookie;
    companyAId = a.companyId;

    const h = await register(`Wp8 HrOwn ${STAMP}`, hrEmail);
    hrOwnCompanyId = h.companyId;
    await request(server())
      .post('/members/invite')
      .set('Cookie', adminCookie)
      .send({ email: hrEmail, firstName: 'Hr', lastName: 'Admin', role: 'HR_ADMIN' })
      .expect(201);
    await request(server())
      .post('/auth/switch-company')
      .set('Cookie', h.cookie)
      .send({ companyId: companyAId })
      .expect(201);
    hrCookie = h.cookie;

    // The HR user's own employee record, submitted and awaiting review.
    const emp = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Hr',
        lastName: 'Self',
        workEmail: `wp8.self.${STAMP}@example.test`,
        hireDate: '2026-02-02',
        jobTitle: 'HR Lead',
      })
      .expect(201);
    empId = emp.body.id;
    await prisma.tenant(companyAId).employee.update({
      where: { id: empId },
      data: { userId: h.userId, onboardingStatus: 'SUBMITTED', onboardingSubmittedAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, hrOwnCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, hrEmail] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('a reviewer cannot approve their own onboarding profile (403 SELF_APPROVAL_FORBIDDEN)', async () => {
    const res = await request(server())
      .post(`/onboarding/${empId}/review`)
      .set('Cookie', hrCookie)
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.message?.code).toBe('SELF_APPROVAL_FORBIDDEN');
    const row = await prisma.tenant(companyAId).employee.findUnique({ where: { id: empId } });
    expect(row?.onboardingStatus).toBe('SUBMITTED');
  });

  it('a different reviewer can approve the profile', async () => {
    await request(server())
      .post(`/onboarding/${empId}/review`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' })
      .expect(201);
    const row = await prisma.tenant(companyAId).employee.findUnique({ where: { id: empId } });
    expect(row?.onboardingStatus).toBe('APPROVED');
  });
});
