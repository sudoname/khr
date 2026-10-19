/**
 * WP-1 — Role-grant matrix.
 *
 * members.manage alone must not allow privilege escalation: an HR_ADMIN
 * (or any non-COMPANY_ADMIN holder of members.manage) may never create,
 * promote, demote or remove a membership at or above their own rank.
 * COMPANY_ADMIN may act on other COMPANY_ADMINs, still subject to the
 * last-admin guard.
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

describe('role-grant matrix (WP-1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let adminCookie: string; // COMPANY_ADMIN of company A
  let hrCookie: string; // HR_ADMIN inside company A
  let companyAId: string;
  let hrOwnCompanyId: string; // HR user's own registration company (gives them a password)
  let empMembershipId: string; // plain EMPLOYEE membership in company A

  const adminEmail = `wp1.admin.${STAMP}@example.test`;
  const hrEmail = `wp1.hr.${STAMP}@example.test`;
  const empEmail = `wp1.emp.${STAMP}@example.test`;

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
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Wp1', lastName: 'User', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership created for ${email}`);
    return { cookie: sessionCookie(login), companyId: membership.companyId };
  }

  async function membershipIdFor(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const membership = await prisma
      .tenant(companyAId)
      .membership.findFirst({ where: { userId: user.id, companyId: companyAId } });
    if (!membership) throw new Error(`No membership in company A for ${email}`);
    return membership.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    // Company A with its COMPANY_ADMIN.
    const a = await register(`Wp1 Alpha ${STAMP}`, adminEmail);
    adminCookie = a.cookie;
    companyAId = a.companyId;

    // The HR user registers their own company first (so they have a usable
    // password), then gets invited into company A as HR_ADMIN.
    const h = await register(`Wp1 HrOwn ${STAMP}`, hrEmail);
    hrOwnCompanyId = h.companyId;
    await request(server())
      .post('/members/invite')
      .set('Cookie', adminCookie)
      .send({ email: hrEmail, firstName: 'Hr', lastName: 'Admin', role: 'HR_ADMIN' })
      .expect(201);
    // Pin the HR session to company A.
    await request(server())
      .post('/auth/switch-company')
      .set('Cookie', h.cookie)
      .send({ companyId: companyAId })
      .expect(201);
    hrCookie = h.cookie;

    // A plain EMPLOYEE membership in company A (new-user invite path).
    await request(server())
      .post('/members/invite')
      .set('Cookie', adminCookie)
      .send({ email: empEmail, firstName: 'Plain', lastName: 'Employee', role: 'EMPLOYEE' })
      .expect(201);
    empMembershipId = await membershipIdFor(empEmail);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, hrOwnCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, hrEmail, empEmail] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('HR_ADMIN cannot promote a member to COMPANY_ADMIN', async () => {
    const res = await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', hrCookie)
      .send({ role: 'COMPANY_ADMIN' });
    expect(res.status).toBe(403);
    const membership = await prisma.tenant(companyAId).membership.findUnique({ where: { id: empMembershipId } });
    expect(membership?.role).toBe('EMPLOYEE');
  });

  it('HR_ADMIN cannot promote a member to HR_ADMIN (own rank)', async () => {
    await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', hrCookie)
      .send({ role: 'HR_ADMIN' })
      .expect(403);
  });

  it('HR_ADMIN cannot invite a new COMPANY_ADMIN', async () => {
    const email = `wp1.rogue.${STAMP}@example.test`;
    await request(server())
      .post('/members/invite')
      .set('Cookie', hrCookie)
      .send({ email, firstName: 'Rogue', lastName: 'Admin', role: 'COMPANY_ADMIN' })
      .expect(403);
    // The rejected invite must not have created a user.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('HR_ADMIN can still manage roles below their own rank', async () => {
    await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', hrCookie)
      .send({ role: 'HR_MANAGER' })
      .expect(200);
    await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', hrCookie)
      .send({ role: 'EMPLOYEE' })
      .expect(200);
  });

  it('COMPANY_ADMIN can promote a member to COMPANY_ADMIN', async () => {
    const res = await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'COMPANY_ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('COMPANY_ADMIN');
  });

  it('HR_ADMIN cannot demote a COMPANY_ADMIN', async () => {
    // Two admins exist now, so the last-admin guard does not mask the rank check.
    await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', hrCookie)
      .send({ role: 'EMPLOYEE' })
      .expect(403);
  });

  it('HR_ADMIN cannot remove a COMPANY_ADMIN', async () => {
    await request(server()).delete(`/members/${empMembershipId}`).set('Cookie', hrCookie).expect(403);
    const membership = await prisma.tenant(companyAId).membership.findUnique({ where: { id: empMembershipId } });
    expect(membership?.role).toBe('COMPANY_ADMIN');
  });

  it('COMPANY_ADMIN can demote another COMPANY_ADMIN (not the last one)', async () => {
    await request(server())
      .patch(`/members/${empMembershipId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'EMPLOYEE' })
      .expect(200);
  });

  it('HR_ADMIN can remove a member below their rank', async () => {
    await request(server()).delete(`/members/${empMembershipId}`).set('Cookie', hrCookie).expect(200);
  });
});
