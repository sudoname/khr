/**
 * End-to-end tests for the P2 modules (docker-compose infra must be running
 * and migrations applied):
 *
 *   recruitment   posting lifecycle, candidate dedupe, pipeline stage rules
 *                 (reject needs a reason, interview auto-advance, offer gate),
 *                 hire converts to an employee record, closed-posting guard
 *   documents     manage-only upload, magic-byte sniffing, self/company ACL
 *                 on list + download, delete
 *   reports       permission gate, JSON summaries, CSV exports
 *   performance   cycles, goal ownership rules, review draft privacy,
 *                 self-review ban, submit → acknowledge flow, closed cycles
 *   training      course dedupe, self vs managed enrollment, terminal states
 *   billing       platform-admin-only plan changes
 *   tenancy       an unrelated company sees none of it
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
const PDF = Buffer.from('%PDF-1.4\n%fake-but-valid-magic-bytes\n');

describe('P2 modules e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let adminCookie: string; // COMPANY_ADMIN with a linked employee record
  let adminEmployeeId: string;
  let workerCookie: string; // plain EMPLOYEE with employee record
  let workerUserId: string;
  let workerEmployeeId: string;
  let outsiderCookie: string; // admin of an unrelated company
  let outsiderEmail: string;
  let outsiderCompanyId: string;

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

    const admin = await registerAdmin(`P2 E2E ${STAMP}`, `p2.admin.${STAMP}@example.test`);
    adminCookie = admin.cookie;
    companyId = admin.membership.companyId;
    adminEmployeeId = await createEmployee('Boss', 'Person');
    await tenant().membership.update({ where: { id: admin.membership.id }, data: { employeeId: adminEmployeeId } });

    workerEmployeeId = await createEmployee('Rank', 'File');
    const worker = await prisma.user.create({
      data: {
        email: `p2.worker.${STAMP}@example.test`,
        firstName: 'Rank',
        lastName: 'File',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    workerUserId = worker.id;
    await tenant().membership.create({
      data: { userId: worker.id, companyId, role: 'EMPLOYEE', employeeId: workerEmployeeId },
    });
    workerCookie = await login(worker.email);

    outsiderEmail = `p2.outsider.${STAMP}@example.test`;
    const outsider = await registerAdmin(`P2 Outsider ${STAMP}`, outsiderEmail);
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

  // ───────────────────────── recruitment ─────────────────────────

  let postingId: string;
  let candidateId: string;
  let applicationId: string;
  let interviewId: string;
  let hiredEmployeeId: string;

  it('recruitment: admin creates a posting; plain employees cannot', async () => {
    const res = await request(server())
      .post('/recruitment/postings')
      .set('Cookie', adminCookie)
      .send({ title: 'Senior Engineer', employmentType: 'FULL_TIME', openings: 2 })
      .expect(201);
    postingId = res.body.id;
    expect(res.body.status).toBe('DRAFT');

    await request(server())
      .post('/recruitment/postings')
      .set('Cookie', workerCookie)
      .send({ title: 'Sneaky Posting' })
      .expect(403);
    await request(server()).get('/recruitment/postings').set('Cookie', workerCookie).expect(403);
  });

  it('recruitment: candidates are unique per email within the company', async () => {
    const res = await request(server())
      .post('/recruitment/candidates')
      .set('Cookie', adminCookie)
      .send({ firstName: 'Jane', lastName: 'Doe', email: `jane.doe.${STAMP}@candidates.test`, source: 'REFERRAL' })
      .expect(201);
    candidateId = res.body.id;

    await request(server())
      .post('/recruitment/candidates')
      .set('Cookie', adminCookie)
      .send({ firstName: 'Jane', lastName: 'Again', email: `jane.doe.${STAMP}@candidates.test` })
      .expect(409);
  });

  it('recruitment: one application per candidate per posting', async () => {
    const res = await request(server())
      .post('/recruitment/applications')
      .set('Cookie', adminCookie)
      .send({ jobPostingId: postingId, candidateId })
      .expect(201);
    applicationId = res.body.id;
    expect(res.body.stage).toBe('APPLIED');

    await request(server())
      .post('/recruitment/applications')
      .set('Cookie', adminCookie)
      .send({ jobPostingId: postingId, candidateId })
      .expect(409);
  });

  it('recruitment: rejection requires a reason', async () => {
    await request(server())
      .post(`/recruitment/applications/${applicationId}/stage`)
      .set('Cookie', adminCookie)
      .send({ stage: 'REJECTED' })
      .expect(400);
  });

  it('recruitment: scheduling an interview auto-advances the stage', async () => {
    const res = await request(server())
      .post(`/recruitment/applications/${applicationId}/interviews`)
      .set('Cookie', adminCookie)
      .send({ scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), mode: 'VIDEO' })
      .expect(201);
    interviewId = res.body.id;

    const detail = await request(server())
      .get(`/recruitment/applications/${applicationId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.stage).toBe('INTERVIEW');
  });

  it('recruitment: interview feedback closes the interview exactly once', async () => {
    await request(server())
      .post(`/recruitment/interviews/${interviewId}/feedback`)
      .set('Cookie', adminCookie)
      .send({ status: 'COMPLETED', rating: 5, feedback: 'Strong hire' })
      .expect(201);
    await request(server())
      .post(`/recruitment/interviews/${interviewId}/feedback`)
      .set('Cookie', adminCookie)
      .send({ status: 'CANCELLED' })
      .expect(409);
  });

  it('recruitment: hire is gated on the OFFER stage', async () => {
    await request(server())
      .post(`/recruitment/applications/${applicationId}/hire`)
      .set('Cookie', adminCookie)
      .send({ jobTitle: 'Senior Engineer' })
      .expect(409);

    await request(server())
      .post(`/recruitment/applications/${applicationId}/offer`)
      .set('Cookie', adminCookie)
      .send({ salary: '12000000.00', startDate: '2026-12-01' })
      .expect(201);

    const res = await request(server())
      .post(`/recruitment/applications/${applicationId}/hire`)
      .set('Cookie', adminCookie)
      .send({ jobTitle: 'Senior Engineer' })
      .expect(201);
    expect(res.body.application.stage).toBe('HIRED');
    hiredEmployeeId = res.body.employee.id;

    const employee = await tenant().employee.findFirst({ where: { id: hiredEmployeeId } });
    expect(employee).not.toBeNull();
    expect(employee!.jobTitle).toBe('Senior Engineer');

    // Hiring twice is impossible: the application left the OFFER stage.
    await request(server())
      .post(`/recruitment/applications/${applicationId}/hire`)
      .set('Cookie', adminCookie)
      .send({ jobTitle: 'Senior Engineer' })
      .expect(409);
  });

  it('recruitment: closed postings reject new applications', async () => {
    await request(server())
      .patch(`/recruitment/postings/${postingId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'CLOSED' })
      .expect(200);

    const other = await request(server())
      .post('/recruitment/candidates')
      .set('Cookie', adminCookie)
      .send({ firstName: 'Late', lastName: 'Comer', email: `late.comer.${STAMP}@candidates.test` })
      .expect(201);
    await request(server())
      .post('/recruitment/applications')
      .set('Cookie', adminCookie)
      .send({ jobPostingId: postingId, candidateId: other.body.id })
      .expect(409);
  });

  it('recruitment: nothing leaks across tenants', async () => {
    const postings = await request(server()).get('/recruitment/postings').set('Cookie', outsiderCookie).expect(200);
    expect(postings.body).toHaveLength(0);
    const candidates = await request(server()).get('/recruitment/candidates').set('Cookie', outsiderCookie).expect(200);
    expect(candidates.body).toHaveLength(0);
    await request(server()).get(`/recruitment/applications/${applicationId}`).set('Cookie', outsiderCookie).expect(404);
  });

  // ───────────────────────── documents ─────────────────────────

  let companyDocId: string;
  let workerDocId: string;
  let adminDocId: string;

  it('documents: admin uploads; plain employees cannot', async () => {
    const companyDoc = await request(server())
      .post('/documents')
      .set('Cookie', adminCookie)
      .field('name', 'Employee Handbook')
      .field('category', 'POLICY')
      .attach('file', PDF, 'handbook.pdf')
      .expect(201);
    companyDocId = companyDoc.body.id;
    expect(companyDoc.body.mime).toBe('application/pdf');

    const workerDoc = await request(server())
      .post('/documents')
      .set('Cookie', adminCookie)
      .field('name', 'Worker Contract')
      .field('category', 'CONTRACT')
      .field('employeeId', workerEmployeeId)
      .attach('file', PDF, 'contract.pdf')
      .expect(201);
    workerDocId = workerDoc.body.id;

    const adminDoc = await request(server())
      .post('/documents')
      .set('Cookie', adminCookie)
      .field('name', 'Boss Contract')
      .field('category', 'CONTRACT')
      .field('employeeId', adminEmployeeId)
      .attach('file', PDF, 'boss.pdf')
      .expect(201);
    adminDocId = adminDoc.body.id;

    await request(server())
      .post('/documents')
      .set('Cookie', workerCookie)
      .field('name', 'Sneaky Upload')
      .attach('file', PDF, 'sneaky.pdf')
      .expect(403);
  });

  it('documents: unsupported file types are rejected by magic bytes', async () => {
    await request(server())
      .post('/documents')
      .set('Cookie', adminCookie)
      .field('name', 'Not a document')
      .attach('file', Buffer.from('#!/bin/sh\necho hi\n'), 'script.pdf')
      .expect(400);
  });

  it('documents: employees see company docs and their own, nothing else', async () => {
    const res = await request(server()).get('/documents').set('Cookie', workerCookie).expect(200);
    const ids = res.body.map((doc: { id: string }) => doc.id);
    expect(ids).toContain(companyDocId);
    expect(ids).toContain(workerDocId);
    expect(ids).not.toContain(adminDocId);

    await request(server()).get(`/documents/${workerDocId}/download`).set('Cookie', workerCookie).expect(200);
    await request(server()).get(`/documents/${companyDocId}/download`).set('Cookie', workerCookie).expect(200);
    await request(server()).get(`/documents/${adminDocId}/download`).set('Cookie', workerCookie).expect(403);
  });

  it('documents: admin sees everything and can delete', async () => {
    const res = await request(server()).get('/documents').set('Cookie', adminCookie).expect(200);
    expect(res.body.map((doc: { id: string }) => doc.id)).toEqual(
      expect.arrayContaining([companyDocId, workerDocId, adminDocId]),
    );

    await request(server()).delete(`/documents/${adminDocId}`).set('Cookie', adminCookie).expect(200);
    await request(server()).get(`/documents/${adminDocId}/download`).set('Cookie', adminCookie).expect(404);
  });

  // ───────────────────────── reports ─────────────────────────

  it('reports: permission-gated summaries and CSV exports', async () => {
    await request(server()).get('/reports/headcount').set('Cookie', workerCookie).expect(403);

    const headcount = await request(server()).get('/reports/headcount').set('Cookie', adminCookie).expect(200);
    expect(headcount.body.total).toBeGreaterThanOrEqual(3); // boss, worker, hired candidate
    expect(headcount.body.byStatus.length).toBeGreaterThan(0);
    expect(headcount.body.trend).toHaveLength(12);

    const year = new Date().getUTCFullYear();
    const leave = await request(server()).get(`/reports/leave?year=${year}`).set('Cookie', adminCookie).expect(200);
    expect(leave.body.year).toBe(year);

    const payroll = await request(server()).get(`/reports/payroll?year=${year}`).set('Cookie', adminCookie).expect(200);
    expect(Array.isArray(payroll.body.runs)).toBe(true);

    const csv = await request(server()).get('/reports/headcount.csv').set('Cookie', adminCookie).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('employeeNo');

    await request(server())
      .get('/reports/attendance?from=2026-02-01&to=2026-01-01')
      .set('Cookie', adminCookie)
      .expect(400); // from after to
  });

  // ───────────────────────── performance ─────────────────────────

  let cycleId: string;
  let workerGoalId: string;
  let adminGoalId: string;
  let reviewId: string;

  it('performance: admin creates and activates a cycle; names are unique', async () => {
    const res = await request(server())
      .post('/performance/cycles')
      .set('Cookie', adminCookie)
      .send({ name: `FY26 Review ${STAMP}`, startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(201);
    cycleId = res.body.id;

    await request(server())
      .post('/performance/cycles')
      .set('Cookie', adminCookie)
      .send({ name: `FY26 Review ${STAMP}`, startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(409);

    await request(server())
      .post(`/performance/cycles/${cycleId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'ACTIVE' })
      .expect(201);

    await request(server())
      .post('/performance/cycles')
      .set('Cookie', workerCookie)
      .send({ name: 'Sneaky Cycle', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(403);
  });

  it('performance: employees own their goals; managers can touch everything', async () => {
    const own = await request(server())
      .post('/performance/goals')
      .set('Cookie', workerCookie)
      .send({ cycleId, title: 'Ship the thing', weight: 50 })
      .expect(201);
    workerGoalId = own.body.id;
    expect(own.body.employeeId).toBe(workerEmployeeId);

    // A plain employee cannot plant goals on someone else.
    await request(server())
      .post('/performance/goals')
      .set('Cookie', workerCookie)
      .send({ cycleId, employeeId: adminEmployeeId, title: 'Sabotage', weight: 10 })
      .expect(403);

    const bossGoal = await request(server())
      .post('/performance/goals')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: adminEmployeeId, title: 'Grow the team', weight: 30 })
      .expect(201);
    adminGoalId = bossGoal.body.id;

    await request(server())
      .patch(`/performance/goals/${workerGoalId}`)
      .set('Cookie', workerCookie)
      .send({ progress: 60 })
      .expect(200);
    await request(server())
      .patch(`/performance/goals/${adminGoalId}`)
      .set('Cookie', workerCookie)
      .send({ progress: 99 })
      .expect(403);

    const list = await request(server()).get('/performance/goals').set('Cookie', workerCookie).expect(200);
    expect(list.body.map((g: { id: string }) => g.id)).toContain(workerGoalId);
    expect(list.body.map((g: { id: string }) => g.id)).not.toContain(adminGoalId);
  });

  it('performance: draft reviews stay private to the reviewer', async () => {
    await request(server())
      .put('/performance/reviews')
      .set('Cookie', workerCookie)
      .send({ cycleId, employeeId: adminEmployeeId, rating: 1 })
      .expect(403); // EMPLOYEE lacks performance.review

    await request(server())
      .put('/performance/reviews')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: adminEmployeeId, rating: 5 })
      .expect(403); // no self-reviews

    const draft = await request(server())
      .put('/performance/reviews')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: workerEmployeeId, rating: 4, strengths: 'Reliable', submit: false })
      .expect(200);
    reviewId = draft.body.id;
    expect(draft.body.status).toBe('DRAFT');

    const workerView = await request(server()).get('/performance/reviews').set('Cookie', workerCookie).expect(200);
    expect(workerView.body.map((r: { id: string }) => r.id)).not.toContain(reviewId);
  });

  it('performance: submit → employee sees it and acknowledges exactly once', async () => {
    await request(server())
      .post(`/performance/reviews/${reviewId}/acknowledge`)
      .set('Cookie', workerCookie)
      .expect(409); // still a draft

    await request(server())
      .put('/performance/reviews')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: workerEmployeeId, rating: 4, strengths: 'Reliable', submit: true })
      .expect(200);

    const workerView = await request(server()).get('/performance/reviews').set('Cookie', workerCookie).expect(200);
    const visible = workerView.body.find((r: { id: string }) => r.id === reviewId);
    expect(visible).toBeDefined();
    expect(visible.status).toBe('SUBMITTED');

    // Only the subject can acknowledge, and only once.
    await request(server()).post(`/performance/reviews/${reviewId}/acknowledge`).set('Cookie', adminCookie).expect(403);
    await request(server()).post(`/performance/reviews/${reviewId}/acknowledge`).set('Cookie', workerCookie).expect(201);
    await request(server()).post(`/performance/reviews/${reviewId}/acknowledge`).set('Cookie', workerCookie).expect(409);

    // Submitted reviews are frozen.
    await request(server())
      .put('/performance/reviews')
      .set('Cookie', adminCookie)
      .send({ cycleId, employeeId: workerEmployeeId, rating: 2, submit: true })
      .expect(409);
  });

  it('performance: closed cycles stop new goals and reviews', async () => {
    await request(server())
      .post(`/performance/cycles/${cycleId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CLOSED' })
      .expect(201);

    await request(server())
      .post('/performance/goals')
      .set('Cookie', workerCookie)
      .send({ cycleId, title: 'Too late', weight: 10 })
      .expect(409);
  });

  // ───────────────────────── training ─────────────────────────

  let courseId: string;
  let course2Id: string;
  let workerEnrollmentId: string;

  it('training: admin manages the catalogue; titles are unique', async () => {
    const res = await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: `Security Awareness ${STAMP}`, provider: 'KHR Academy', durationHours: 2, mandatory: true })
      .expect(201);
    courseId = res.body.id;

    await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: `Security Awareness ${STAMP}` })
      .expect(409);

    const second = await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: `Leadership 101 ${STAMP}` })
      .expect(201);
    course2Id = second.body.id;

    await request(server())
      .post('/training/courses')
      .set('Cookie', workerCookie)
      .send({ title: 'Sneaky Course' })
      .expect(403);
  });

  it('training: employees enroll themselves once; cannot enroll others', async () => {
    const res = await request(server())
      .post(`/training/courses/${courseId}/enroll`)
      .set('Cookie', workerCookie)
      .send({})
      .expect(201);
    workerEnrollmentId = res.body.id;
    expect(res.body.employeeId).toBe(workerEmployeeId);

    await request(server()).post(`/training/courses/${courseId}/enroll`).set('Cookie', workerCookie).send({}).expect(409);
    await request(server())
      .post(`/training/courses/${courseId}/enroll`)
      .set('Cookie', workerCookie)
      .send({ employeeId: adminEmployeeId })
      .expect(403);

    // Managers can enroll anyone.
    await request(server())
      .post(`/training/courses/${course2Id}/enroll`)
      .set('Cookie', adminCookie)
      .send({ employeeId: workerEmployeeId })
      .expect(201);
  });

  it('training: enrollment completion is terminal', async () => {
    await request(server())
      .patch(`/training/enrollments/${workerEnrollmentId}`)
      .set('Cookie', workerCookie)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    const done = await request(server())
      .patch(`/training/enrollments/${workerEnrollmentId}`)
      .set('Cookie', workerCookie)
      .send({ status: 'COMPLETED', score: 92 })
      .expect(200);
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.score).toBe(92);

    await request(server())
      .patch(`/training/enrollments/${workerEnrollmentId}`)
      .set('Cookie', workerCookie)
      .send({ status: 'CANCELLED' })
      .expect(409);

    const workerView = await request(server()).get('/training/enrollments').set('Cookie', workerCookie).expect(200);
    expect(workerView.body.every((en: { employeeId: string }) => en.employeeId === workerEmployeeId)).toBe(true);
  });

  // ───────────────────────── billing (platform admin) ─────────────────────────

  it('billing: only platform admins can change a company plan', async () => {
    await request(server())
      .patch(`/platform/companies/${companyId}/plan`)
      .set('Cookie', adminCookie)
      .send({ plan: 'ENTERPRISE' })
      .expect(403);

    await prisma.user.update({ where: { email: outsiderEmail }, data: { isPlatformAdmin: true } });
    const platformCookie = await login(outsiderEmail);

    const res = await request(server())
      .patch(`/platform/companies/${companyId}/plan`)
      .set('Cookie', platformCookie)
      .send({ plan: 'GROWTH' })
      .expect(200);
    expect(res.body.plan).toBe('GROWTH');

    const list = await request(server()).get('/platform/companies').set('Cookie', platformCookie).expect(200);
    const row = list.body.find((c: { id: string }) => c.id === companyId);
    expect(row.plan).toBe('GROWTH');
  });

  // ───────────────────────── audit trail ─────────────────────────

  it('audit: the P2 actions left tenant-scoped audit rows', async () => {
    const actions = (
      await tenant().auditLog.findMany({ where: { companyId }, select: { action: true } })
    ).map((a) => a.action);
    for (const expected of [
      'recruitment.posting_created',
      'recruitment.hired',
      'document.uploaded',
      'report.exported',
      'performance.review_submitted',
      'performance.review_acknowledged',
      'training.enrolled',
      'platform.plan_changed',
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
