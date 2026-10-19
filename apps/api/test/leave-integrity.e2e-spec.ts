/**
 * WP-5 — Leave balance integrity.
 *
 * decide() and cancel() used read-then-write status checks with
 * unconditional balance writes, so (a) two concurrent approvals of the same
 * request both deducted the balance, (b) nothing re-checked the balance at
 * approval time (two individually-affordable PENDING requests could both be
 * approved into overdraw), and (c) two concurrent cancels both refunded.
 * All transitions are now conditional updateMany (count === 0 → 409) inside
 * one tenant-GUC transaction, with the deduction guarded by
 * usedDays <= available - requested.
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

describe('leave balance integrity (WP-5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string;
  let companyId: string;
  let empId: string;
  let typeId: string;
  let reqA: string; // 2026-06-01..03, 3 working days
  let reqB: string; // 2026-06-08..10, 3 working days

  const adminEmail = `wp5.admin.${STAMP}@example.test`;
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

  async function usedDays(): Promise<number> {
    const balance = await prisma
      .tenant(companyId)
      .leaveBalance.findFirst({ where: { employeeId: empId, leaveTypeId: typeId, year: 2026 } });
    return Number(balance?.usedDays ?? 0);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    await request(server())
      .post('/auth/register')
      .send({ companyName: `Wp5 Alpha ${STAMP}`, sector: 'TECHNOLOGY', firstName: 'Wp5', lastName: 'Admin', email: adminEmail, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(201);
    adminCookie = sessionCookie(login);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error('No membership created for admin');
    companyId = membership.companyId;

    const created = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Leave',
        lastName: 'Taker',
        workEmail: `wp5.worker.${STAMP}@example.test`,
        hireDate: '2026-01-05',
        jobTitle: 'Analyst',
      })
      .expect(201);
    empId = created.body.id;

    const type = await request(server())
      .post('/leave/types')
      .set('Cookie', adminCookie)
      .send({ name: `Annual ${STAMP}`, code: `AL${STAMP}`, paid: true, allowHalfDay: false })
      .expect(201);
    typeId = type.body.id;
    // Entitlement 4: each 3-day request is affordable alone; both together overdraw.
    await request(server())
      .put('/leave/policies')
      .set('Cookie', adminCookie)
      .send({ leaveTypeId: typeId, accrualMethod: 'ANNUAL_GRANT', annualEntitlementDays: 4, maxCarryoverDays: 0, approvalLevels: 1 })
      .expect(200);

    const makeRequest = (startDate: string, endDate: string) =>
      request(server())
        .post('/leave/requests')
        .set('Cookie', adminCookie)
        .send({ employeeId: empId, leaveTypeId: typeId, startDate, endDate })
        .expect(201);
    // Both created while usedDays is 0, so each passes the creation-time check.
    reqA = (await makeRequest('2026-06-01', '2026-06-03')).body.id;
    reqB = (await makeRequest('2026-06-08', '2026-06-10')).body.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('concurrent approvals of the same request: one wins, one 409, single deduction', async () => {
    const decide = () =>
      request(server()).post(`/leave/requests/${reqA}/decision`).set('Cookie', adminCookie).send({ decision: 'APPROVED' });
    const [r1, r2] = await Promise.all([decide(), decide()]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await usedDays()).toBe(3);
    const row = await prisma.tenant(companyId).leaveRequest.findUnique({ where: { id: reqA } });
    expect(row?.status).toBe('APPROVED');
  });

  it('approval re-checks the balance: second affordable-at-creation request cannot overdraw', async () => {
    // usedDays is 3 of 4 — approving 3 more must fail and roll back fully.
    const res = await request(server())
      .post(`/leave/requests/${reqB}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.message?.code).toBeDefined();
    expect(await usedDays()).toBe(3);
    const row = await prisma.tenant(companyId).leaveRequest.findUnique({ where: { id: reqB } });
    expect(row?.status).toBe('PENDING');
    // The approval-step claim must have rolled back with the status flip.
    const step = await prisma.tenant(companyId).leaveApproval.findFirst({ where: { leaveRequestId: reqB, level: 1 } });
    expect(step?.decision).toBeNull();
  });

  it('concurrent cancels of an approved request: one wins, one 409, single refund', async () => {
    const cancel = () => request(server()).post(`/leave/requests/${reqA}/cancel`).set('Cookie', adminCookie).send({});
    const [r1, r2] = await Promise.all([cancel(), cancel()]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await usedDays()).toBe(0);
  });

  it('cancelling a pending request does not touch the balance', async () => {
    await request(server()).post(`/leave/requests/${reqB}/cancel`).set('Cookie', adminCookie).send({}).expect(201);
    expect(await usedDays()).toBe(0);
  });
});
