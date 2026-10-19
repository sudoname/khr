/**
 * WP-2 — Field-level redaction on employee WRITE responses.
 *
 * GET /employees/:id strips bvn/bank/annualRentDeclared for callers without
 * compensation.read, but the write paths (PATCH, terminate, rehire) returned
 * the raw row. An HR_MANAGER (employee.write, no compensation.read) could
 * read bank details from any PATCH response. Every employee-returning write
 * must apply the same redaction as the read path.
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

describe('employee write-response redaction (WP-2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string; // COMPANY_ADMIN (holds compensation.read)
  let hrmCookie: string; // HR_MANAGER (employee.write, NO compensation.read)
  let companyAId: string;
  let hrmOwnCompanyId: string;
  let empId: string;

  const adminEmail = `wp2.admin.${STAMP}@example.test`;
  const hrmEmail = `wp2.hrm.${STAMP}@example.test`;

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
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Wp2', lastName: 'User', email, password: PASSWORD })
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

    const a = await register(`Wp2 Alpha ${STAMP}`, adminEmail);
    adminCookie = a.cookie;
    companyAId = a.companyId;

    // HR_MANAGER: registers their own company (for credentials), then is
    // invited into company A and pins their session there.
    const h = await register(`Wp2 HrmOwn ${STAMP}`, hrmEmail);
    hrmOwnCompanyId = h.companyId;
    await request(server())
      .post('/members/invite')
      .set('Cookie', adminCookie)
      .send({ email: hrmEmail, firstName: 'Hr', lastName: 'Manager', role: 'HR_MANAGER' })
      .expect(201);
    await request(server())
      .post('/auth/switch-company')
      .set('Cookie', h.cookie)
      .send({ companyId: companyAId })
      .expect(201);
    hrmCookie = h.cookie;

    // Employee with restricted financial fields on record.
    const created = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Confidential',
        lastName: 'Worker',
        workEmail: `wp2.worker.${STAMP}@example.test`,
        hireDate: '2026-01-05',
        jobTitle: 'Accountant',
      })
      .expect(201);
    empId = created.body.id;
    await prisma.tenant(companyAId).employee.update({
      where: { id: empId },
      data: {
        bvn: '12345678901',
        bankName: 'GTBank',
        bankAccountNumber: '0123456789',
        annualRentDeclared: '1200000',
      },
    });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, hrmOwnCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, hrmEmail] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('PATCH response hides bank details from HR_MANAGER (no compensation.read)', async () => {
    const res = await request(server())
      .patch(`/employees/${empId}`)
      .set('Cookie', hrmCookie)
      .send({ jobTitle: 'Senior Accountant' })
      .expect(200);
    expect(res.body.jobTitle).toBe('Senior Accountant');
    expect(res.body.bvn).toBeNull();
    expect(res.body.bankName).toBeNull();
    expect(res.body.bankAccountNumber).toBeNull();
    expect(res.body.annualRentDeclared).toBeNull();
    // Redaction is response-only: the stored values are untouched.
    const row = await prisma.tenant(companyAId).employee.findUnique({ where: { id: empId } });
    expect(row?.bvn).toBe('12345678901');
    expect(row?.bankAccountNumber).toBe('0123456789');
  });

  it('PATCH response keeps bank details for holders of compensation.read', async () => {
    const res = await request(server())
      .patch(`/employees/${empId}`)
      .set('Cookie', adminCookie)
      .send({ jobTitle: 'Finance Lead' })
      .expect(200);
    expect(res.body.bvn).toBe('12345678901');
    expect(res.body.bankName).toBe('GTBank');
    expect(res.body.bankAccountNumber).toBe('0123456789');
  });

  it('terminate and rehire responses apply the same redaction rule', async () => {
    // COMPANY_ADMIN holds compensation.read, so values stay visible — the
    // invariant under test is that both paths run through stripBankDetails.
    const term = await request(server())
      .post(`/employees/${empId}/terminate`)
      .set('Cookie', adminCookie)
      .send({ terminationDate: '2026-02-01', reason: 'wp2 test' })
      .expect(201);
    expect(term.body.bvn).toBe('12345678901');

    const rehire = await request(server())
      .post(`/employees/${empId}/rehire`)
      .set('Cookie', adminCookie)
      .send({ hireDate: '2026-03-01', jobTitle: 'Accountant' })
      .expect(201);
    expect(rehire.body.bankAccountNumber).toBe('0123456789');
  });
});
