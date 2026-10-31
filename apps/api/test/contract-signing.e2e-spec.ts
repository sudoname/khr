/**
 * Contract signing + migrant workers e2e (docker-compose infra must be
 * running and migrations applied):
 *
 *   migrant     MIGRANT employment type and livesOnsite flag persist
 *   signing     only the employee named on the contract can sign (admins
 *               cannot); hash/date/IP recorded server-side, GPS echoed;
 *               signing twice is a 409
 *   locking     a signed contract can no longer be edited or deleted
 *   pdf         the signed contract still renders a real PDF
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

// 1x1 transparent PNG — a syntactically valid signature image.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** supertest/superagent does not buffer application/pdf by default. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Contract signing e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let adminCookie: string;
  let workerCookie: string; // EMPLOYEE linked to workerEmployeeId
  let workerEmployeeId: string;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();

    const adminEmail = `signing.admin.${STAMP}@example.test`;
    await request(server())
      .post('/auth/register')
      .send({
        companyName: `Signing E2E ${STAMP}`,
        sector: 'AGRICULTURE',
        firstName: 'Hr',
        lastName: 'Admin',
        email: adminEmail,
        password: PASSWORD,
      })
      .expect(201);
    const adminUser = await prisma.user.update({
      where: { email: adminEmail },
      data: { emailVerifiedAt: new Date() },
    });
    adminCookie = await login(adminEmail);
    const membership = await prisma.auth(adminUser.id).membership.findFirst({ where: { userId: adminUser.id } });
    if (!membership) throw new Error('No admin membership');
    companyId = membership.companyId;

    // Migrant farm worker: paid annually, housed on-site.
    const empRes = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Musa',
        lastName: 'Garba',
        workEmail: `musa.garba.${STAMP}@example.test`,
        hireDate: '2026-01-15',
        jobTitle: 'Farm Hand',
        employmentType: 'MIGRANT',
        livesOnsite: true,
      })
      .expect(201);
    workerEmployeeId = empRes.body.id;

    await request(server())
      .post(`/employees/${workerEmployeeId}/compensation`)
      .set('Cookie', adminCookie)
      .send({ effectiveDate: '2026-01-15', baseSalary: '1200000.00', currency: 'NGN', payFrequency: 'ANNUAL' })
      .expect(201);

    const contractRes = await request(server())
      .post(`/contracts/employee/${workerEmployeeId}`)
      .set('Cookie', adminCookie)
      .expect(201);
    contractId = contractRes.body.id;

    const worker = await prisma.user.create({
      data: {
        email: `signing.worker.${STAMP}@example.test`,
        firstName: 'Musa',
        lastName: 'Garba',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    await tenant().membership.create({
      data: { userId: worker.id, companyId, role: 'EMPLOYEE', employeeId: workerEmployeeId },
    });
    workerCookie = await login(worker.email);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${STAMP}@example.test` } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  // ───────────────────────── migrant workers ─────────────────────────

  it('persists the MIGRANT employment type and livesOnsite flag', async () => {
    const res = await request(server())
      .get(`/employees/${workerEmployeeId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.employmentType).toBe('MIGRANT');
    expect(res.body.livesOnsite).toBe(true);
  });

  // ───────────────────────── signing ACL + validation ─────────────────────────

  it('rejects signing by anyone who is not the named employee — even the admin', async () => {
    await request(server())
      .post(`/contracts/${contractId}/sign`)
      .set('Cookie', adminCookie)
      .send({ signatureImage: PNG_DATA_URL })
      .expect(403);
  });

  it('rejects a malformed signature image', async () => {
    await request(server())
      .post(`/contracts/${contractId}/sign`)
      .set('Cookie', workerCookie)
      .send({ signatureImage: 'data:image/jpeg;base64,notapng' })
      .expect(400);
  });

  // ───────────────────────── signing ─────────────────────────

  it('the employee signs on screen: hash, date and IP are server-derived, GPS echoed', async () => {
    const res = await request(server())
      .post(`/contracts/${contractId}/sign`)
      .set('Cookie', workerCookie)
      .send({ signatureImage: PNG_DATA_URL, latitude: 7.3775, longitude: 3.947, accuracy: 12.5 })
      .expect(201);

    expect(res.body.signedAt).toBeTruthy();
    expect(res.body.signedName).toBe('Musa Garba');
    expect(res.body.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.signatureIp).toBeTruthy();
    expect(Number(res.body.signatureLat)).toBeCloseTo(7.3775, 4);
    expect(Number(res.body.signatureLng)).toBeCloseTo(3.947, 4);
    expect(Number(res.body.signatureAccuracy)).toBeCloseTo(12.5, 1);
  });

  it('a contract cannot be signed twice', async () => {
    await request(server())
      .post(`/contracts/${contractId}/sign`)
      .set('Cookie', workerCookie)
      .send({ signatureImage: PNG_DATA_URL })
      .expect(409);
  });

  // ───────────────────────── immutability ─────────────────────────

  it('a signed contract can no longer be edited or deleted', async () => {
    await request(server())
      .patch(`/contracts/${contractId}`)
      .set('Cookie', adminCookie)
      .send({ roleTitle: 'Head Farm Hand' })
      .expect(409);
    await request(server()).delete(`/contracts/${contractId}`).set('Cookie', adminCookie).expect(409);
  });

  // ───────────────────────── pdf ─────────────────────────

  it('the signed contract still renders as a PDF (with the signature block)', async () => {
    const res = await request(server())
      .get(`/contracts/${contractId}/pdf`)
      .set('Cookie', workerCookie)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
