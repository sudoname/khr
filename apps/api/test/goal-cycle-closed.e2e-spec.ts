/**
 * WP-9 — Goals immutable after cycle close.
 *
 * createGoal() rejected CLOSED cycles but updateGoal() never looked at the
 * cycle, so goals inside a closed review cycle could still be retitled,
 * reweighted or have progress rewritten. updateGoal() now returns 409 once
 * the goal's cycle is CLOSED.
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

describe('goals immutable after cycle close (WP-9)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string;
  let companyId: string;
  let cycleId: string;
  let goalId: string;

  const adminEmail = `wp9.admin.${STAMP}@example.test`;
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
      .send({ companyName: `Wp9 Alpha ${STAMP}`, sector: 'TECHNOLOGY', firstName: 'Wp9', lastName: 'Admin', email: adminEmail, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(201);
    adminCookie = sessionCookie(login);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error('No membership created for admin');
    companyId = membership.companyId;

    const emp = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Goal',
        lastName: 'Owner',
        workEmail: `wp9.worker.${STAMP}@example.test`,
        hireDate: '2026-01-05',
        jobTitle: 'Analyst',
      })
      .expect(201);

    const cycle = await request(server())
      .post('/performance/cycles')
      .set('Cookie', adminCookie)
      .send({ name: `H1 ${STAMP}`, startDate: '2026-01-01', endDate: '2026-06-30' })
      .expect(201);
    cycleId = cycle.body.id;

    const goal = await request(server())
      .post('/performance/goals')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: emp.body.id, title: 'Ship the thing', weight: 50 })
      .expect(201);
    goalId = goal.body.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('goals in an open cycle can be updated', async () => {
    const res = await request(server())
      .patch(`/performance/goals/${goalId}`)
      .set('Cookie', adminCookie)
      .send({ progress: 40 })
      .expect(200);
    expect(res.body.progress).toBe(40);
  });

  it('goals in a CLOSED cycle reject updates with 409 and stay unchanged', async () => {
    await request(server())
      .post(`/performance/cycles/${cycleId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CLOSED' })
      .expect(201);

    const res = await request(server())
      .patch(`/performance/goals/${goalId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Rewritten history', progress: 100 });
    expect(res.status).toBe(409);

    const row = await prisma.tenant(companyId).goal.findUnique({ where: { id: goalId } });
    expect(row?.title).toBe('Ship the thing');
    expect(row?.progress).toBe(40);
  });
});
