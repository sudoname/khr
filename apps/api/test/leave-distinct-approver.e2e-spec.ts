/**
 * WP-6 — Distinct approvers across leave approval levels.
 *
 * A policy with approvalLevels > 1 exists to enforce four-eyes review, but
 * decide() let the same actor approve level 1 and then level 2, collapsing
 * multi-level approval into single-approver. An actor who decided an earlier
 * level of a request must now get 409 APPROVER_CONFLICT on later levels.
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

describe('distinct approver across leave levels (WP-6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string; // COMPANY_ADMIN — decides level 1
  let hrCookie: string; // HR_ADMIN — the distinct level-2 approver
  let companyAId: string;
  let hrOwnCompanyId: string;
  let reqId: string;

  const adminEmail = `wp6.admin.${STAMP}@example.test`;
  const hrEmail = `wp6.hr.${STAMP}@example.test`;

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

  async function register(companyName: string, email: string): Promise<{ cookie: string; companyId: string }> {
    await request(server())
      .post('/auth/register')
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Wp6', lastName: 'User', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership created for ${email}`);
    return { cookie: sessionCookie(login), companyId: membership.companyId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    const a = await register(`Wp6 Alpha ${STAMP}`, adminEmail);
    adminCookie = a.cookie;
    companyAId = a.companyId;

    const h = await register(`Wp6 HrOwn ${STAMP}`, hrEmail);
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

    const emp = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Two',
        lastName: 'Level',
        workEmail: `wp6.worker.${STAMP}@example.test`,
        hireDate: '2026-01-05',
        jobTitle: 'Analyst',
      })
      .expect(201);

    // Unpaid type keeps the balance machinery out of the picture.
    const type = await request(server())
      .post('/leave/types')
      .set('Cookie', adminCookie)
      .send({ name: `Unpaid ${STAMP}`, code: `UP${STAMP}`, paid: false, allowHalfDay: false })
      .expect(201);
    await request(server())
      .put('/leave/policies')
      .set('Cookie', adminCookie)
      .send({ leaveTypeId: type.body.id, accrualMethod: 'NONE', annualEntitlementDays: 0, maxCarryoverDays: 0, approvalLevels: 2 })
      .expect(200);

    const req = await request(server())
      .post('/leave/requests')
      .set('Cookie', adminCookie)
      .send({ employeeId: emp.body.id, leaveTypeId: type.body.id, startDate: '2026-07-06', endDate: '2026-07-08' })
      .expect(201);
    reqId = req.body.id;
    expect(req.body.approvals).toHaveLength(2);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, hrOwnCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, hrEmail] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('level-1 approval advances the request to level 2', async () => {
    const res = await request(server())
      .post(`/leave/requests/${reqId}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' })
      .expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.currentLevel).toBe(2);
  });

  it('the level-1 approver cannot also decide level 2 (409 APPROVER_CONFLICT)', async () => {
    const res = await request(server())
      .post(`/leave/requests/${reqId}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.message?.code).toBe('APPROVER_CONFLICT');
    const row = await prisma.tenant(companyAId).leaveRequest.findUnique({ where: { id: reqId } });
    expect(row?.status).toBe('PENDING');
  });

  it('a different approver can decide level 2 and finalize the request', async () => {
    const res = await request(server())
      .post(`/leave/requests/${reqId}/decision`)
      .set('Cookie', hrCookie)
      .send({ decision: 'APPROVED' })
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
  });
});
