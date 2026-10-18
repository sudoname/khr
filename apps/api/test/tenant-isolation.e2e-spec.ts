/**
 * End-to-end tests against the real Nest app, Postgres and Redis
 * (docker-compose infra must be running and migrations applied).
 *
 * Covers the two risk areas the platform is built around:
 *   1. Tenant isolation — one company can never read or mutate another
 *      company's records, even with a valid session.
 *   2. Employee self-onboarding — submit → HR review → reject/resubmit →
 *      approve → terms acceptance, including field-level bank/BVN exposure.
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

interface Tenant {
  email: string;
  cookie: string;
  companyId: string;
  userId: string;
  membershipId: string;
}

describe('PeopleFlow e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let a: Tenant; // "Acme E2E" — attacker/victim depending on the test
  let b: Tenant; // "Beta E2E"
  let empA: { id: string }; // employee owned by company A
  let empB: { id: string }; // employee owned by company B

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

  async function provisionTenant(companyName: string, email: string): Promise<Tenant> {
    await request(server())
      .post('/auth/register')
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'E2e', lastName: 'Admin', email, password: PASSWORD })
      .expect(201);
    // Email delivery is out of scope here; verify directly in the database.
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });

    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    const cookie = sessionCookie(login);

    // Auth-scoped read so the lookup also works when the suite connects with
    // the production khr_app credentials (fail-closed RLS).
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership created for ${email}`);
    return {
      email,
      cookie,
      companyId: membership.companyId,
      userId: membership.userId,
      membershipId: membership.id,
    };
  }

  async function createEmployee(tenant: Tenant, suffix: string): Promise<{ id: string }> {
    const res = await request(server())
      .post('/employees')
      .set('Cookie', tenant.cookie)
      .send({
        firstName: 'Worker',
        lastName: suffix,
        workEmail: `worker.${suffix.toLowerCase()}.${STAMP}@example.test`,
        hireDate: '2026-01-05',
        jobTitle: 'Software Engineer',
      })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);

    // Repeated local runs must not trip the register/login rate limiters.
    await flushRateLimits();

    a = await provisionTenant('Acme E2E', `admin.a.${STAMP}@example.test`);
    b = await provisionTenant('Beta E2E', `admin.b.${STAMP}@example.test`);
    empA = await createEmployee(a, 'Alpha');
    empB = await createEmployee(b, 'Beta');
  });

  afterAll(async () => {
    // Companies cascade to employees/memberships/etc.; users are removed last.
    await prisma.company.deleteMany({ where: { id: { in: [a.companyId, b.companyId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [a.email, b.email] } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  // ───────────────────────── tenant isolation ─────────────────────────

  describe('tenant isolation', () => {
    it('rejects unauthenticated requests', async () => {
      await request(server()).get('/employees').expect(401);
      await request(server()).get('/onboarding/me').expect(401);
    });

    it('lists only the active company employees', async () => {
      const res = await request(server())
        .get('/employees')
        .set('Cookie', a.cookie)
        .expect(200);
      const ids = res.body.items.map((e: { id: string }) => e.id);
      expect(ids).toContain(empA.id);
      expect(ids).not.toContain(empB.id);
    });

    it('returns 404 when reading another tenant employee by id', async () => {
      await request(server()).get(`/employees/${empB.id}`).set('Cookie', a.cookie).expect(404);
      await request(server()).get(`/employees/${empA.id}`).set('Cookie', b.cookie).expect(404);
    });

    it('returns 404 when mutating another tenant employee', async () => {
      await request(server())
        .patch(`/employees/${empB.id}`)
        .set('Cookie', a.cookie)
        .send({ jobTitle: 'Hijacked Title' })
        .expect(404);
      await request(server())
        .post(`/employees/${empB.id}/terminate`)
        .set('Cookie', a.cookie)
        .send({ terminationDate: '2026-02-01', reason: 'cross-tenant attempt' })
        .expect(404);
    });

    it('returns 404 for another tenant employee history', async () => {
      await request(server())
        .get(`/employees/${empB.id}/history`)
        .set('Cookie', a.cookie)
        .expect(404);
    });

    it('cross-tenant mutation attempts leave the record untouched', async () => {
      const res = await request(server())
        .get(`/employees/${empB.id}`)
        .set('Cookie', b.cookie)
        .expect(200);
      expect(res.body.jobTitle).toBe('Software Engineer');
      expect(res.body.status).toBe('ACTIVE');
    });

    it('forbids switching into a company the user is not a member of', async () => {
      await request(server())
        .post('/auth/switch-company')
        .set('Cookie', a.cookie)
        .send({ companyId: b.companyId })
        .expect(403);
    });

    it('allows switching into the user own company', async () => {
      const res = await request(server())
        .post('/auth/switch-company')
        .set('Cookie', a.cookie)
        .send({ companyId: a.companyId })
        .expect(201);
      expect(res.body.activeCompanyId).toBe(a.companyId);
    });
  });

  // ───────────────────────── onboarding flow ─────────────────────────

  describe('employee self-onboarding', () => {
    const validSubmission = {
      phone: '+2348012345678',
      dateOfBirth: '1995-04-12',
      gender: 'FEMALE',
      addressLine1: '12 Marina Road',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'NG',
      bankName: 'GTBank',
      bankAccountNumber: '0123456789',
      bvn: '12345678901',
      emergencyContact: {
        name: 'Next Of Kin',
        relationship: 'Sibling',
        phone: '+2348098765432',
        email: '',
      },
    };

    beforeAll(async () => {
      // Link each admin's membership to their company's employee record so
      // self-service endpoints resolve an employee for the session. Tenant-
      // scoped so the fixture also works under fail-closed RLS (khr_app).
      await prisma.tenant(a.companyId).membership.update({
        where: { id: a.membershipId },
        data: { employeeId: empA.id },
      });
      await prisma.tenant(b.companyId).membership.update({
        where: { id: b.membershipId },
        data: { employeeId: empB.id },
      });
    });

    it('starts as NOT_SUBMITTED with terms text available', async () => {
      const res = await request(server()).get('/onboarding/me').set('Cookie', a.cookie).expect(200);
      expect(res.body.status).toBe('NOT_SUBMITTED');
      expect(res.body.termsAcceptedAt).toBeNull();
      expect(typeof res.body.terms).toBe('string');
      expect(res.body.terms.length).toBeGreaterThan(10);
    });

    it('refuses terms acceptance before approval', async () => {
      await request(server()).post('/onboarding/accept-terms').set('Cookie', a.cookie).expect(409);
    });

    it('rejects an invalid submission (bad NUBAN)', async () => {
      await request(server())
        .post('/onboarding/submit')
        .set('Cookie', a.cookie)
        .send({ ...validSubmission, bankAccountNumber: '12345' })
        .expect(400);
    });

    it('accepts a valid submission and moves to SUBMITTED', async () => {
      const res = await request(server())
        .post('/onboarding/submit')
        .set('Cookie', a.cookie)
        .send(validSubmission)
        .expect(201);
      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.submittedAt).toBeTruthy();
      expect(res.body.profile.bankAccountNumber).toBe('0123456789');
    });

    it('refuses a second submission while awaiting review', async () => {
      await request(server())
        .post('/onboarding/submit')
        .set('Cookie', a.cookie)
        .send(validSubmission)
        .expect(409);
    });

    it('shows the submission in the pending queue with bank details for authorized reviewers', async () => {
      const res = await request(server())
        .get('/onboarding/pending')
        .set('Cookie', a.cookie)
        .expect(200);
      const row = res.body.find((r: { id: string }) => r.id === empA.id);
      expect(row).toBeTruthy();
      // COMPANY_ADMIN holds compensation.read, so restricted fields are visible.
      expect(row.bankAccountNumber).toBe('0123456789');
      expect(row.bvn).toBe('12345678901');
    });

    it('never leaks pending submissions across tenants', async () => {
      const res = await request(server())
        .get('/onboarding/pending')
        .set('Cookie', b.cookie)
        .expect(200);
      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).not.toContain(empA.id);
    });

    it('blocks cross-tenant reviews with 404', async () => {
      await request(server())
        .post(`/onboarding/${empA.id}/review`)
        .set('Cookie', b.cookie)
        .send({ decision: 'APPROVED' })
        .expect(404);
    });

    it('supports rejection with a note and resubmission', async () => {
      await request(server())
        .post(`/onboarding/${empA.id}/review`)
        .set('Cookie', a.cookie)
        .send({ decision: 'REJECTED', note: 'Please confirm your bank name' })
        .expect(201);

      const rejected = await request(server())
        .get('/onboarding/me')
        .set('Cookie', a.cookie)
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.note).toBe('Please confirm your bank name');

      const resubmit = await request(server())
        .post('/onboarding/submit')
        .set('Cookie', a.cookie)
        .send({ ...validSubmission, bankName: 'Zenith Bank' })
        .expect(201);
      expect(resubmit.body.status).toBe('SUBMITTED');
      expect(resubmit.body.note).toBeNull();
    });

    it('refuses to review a profile that is not awaiting review', async () => {
      await request(server())
        .post(`/onboarding/${empB.id}/review`)
        .set('Cookie', b.cookie)
        .send({ decision: 'APPROVED' })
        .expect(409);
    });

    it('approves the profile and records terms acceptance', async () => {
      await request(server())
        .post(`/onboarding/${empA.id}/review`)
        .set('Cookie', a.cookie)
        .send({ decision: 'APPROVED' })
        .expect(201);

      const approved = await request(server())
        .get('/onboarding/me')
        .set('Cookie', a.cookie)
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.termsAcceptedAt).toBeNull();

      const accepted = await request(server())
        .post('/onboarding/accept-terms')
        .set('Cookie', a.cookie)
        .expect(201);
      expect(accepted.body.termsAcceptedAt).toBeTruthy();

      // Idempotent: a second acceptance keeps the original timestamp.
      const again = await request(server())
        .post('/onboarding/accept-terms')
        .set('Cookie', a.cookie)
        .expect(201);
      expect(again.body.termsAcceptedAt).toBe(accepted.body.termsAcceptedAt);
    });

    it('refuses resubmission after approval', async () => {
      await request(server())
        .post('/onboarding/submit')
        .set('Cookie', a.cookie)
        .send(validSubmission)
        .expect(409);
    });
  });
});
