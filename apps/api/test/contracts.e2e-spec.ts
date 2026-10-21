/**
 * Employment contracts e2e (docker-compose infra must be running and
 * migrations applied):
 *
 *   template    default platform clauses until a company saves its own;
 *               document.manage required to read/write it
 *   generate    placeholders resolved from the employee record (salary in
 *               words from the latest compensation row), one contract per
 *               employee (409 on regenerate), unknown tokens left visible
 *   editing     PATCH updates title/role/clauses; delete allows regenerate
 *   pdf         renders a real PDF (magic bytes); employees can download
 *               their own contract but nobody else's
 *   tenancy     an unrelated company cannot see the contract
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

/** supertest/superagent does not buffer application/pdf by default. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Employment contracts e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let adminCookie: string;
  let workerCookie: string; // plain EMPLOYEE linked to workerEmployeeId
  let workerEmployeeId: string;
  let otherEmployeeId: string; // employee with no linked user and no contract
  let outsiderCookie: string; // admin of an unrelated company
  let outsiderCompanyId: string;
  let contractId: string;

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
        hireDate: '2026-02-01',
        jobTitle: 'Software Engineer',
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

    const admin = await registerAdmin(`Contracts E2E ${STAMP}`, `contracts.admin.${STAMP}@example.test`);
    adminCookie = admin.cookie;
    companyId = admin.membership.companyId;

    workerEmployeeId = await createEmployee('Ada', 'Obi');
    otherEmployeeId = await createEmployee('Tunde', 'Bello');

    await request(server())
      .post(`/employees/${workerEmployeeId}/compensation`)
      .set('Cookie', adminCookie)
      .send({ effectiveDate: '2026-02-01', baseSalary: '5000000.00', currency: 'NGN', payFrequency: 'ANNUAL' })
      .expect(201);

    const worker = await prisma.user.create({
      data: {
        email: `contracts.worker.${STAMP}@example.test`,
        firstName: 'Ada',
        lastName: 'Obi',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    await tenant().membership.create({
      data: { userId: worker.id, companyId, role: 'EMPLOYEE', employeeId: workerEmployeeId },
    });
    workerCookie = await login(worker.email);

    const outsider = await registerAdmin(`Contracts Outsider ${STAMP}`, `contracts.outsider.${STAMP}@example.test`);
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

  // ───────────────────────── template ─────────────────────────

  it('serves the platform default template until the company saves its own', async () => {
    const res = await request(server()).get('/contracts/template').set('Cookie', adminCookie).expect(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.title).toBe('Contract of Employment');
    expect(res.body.clauses.length).toBeGreaterThanOrEqual(10);
    expect(res.body.clauses[0]).toEqual(
      expect.objectContaining({ heading: expect.any(String), body: expect.any(String) }),
    );
  });

  it('template is gated to document.manage', async () => {
    await request(server()).get('/contracts/template').set('Cookie', workerCookie).expect(403);
    await request(server())
      .put('/contracts/template')
      .set('Cookie', workerCookie)
      .send({ title: 'Nope', clauses: [{ heading: 'X', body: 'Y' }] })
      .expect(403);
  });

  it('admin saves a custom template; placeholders and typos survive verbatim', async () => {
    const res = await request(server())
      .put('/contracts/template')
      .set('Cookie', adminCookie)
      .send({
        title: 'Offer of Employment',
        clauses: [
          { heading: 'Appointment', body: 'Dear {{employeeName}}, {{companyName}} appoints you as {{jobTitle}} from {{startDate}}.' },
          { heading: 'Remuneration', body: 'Your salary is {{salaryWords}} ({{salaryFigure}}) {{salaryFrequency}}.' },
          { heading: 'Typo', body: 'This token {{notAThing}} should stay visible.' },
        ],
      })
      .expect(200);
    expect(res.body.isDefault).toBe(false);
    expect(res.body.title).toBe('Offer of Employment');
    expect(res.body.clauses).toHaveLength(3);
  });

  it('rejects an empty clause list', async () => {
    await request(server())
      .put('/contracts/template')
      .set('Cookie', adminCookie)
      .send({ title: 'Offer of Employment', clauses: [] })
      .expect(400);
  });

  // ───────────────────────── generation ─────────────────────────

  it('generates a contract with placeholders resolved from the employee record', async () => {
    const res = await request(server())
      .post(`/contracts/employee/${workerEmployeeId}`)
      .set('Cookie', adminCookie)
      .expect(201);
    contractId = res.body.id;
    expect(res.body.employeeId).toBe(workerEmployeeId);
    expect(res.body.title).toBe('Offer of Employment');
    expect(res.body.roleTitle).toBe('Software Engineer');

    const clauses = res.body.clauses as { heading: string; body: string }[];
    expect(clauses[0].body).toContain('Ada Obi');
    expect(clauses[0].body).toContain(`Contracts E2E ${STAMP}`);
    expect(clauses[0].body).toContain('Software Engineer');
    expect(clauses[0].body).toContain('1 February 2026');
    expect(clauses[1].body).toContain('Five Million Naira Only');
    expect(clauses[1].body).toContain('\u20a65,000,000.00');
    expect(clauses[1].body).toContain('per annum');
    // Unknown tokens stay visible so typos surface in the editable draft.
    expect(clauses[2].body).toContain('{{notAThing}}');
  });

  it('refuses to generate a second contract for the same employee', async () => {
    await request(server()).post(`/contracts/employee/${workerEmployeeId}`).set('Cookie', adminCookie).expect(409);
  });

  it('workers cannot generate contracts', async () => {
    await request(server()).post(`/contracts/employee/${otherEmployeeId}`).set('Cookie', workerCookie).expect(403);
  });

  // ───────────────────────── read ACL ─────────────────────────

  it('an employee can read their own contract but not someone else\'s', async () => {
    const res = await request(server())
      .get(`/contracts/employee/${workerEmployeeId}`)
      .set('Cookie', workerCookie)
      .expect(200);
    expect(res.body.id).toBe(contractId);

    await request(server()).get(`/contracts/employee/${otherEmployeeId}`).set('Cookie', workerCookie).expect(403);
  });

  it('returns 404 for an employee without a contract', async () => {
    await request(server()).get(`/contracts/employee/${otherEmployeeId}`).set('Cookie', adminCookie).expect(404);
  });

  it('an unrelated company sees nothing', async () => {
    await request(server()).get(`/contracts/employee/${workerEmployeeId}`).set('Cookie', outsiderCookie).expect(404);
    await request(server()).get(`/contracts/${contractId}/pdf`).set('Cookie', outsiderCookie).expect(404);
  });

  // ───────────────────────── editing ─────────────────────────

  it('admin edits the generated contract', async () => {
    const res = await request(server())
      .patch(`/contracts/${contractId}`)
      .set('Cookie', adminCookie)
      .send({
        roleTitle: 'Senior Software Engineer',
        clauses: [{ heading: 'Appointment', body: 'Final negotiated terms for Ada Obi.' }],
      })
      .expect(200);
    expect(res.body.roleTitle).toBe('Senior Software Engineer');
    expect(res.body.clauses).toHaveLength(1);
  });

  it('workers cannot edit or delete contracts', async () => {
    await request(server())
      .patch(`/contracts/${contractId}`)
      .set('Cookie', workerCookie)
      .send({ roleTitle: 'CEO' })
      .expect(403);
    await request(server()).delete(`/contracts/${contractId}`).set('Cookie', workerCookie).expect(403);
  });

  // ───────────────────────── pdf ─────────────────────────

  it('renders a PDF; the employee can download their own', async () => {
    const res = await request(server())
      .get(`/contracts/${contractId}/pdf`)
      .set('Cookie', adminCookie)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('contract-');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await request(server())
      .get(`/contracts/${contractId}/pdf`)
      .set('Cookie', workerCookie)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
  });

  // ───────────────────────── delete + regenerate ─────────────────────────

  it('delete allows regeneration', async () => {
    await request(server()).delete(`/contracts/${contractId}`).set('Cookie', adminCookie).expect(200);
    await request(server()).get(`/contracts/employee/${workerEmployeeId}`).set('Cookie', adminCookie).expect(404);
    const res = await request(server())
      .post(`/contracts/employee/${workerEmployeeId}`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(res.body.id).not.toBe(contractId);
  });
});
