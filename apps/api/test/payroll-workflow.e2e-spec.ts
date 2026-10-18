/**
 * End-to-end tests for the payroll workflow controls (docker-compose infra
 * must be running and migrations applied):
 *
 *   state machine   DRAFT → PENDING_APPROVAL → APPROVED → PAID, with atomic
 *                   from-state preconditions
 *   SoD             maker–checker: creator/submitter can never approve their
 *                   own run, even as COMPANY_ADMIN
 *   attestation     tax-engine version must be human-approved before any run
 *                   can be finalized
 *   reconciliation  payslip sums must exactly match the run totals stamped at
 *                   compute time (tamper detection)
 *   export          bank schedule CSV only for APPROVED/PAID runs
 *   audit           every transition leaves a tenant-readable audit row
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
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
const YEAR = 2026; // NTA 2025 regime period

describe('Payroll workflow e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let makerCookie: string; // registered admin: prepares + submits runs
  let makerUserId: string;
  let makerMembershipId: string;
  let checkerCookie: string; // second admin: approves / rejects / pays
  let checkerUserId: string;
  let outsiderCookie: string; // admin of an unrelated company
  let outsiderCompanyId: string;
  let employeeId: string;
  let runId: string;
  let requiredVersion: string;

  const server = () => app.getHttpServer();
  const tenant = () => prisma.tenant(companyId);

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

  async function login(email: string): Promise<string> {
    const res = await request(server()).post('/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(201);
    return sessionCookie(res);
  }

  async function registerAdmin(companyName: string, email: string) {
    await request(server())
      .post('/auth/register')
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Pay', lastName: 'Admin', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const cookie = await login(email);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership for ${email}`);
    return { user, cookie, membership };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    // Maker: company owner via normal registration.
    const maker = await registerAdmin(`Payroll E2E ${STAMP}`, `pay.maker.${STAMP}@example.test`);
    makerCookie = maker.cookie;
    makerUserId = maker.user.id;
    makerMembershipId = maker.membership.id;
    companyId = maker.membership.companyId;

    // Checker: second COMPANY_ADMIN in the same company, seeded directly
    // (invite emails are out of scope here).
    const checker = await prisma.user.create({
      data: {
        email: `pay.checker.${STAMP}@example.test`,
        firstName: 'Pay',
        lastName: 'Checker',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    checkerUserId = checker.id;
    await tenant().membership.create({
      data: { userId: checker.id, companyId, role: 'COMPANY_ADMIN' },
    });
    checkerCookie = await login(checker.email);

    // Outsider: admin of an unrelated company, for cross-tenant checks.
    const outsider = await registerAdmin(`Payroll Outsider ${STAMP}`, `pay.outsider.${STAMP}@example.test`);
    outsiderCookie = outsider.cookie;
    outsiderCompanyId = outsider.membership.companyId;

    // One employee with a monthly compensation so runs produce a payslip.
    const emp = await request(server())
      .post('/employees')
      .set('Cookie', makerCookie)
      .send({
        firstName: 'Paid',
        lastName: 'Worker',
        workEmail: `paid.worker.${STAMP}@example.test`,
        hireDate: '2025-06-01',
        jobTitle: 'Engineer',
      })
      .expect(201);
    employeeId = emp.body.id;
    await request(server())
      .post(`/employees/${employeeId}/compensation`)
      .set('Cookie', makerCookie)
      .send({ effectiveDate: '2025-06-01', baseSalary: '500000.00', currency: 'NGN', payFrequency: 'MONTHLY' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, outsiderCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${STAMP}@example.test` } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  // ───────────────────────── run creation & compute ─────────────────────────

  it('creates a run in DRAFT with computed payslips and a stamped engine version', async () => {
    const res = await request(server())
      .post('/payroll/runs')
      .set('Cookie', makerCookie)
      .send({ year: YEAR, month: 1 })
      .expect(201);
    runId = res.body.id;
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.taxRegime).toBe('NTA_2025');
    expect(res.body.engineVersion).toMatch(/^NTA_2025@/);
    expect(res.body.payslips).toHaveLength(1);
    expect(Number(res.body.totalGross)).toBe(500000);
    expect(Number(res.body.totalNet)).toBeGreaterThan(0);
  });

  it('rejects a duplicate run for the same period', async () => {
    await request(server())
      .post('/payroll/runs')
      .set('Cookie', makerCookie)
      .send({ year: YEAR, month: 1 })
      .expect(409);
  });

  it('is invisible to other tenants', async () => {
    await request(server()).get(`/payroll/runs/${runId}`).set('Cookie', outsiderCookie).expect(404);
    await request(server()).post(`/payroll/runs/${runId}/submit`).set('Cookie', outsiderCookie).expect(404);
  });

  // ───────────────────────── state machine ─────────────────────────

  it('cannot approve or export a DRAFT run', async () => {
    await request(server()).post(`/payroll/runs/${runId}/approve`).set('Cookie', checkerCookie).expect(400);
    await request(server()).get(`/payroll/runs/${runId}/bank-schedule`).set('Cookie', makerCookie).expect(400);
  });

  it('submit moves DRAFT to PENDING_APPROVAL and records the submitter', async () => {
    const res = await request(server())
      .post(`/payroll/runs/${runId}/submit`)
      .set('Cookie', makerCookie)
      .expect(201);
    expect(res.body.status).toBe('PENDING_APPROVAL');
    expect(res.body.submittedById).toBe(makerUserId);
    expect(res.body.submittedAt).toBeTruthy();
  });

  it('submit is not repeatable (atomic from-state guard)', async () => {
    await request(server()).post(`/payroll/runs/${runId}/submit`).set('Cookie', makerCookie).expect(400);
  });

  // ───────────────────────── segregation of duties ─────────────────────────

  it('blocks the submitter from approving their own run', async () => {
    const res = await request(server())
      .post(`/payroll/runs/${runId}/approve`)
      .set('Cookie', makerCookie)
      .expect(403);
    expect(res.body.code).toBe('PAYROLL_SOD_VIOLATION');
  });

  // ───────────────────────── tax-rules attestation gate ─────────────────────────

  it('blocks approval until the tax engine version is attested', async () => {
    const res = await request(server())
      .post(`/payroll/runs/${runId}/approve`)
      .set('Cookie', checkerCookie)
      .expect(400);
    expect(res.body.code).toBe('TAX_RULES_NOT_APPROVED');

    const status = await request(server()).get('/payroll/tax-status').set('Cookie', checkerCookie).expect(200);
    expect(status.body.approved).toBe(false);
    requiredVersion = status.body.requiredVersion;

    await request(server())
      .post('/payroll/settings/approve-tax-rules')
      .set('Cookie', checkerCookie)
      .send({ version: requiredVersion })
      .expect(201);
    const after = await request(server()).get('/payroll/tax-status').set('Cookie', checkerCookie).expect(200);
    expect(after.body.approved).toBe(true);
  });

  // ───────────────────────── reconciliation gate ─────────────────────────

  it('blocks approval when payslips no longer reconcile with the run totals', async () => {
    const slip = await tenant().payslip.findFirstOrThrow({ where: { runId } });
    const original = slip.netPay;
    await tenant().payslip.update({ where: { id: slip.id }, data: { netPay: original.add(1000) } });

    const res = await request(server())
      .post(`/payroll/runs/${runId}/approve`)
      .set('Cookie', checkerCookie)
      .expect(409);
    expect(res.body.code).toBe('RECONCILIATION_MISMATCH');

    await tenant().payslip.update({ where: { id: slip.id }, data: { netPay: original } });
  });

  // ───────────────────────── approve → export → pay ─────────────────────────

  it('a second admin approves the reconciled run', async () => {
    const res = await request(server())
      .post(`/payroll/runs/${runId}/approve`)
      .set('Cookie', checkerCookie)
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.approvedById).toBe(checkerUserId);
    expect(res.body.approvedAt).toBeTruthy();
  });

  it('approved runs are frozen: no recompute', async () => {
    await request(server()).post(`/payroll/runs/${runId}/recompute`).set('Cookie', makerCookie).expect(400);
  });

  it('exports the bank schedule CSV for the approved run', async () => {
    const res = await request(server())
      .get(`/payroll/runs/${runId}/bank-schedule`)
      .set('Cookie', makerCookie)
      .expect(200);
    expect(res.headers['content-type']).toContain('csv');
    const text = res.text ?? res.body.toString();
    expect(text).toContain('employeeNo');
    expect(text).toContain('Salary 2026-01');
  });

  it('mark-paid records the payer and emails payslips', async () => {
    const res = await request(server())
      .post(`/payroll/runs/${runId}/mark-paid`)
      .set('Cookie', checkerCookie)
      .expect(201);
    expect(res.body.status).toBe('PAID');
    expect(res.body.paidById).toBe(checkerUserId);
    expect(res.body.paidAt).toBeTruthy();
  });

  it('employee self-service shows the paid payslip', async () => {
    // Link the maker's membership to the employee record for /payslips/me.
    await tenant().membership.update({ where: { id: makerMembershipId }, data: { employeeId } });
    const res = await request(server()).get('/payroll/payslips/me').set('Cookie', makerCookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].run.year).toBe(YEAR);
  });

  // ───────────────────────── reject path & creator SoD ─────────────────────────

  it('reject returns a submitted run to DRAFT with a note and clears the submitter', async () => {
    const run = await request(server())
      .post('/payroll/runs')
      .set('Cookie', makerCookie)
      .send({ year: YEAR, month: 2 })
      .expect(201);
    await request(server()).post(`/payroll/runs/${run.body.id}/submit`).set('Cookie', makerCookie).expect(201);
    const rejected = await request(server())
      .post(`/payroll/runs/${run.body.id}/reject`)
      .set('Cookie', checkerCookie)
      .send({ note: 'Numbers look off, please recheck' })
      .expect(201);
    expect(rejected.body.status).toBe('DRAFT');
    expect(rejected.body.note).toBe('Numbers look off, please recheck');
    expect(rejected.body.submittedById).toBeNull();
    expect(rejected.body.submittedAt).toBeNull();
  });

  it('blocks the creator from approving a run someone else submitted', async () => {
    const run = await request(server())
      .post('/payroll/runs')
      .set('Cookie', checkerCookie) // checker prepares…
      .send({ year: YEAR, month: 3 })
      .expect(201);
    await request(server()).post(`/payroll/runs/${run.body.id}/submit`).set('Cookie', makerCookie).expect(201);
    const res = await request(server())
      .post(`/payroll/runs/${run.body.id}/approve`)
      .set('Cookie', checkerCookie) // …so the checker may not approve it
      .expect(403);
    expect(res.body.code).toBe('PAYROLL_SOD_VIOLATION');
  });

  // ───────────────────────── audit trail ─────────────────────────

  it('every transition left a tenant-readable audit row', async () => {
    const actions = [
      'payroll.run_created',
      'payroll.run_computed',
      'payroll.run_submitted',
      'payroll.run_approved',
      'payroll.run_rejected',
      'payroll.run_paid',
      'payroll.tax_rules_approved',
      'payroll.bank_schedule_exported',
    ];
    for (const action of actions) {
      const count = await tenant().auditLog.count({ where: { action } });
      expect({ action, count: count > 0 }).toEqual({ action, count: true });
    }
  });
});
