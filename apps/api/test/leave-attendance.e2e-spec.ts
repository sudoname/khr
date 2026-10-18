/**
 * End-to-end tests for the leave and attendance workflows (docker-compose
 * infra must be running and migrations applied):
 *
 *   leave setup      types (unique code), policies, holidays — admin-only
 *   leave requests   working-day math (weekends + holidays excluded), overlap
 *                    and balance checks at request time, approval SoD (no
 *                    self-approval), balance deduction on approval only,
 *                    refund on cancelling an approved request
 *   balances         entitlement seeding, manual adjustment, availability math
 *   attendance       clock-in/out state machine, late detection against the
 *                    company policy, correction request → review flow with
 *                    reviewer SoD, record materialization from corrections
 *   tenancy          nothing leaks to or from an unrelated company
 *   audit            every action leaves a tenant-readable audit row
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

// Fixed leave window far enough in the future to be deterministic.
// 2026-11-02 is a Monday; 2026-11-06 a Friday; 2026-11-04 becomes a holiday.
const LEAVE_START = '2026-11-02';
const LEAVE_END = '2026-11-06';
const HOLIDAY = '2026-11-04';
const LEAVE_YEAR = 2026;

// Day keys relative to "now" for attendance corrections. UTC-yesterday is
// never in the future for the company timezone (Africa/Lagos, UTC+1).
const dayStr = (offsetDays: number) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
const YESTERDAY = dayStr(1);
const TWO_DAYS_AGO = dayStr(2);
const FUTURE_DAY = dayStr(-2);

describe('Leave & attendance workflow e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let adminCookie: string; // company owner: configures policies, approves
  let adminMembershipId: string;
  let adminEmployeeId: string;
  let workerCookie: string; // plain EMPLOYEE: requests leave, clocks in
  let workerEmployeeId: string;
  let outsiderCookie: string; // admin of an unrelated company
  let outsiderCompanyId: string;

  let leaveTypeId: string;
  let leaveRequestId: string; // the main 4-day request
  let correctionId: string; // the worker's correction for YESTERDAY

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
      .send({ companyName, sector: 'TECHNOLOGY', firstName: 'Hr', lastName: 'Admin', email, password: PASSWORD })
      .expect(201);
    const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const cookie = await login(email);
    const membership = await prisma.auth(user.id).membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error(`No membership for ${email}`);
    return { user, cookie, membership };
  }

  async function createEmployee(firstName: string, lastName: string): Promise<string> {
    const res = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName,
        lastName,
        workEmail: `${firstName}.${lastName}.${STAMP}@example.test`.toLowerCase(),
        hireDate: '2025-06-01',
        jobTitle: 'Engineer',
      })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    // Admin: company owner via normal registration, with a linked employee
    // record so they can also act as a requester/clocker in SoD tests.
    const admin = await registerAdmin(`Leave E2E ${STAMP}`, `leave.admin.${STAMP}@example.test`);
    adminCookie = admin.cookie;
    adminMembershipId = admin.membership.id;
    companyId = admin.membership.companyId;
    adminEmployeeId = await createEmployee('Boss', 'Person');
    await tenant().membership.update({ where: { id: adminMembershipId }, data: { employeeId: adminEmployeeId } });

    // Worker: EMPLOYEE-role member with their own employee record, seeded
    // directly (invite emails are out of scope here).
    workerEmployeeId = await createEmployee('Rank', 'File');
    const worker = await prisma.user.create({
      data: {
        email: `leave.worker.${STAMP}@example.test`,
        firstName: 'Rank',
        lastName: 'File',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    await tenant().membership.create({
      data: { userId: worker.id, companyId, role: 'EMPLOYEE', employeeId: workerEmployeeId },
    });
    workerCookie = await login(worker.email);

    // Outsider: admin of an unrelated company, for cross-tenant checks.
    const outsider = await registerAdmin(`Leave Outsider ${STAMP}`, `leave.outsider.${STAMP}@example.test`);
    outsiderCookie = outsider.cookie;
    outsiderCompanyId = outsider.membership.companyId;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [companyId, outsiderCompanyId] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${STAMP}@example.test` } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  // ───────────────────────── leave setup (types, policy, holiday) ─────────────────────────

  it('admin creates a paid leave type; duplicate codes are rejected', async () => {
    const res = await request(server())
      .post('/leave/types')
      .set('Cookie', adminCookie)
      .send({ name: 'Annual Leave', code: 'ANNUAL', paid: true, allowHalfDay: true })
      .expect(201);
    leaveTypeId = res.body.id;

    await request(server())
      .post('/leave/types')
      .set('Cookie', adminCookie)
      .send({ name: 'Annual Again', code: 'ANNUAL' })
      .expect(409);
  });

  it('plain employees cannot manage leave types or policies', async () => {
    await request(server())
      .post('/leave/types')
      .set('Cookie', workerCookie)
      .send({ name: 'Sneaky', code: 'SNEAKY' })
      .expect(403);
    await request(server())
      .put('/leave/policies')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, annualEntitlementDays: 365 })
      .expect(403);
  });

  it('admin sets the policy (20 days, 1 approval level) and a holiday', async () => {
    const policy = await request(server())
      .put('/leave/policies')
      .set('Cookie', adminCookie)
      .send({ leaveTypeId, accrualMethod: 'ANNUAL_GRANT', annualEntitlementDays: 20, approvalLevels: 1 })
      .expect(200);
    expect(Number(policy.body.annualEntitlementDays)).toBe(20);

    await request(server())
      .post('/leave/holidays')
      .set('Cookie', adminCookie)
      .send({ name: 'E2E Holiday', date: HOLIDAY })
      .expect(201);
  });

  it('seeds the balance from the policy entitlement', async () => {
    const res = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    const bal = res.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(bal).toBeDefined();
    expect(Number(bal.entitledDays)).toBe(20);
    expect(Number(bal.usedDays)).toBe(0);
    expect(Number(bal.availableDays)).toBe(20);
  });

  // ───────────────────────── request validation ─────────────────────────

  it('computes working days excluding weekends and holidays', async () => {
    // Mon 2026-11-02 → Fri 2026-11-06 minus the Wed holiday = 4 days.
    const res = await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: LEAVE_START, endDate: LEAVE_END, reason: 'Family trip' })
      .expect(201);
    leaveRequestId = res.body.id;
    expect(res.body.status).toBe('PENDING');
    expect(Number(res.body.totalDays)).toBe(4);
    expect(res.body.approvals).toHaveLength(1);
  });

  it('rejects inverted ranges, overlaps, and over-balance requests', async () => {
    await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: LEAVE_END, endDate: LEAVE_START })
      .expect(400);

    await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: HOLIDAY, endDate: '2026-11-10' })
      .expect(409); // overlaps the pending request

    // Dec 2026 has 23 weekdays — more than the 20-day entitlement.
    const res = await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: '2026-12-01', endDate: '2026-12-31' })
      .expect(400);
    expect(res.body.message).toMatch(/Insufficient balance/);
  });

  it('cannot request leave on behalf of someone else without leave.request.any', async () => {
    await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ employeeId: adminEmployeeId, leaveTypeId, startDate: '2026-11-10', endDate: '2026-11-10' })
      .expect(403);
  });

  it('is invisible to other tenants', async () => {
    await request(server()).get(`/leave/requests/${leaveRequestId}`).set('Cookie', outsiderCookie).expect(404);
    await request(server())
      .post(`/leave/requests/${leaveRequestId}/decision`)
      .set('Cookie', outsiderCookie)
      .send({ decision: 'APPROVED' })
      .expect(404);
    const types = await request(server()).get('/leave/types').set('Cookie', outsiderCookie).expect(200);
    expect(types.body.some((t: { id: string }) => t.id === leaveTypeId)).toBe(false);
  });

  // ───────────────────────── approval flow & SoD ─────────────────────────

  it('plain employees cannot decide requests', async () => {
    await request(server())
      .post(`/leave/requests/${leaveRequestId}/decision`)
      .set('Cookie', workerCookie)
      .send({ decision: 'APPROVED' })
      .expect(403);
  });

  it('an approver cannot decide their own leave request', async () => {
    const own = await request(server())
      .post('/leave/requests')
      .set('Cookie', adminCookie)
      .send({ leaveTypeId, startDate: '2026-11-10', endDate: '2026-11-10' })
      .expect(201);
    await request(server())
      .post(`/leave/requests/${own.body.id}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' })
      .expect(403);

    // Cancelling a pending request works and never touches the balance.
    const cancelled = await request(server())
      .post(`/leave/requests/${own.body.id}/cancel`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('the pending request shows up in the approver queue', async () => {
    const res = await request(server()).get('/leave/requests/pending').set('Cookie', adminCookie).expect(200);
    expect(res.body.some((r: { id: string }) => r.id === leaveRequestId)).toBe(true);
  });

  it('approval deducts the balance (and only approval does)', async () => {
    const res = await request(server())
      .post(`/leave/requests/${leaveRequestId}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED', note: 'Enjoy' })
      .expect(201);
    expect(res.body.status).toBe('APPROVED');

    const balances = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    const bal = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(Number(bal.usedDays)).toBe(4);
    expect(Number(bal.availableDays)).toBe(16);
  });

  it('decided requests cannot be decided again', async () => {
    await request(server())
      .post(`/leave/requests/${leaveRequestId}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'REJECTED' })
      .expect(409);
  });

  it('rejection leaves the balance untouched', async () => {
    const req = await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: '2026-11-16', endDate: '2026-11-17' })
      .expect(201);
    const res = await request(server())
      .post(`/leave/requests/${req.body.id}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'REJECTED', note: 'Busy period' })
      .expect(201);
    expect(res.body.status).toBe('REJECTED');

    const balances = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    const bal = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(Number(bal.usedDays)).toBe(4);
  });

  it('cancelling an approved request refunds the balance', async () => {
    const req = await request(server())
      .post('/leave/requests')
      .set('Cookie', workerCookie)
      .send({ leaveTypeId, startDate: '2026-11-23', endDate: '2026-11-23' })
      .expect(201);
    await request(server())
      .post(`/leave/requests/${req.body.id}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' })
      .expect(201);

    let balances = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    let bal = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(Number(bal.usedDays)).toBe(5);

    const cancelled = await request(server())
      .post(`/leave/requests/${req.body.id}/cancel`)
      .set('Cookie', workerCookie)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');

    balances = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    bal = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(Number(bal.usedDays)).toBe(4);
    expect(Number(bal.availableDays)).toBe(16);
  });

  it('manual balance adjustments require permission and are reflected', async () => {
    await request(server())
      .post('/leave/balances/adjust')
      .set('Cookie', workerCookie)
      .send({ employeeId: workerEmployeeId, leaveTypeId, year: LEAVE_YEAR, deltaDays: 100, reason: 'self-serve' })
      .expect(403);

    await request(server())
      .post('/leave/balances/adjust')
      .set('Cookie', adminCookie)
      .send({ employeeId: workerEmployeeId, leaveTypeId, year: LEAVE_YEAR, deltaDays: 2.5, reason: 'Long service award' })
      .expect(201);

    const balances = await request(server())
      .get(`/leave/balances/me?year=${LEAVE_YEAR}`)
      .set('Cookie', workerCookie)
      .expect(200);
    const bal = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(Number(bal.adjustmentDays)).toBe(2.5);
    expect(Number(bal.availableDays)).toBe(18.5);
  });

  it('the calendar shows only approved leave', async () => {
    const res = await request(server())
      .get('/leave/calendar?from=2026-11-01&to=2026-11-30')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].id).toBe(leaveRequestId);
    expect(Number(res.body.entries[0].totalDays)).toBe(4);
  });

  // ───────────────────────── attendance: policy & clocking ─────────────────────────

  it('admin sets an attendance policy; employees cannot', async () => {
    await request(server())
      .put('/attendance/policy')
      .set('Cookie', workerCookie)
      .send({ workStartTime: '12:00' })
      .expect(403);

    // Start-of-day start time + zero grace + all days working means every
    // clock-in in this suite is deterministically "late".
    const res = await request(server())
      .put('/attendance/policy')
      .set('Cookie', adminCookie)
      .send({
        name: 'E2E',
        workStartTime: '00:00',
        workEndTime: '23:59',
        lateGraceMinutes: 0,
        workDays: [1, 2, 3, 4, 5, 6, 7],
      })
      .expect(200);
    expect(res.body.lateGraceMinutes).toBe(0);
  });

  it('cannot clock out before clocking in', async () => {
    await request(server()).post('/attendance/clock-out').set('Cookie', workerCookie).expect(409);
  });

  it('clock-in creates the day record exactly once and detects lateness', async () => {
    const res = await request(server()).post('/attendance/clock-in').set('Cookie', workerCookie).expect(201);
    expect(res.body.employeeId).toBe(workerEmployeeId);
    expect(res.body.late).toBe(true);
    expect(res.body.source).toBe('WEB');
    expect(res.body.clockOutAt).toBeNull();

    await request(server()).post('/attendance/clock-in').set('Cookie', workerCookie).expect(409);

    const today = await request(server()).get('/attendance/today').set('Cookie', workerCookie).expect(200);
    expect(today.body.record?.id).toBe(res.body.id);
  });

  it('clock-out completes the record exactly once', async () => {
    const res = await request(server()).post('/attendance/clock-out').set('Cookie', workerCookie).expect(201);
    expect(res.body.clockOutAt).toBeTruthy();
    await request(server()).post('/attendance/clock-out').set('Cookie', workerCookie).expect(409);
  });

  it('record listing is permission-scoped', async () => {
    // Admin (attendance.read.all) can read the worker's records…
    const res = await request(server())
      .get(`/attendance/records?employeeId=${workerEmployeeId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);

    // …but the worker cannot read someone else's.
    await request(server())
      .get(`/attendance/records?employeeId=${adminEmployeeId}`)
      .set('Cookie', workerCookie)
      .expect(403);
  });

  // ───────────────────────── attendance corrections ─────────────────────────

  it('validates correction requests (ordering, future days, duplicates)', async () => {
    await request(server())
      .post('/attendance/corrections')
      .set('Cookie', workerCookie)
      .send({
        day: YESTERDAY,
        proposedClockInAt: `${YESTERDAY}T16:00:00.000Z`,
        proposedClockOutAt: `${YESTERDAY}T08:00:00.000Z`,
        reason: 'Out before in',
      })
      .expect(400);

    await request(server())
      .post('/attendance/corrections')
      .set('Cookie', workerCookie)
      .send({ day: FUTURE_DAY, proposedClockInAt: `${FUTURE_DAY}T08:00:00.000Z`, reason: 'Time travel' })
      .expect(400);

    const res = await request(server())
      .post('/attendance/corrections')
      .set('Cookie', workerCookie)
      .send({
        day: YESTERDAY,
        proposedClockInAt: `${YESTERDAY}T08:00:00.000Z`,
        proposedClockOutAt: `${YESTERDAY}T16:00:00.000Z`,
        reason: 'Forgot to clock in',
      })
      .expect(201);
    correctionId = res.body.id;
    expect(res.body.status).toBe('PENDING');

    await request(server())
      .post('/attendance/corrections')
      .set('Cookie', workerCookie)
      .send({ day: YESTERDAY, proposedClockInAt: `${YESTERDAY}T09:00:00.000Z`, reason: 'Duplicate attempt' })
      .expect(409);
  });

  it('reviewer SoD: employees cannot review, nor can anyone review their own', async () => {
    await request(server())
      .post(`/attendance/corrections/${correctionId}/review`)
      .set('Cookie', workerCookie)
      .send({ decision: 'APPROVED' })
      .expect(403);

    const own = await request(server())
      .post('/attendance/corrections')
      .set('Cookie', adminCookie)
      .send({ day: TWO_DAYS_AGO, proposedClockInAt: `${TWO_DAYS_AGO}T08:00:00.000Z`, reason: 'Admin own fix' })
      .expect(201);
    await request(server())
      .post(`/attendance/corrections/${own.body.id}/review`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED' })
      .expect(403);
  });

  it('corrections are invisible to other tenants', async () => {
    await request(server())
      .post(`/attendance/corrections/${correctionId}/review`)
      .set('Cookie', outsiderCookie)
      .send({ decision: 'APPROVED' })
      .expect(404);
  });

  it('approving a correction materializes the attendance record', async () => {
    const pending = await request(server())
      .get('/attendance/corrections/pending')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(pending.body.some((c: { id: string }) => c.id === correctionId)).toBe(true);

    const res = await request(server())
      .post(`/attendance/corrections/${correctionId}/review`)
      .set('Cookie', adminCookie)
      .send({ decision: 'APPROVED', note: 'Confirmed with the team' })
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.reviewedById).toBeTruthy();

    const records = await request(server())
      .get(`/attendance/records?employeeId=${workerEmployeeId}&from=${YESTERDAY}&to=${YESTERDAY}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(records.body.total).toBe(1);
    expect(records.body.items[0].source).toBe('CORRECTION');

    await request(server())
      .post(`/attendance/corrections/${correctionId}/review`)
      .set('Cookie', adminCookie)
      .send({ decision: 'REJECTED' })
      .expect(409); // already reviewed
  });

  it('rejecting a correction changes nothing', async () => {
    const req = await request(server())
      .post('/attendance/corrections')
      .set('Cookie', workerCookie)
      .send({ day: TWO_DAYS_AGO, proposedClockInAt: `${TWO_DAYS_AGO}T08:00:00.000Z`, reason: 'Second attempt' })
      .expect(201);
    const res = await request(server())
      .post(`/attendance/corrections/${req.body.id}/review`)
      .set('Cookie', adminCookie)
      .send({ decision: 'REJECTED', note: 'No evidence' })
      .expect(201);
    expect(res.body.status).toBe('REJECTED');

    const records = await request(server())
      .get(`/attendance/records?employeeId=${workerEmployeeId}&from=${TWO_DAYS_AGO}&to=${TWO_DAYS_AGO}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(records.body.total).toBe(0);
  });

  // ───────────────────────── audit trail ─────────────────────────

  it('every workflow action left a tenant-readable audit row', async () => {
    const actions = [
      'leave.type_created',
      'leave.policy_upserted',
      'leave.holiday_created',
      'leave.requested',
      'leave.approved',
      'leave.rejected',
      'leave.cancelled',
      'leave.balance_adjusted',
      'attendance.policy_upserted',
      'attendance.clock_in',
      'attendance.clock_out',
      'attendance.correction_requested',
      'attendance.correction_reviewed',
    ];
    for (const action of actions) {
      const count = await tenant().auditLog.count({ where: { action } });
      expect({ action, count: count > 0 }).toEqual({ action, count: true });
    }
  });
});
