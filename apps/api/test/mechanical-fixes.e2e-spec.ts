/**
 * End-to-end tests for the WP-16 mechanical fixes (docker-compose infra must
 * be running and migrations applied):
 *
 *   training URL     course links must be http(s) — javascript:/data: URLs
 *                    are rejected at the Zod boundary
 *   MFA challenge    a wrong code does NOT burn the challenge token (verify
 *                    before consume); a used token cannot be replayed
 *   token atomicity  two concurrent consumers of one security token: exactly
 *                    one wins (atomic updateMany claim)
 *   rate limiting    INCR+EXPIRE is atomic and self-heals counters that were
 *                    left without a TTL by a crash
 *   corrections      the proposed clock-in must fall on the day being
 *                    corrected, evaluated in the company timezone
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { PrismaService } from '../src/infra/prisma.service';
import { RateLimitService } from '../src/infra/rate-limit.service';
import { REDIS } from '../src/infra/redis.provider';

jest.setTimeout(120_000);

const STAMP = Date.now();
const PASSWORD = 'E2e-Password-123!';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// Day keys relative to "now". UTC-yesterday is never in the future for the
// company timezone (Africa/Lagos, UTC+1); 08:00Z is 09:00 local (same day).
const dayStr = (offsetDays: number) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
const YESTERDAY = dayStr(1);
const TWO_DAYS_AGO = dayStr(2);

describe('WP-16 mechanical fixes e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let companyId: string;
  let adminCookie: string;
  let adminUserId: string;

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
      .send({
        companyName: `Mech E2E ${STAMP}`,
        sector: 'TECHNOLOGY',
        firstName: 'Mech',
        lastName: 'Admin',
        email: `mech.admin.${STAMP}@example.test`,
        password: PASSWORD,
      })
      .expect(201);
    const admin = await prisma.user.update({
      where: { email: `mech.admin.${STAMP}@example.test` },
      data: { emailVerifiedAt: new Date() },
    });
    adminUserId = admin.id;
    const login = await request(server())
      .post('/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(201);
    adminCookie = sessionCookie(login);
    const membership = await prisma.auth(admin.id).membership.findFirst({ where: { userId: admin.id } });
    if (!membership) throw new Error('No membership for admin');
    companyId = membership.companyId;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${STAMP}@example.test` } } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  // ───────────────────────── 16a: training course URLs ─────────────────────────

  it('rejects non-http(s) course URLs at the boundary', async () => {
    await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: 'XSS Course', url: 'javascript:alert(1)' })
      .expect(400);

    await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: 'Data Course', url: 'data:text/html,<script>alert(1)</script>' })
      .expect(400);

    const ok = await request(server())
      .post('/training/courses')
      .set('Cookie', adminCookie)
      .send({ title: 'Legit Course', url: 'https://learning.example.test/course-1' })
      .expect(201);
    expect(ok.body.url).toBe('https://learning.example.test/course-1');
  });

  // ───────────────────────── 16c: MFA challenge ordering ─────────────────────────

  it('a wrong MFA code does not burn the challenge token; success consumes it', async () => {
    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: adminUserId },
      data: { mfaEnabled: true, mfaSecret: secret },
    });

    const login = await request(server())
      .post('/auth/login')
      .send({ email: `mech.admin.${STAMP}@example.test`, password: PASSWORD })
      .expect(201);
    expect(login.body.mfaRequired).toBe(true);
    const mfaToken: string = login.body.mfaToken;

    // Typo: must be rejected WITHOUT consuming the challenge.
    await request(server()).post('/auth/mfa/verify').send({ mfaToken, code: '000000' }).expect(401);

    // The same challenge token still works with the correct code.
    const ok = await request(server())
      .post('/auth/mfa/verify')
      .send({ mfaToken, code: authenticator.generate(secret) })
      .expect(201);
    expect(ok.body.mfaRequired).toBe(false);

    // …but only once: a replay with a fresh valid code is rejected.
    await request(server())
      .post('/auth/mfa/verify')
      .send({ mfaToken, code: authenticator.generate(secret) })
      .expect(400);

    await prisma.user.update({
      where: { id: adminUserId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
  });

  // ───────────────────────── 16b: atomic token consumption ─────────────────────────

  it('two concurrent consumers of one token: exactly one wins', async () => {
    const token = randomBytes(32).toString('base64url');
    const user = await prisma.user.create({
      data: {
        email: `mech.race.${STAMP}@example.test`,
        firstName: 'Race',
        lastName: 'Condition',
        passwordHash: 'x',
      },
    });
    await prisma.securityToken.create({
      data: {
        userId: user.id,
        type: 'VERIFY_EMAIL',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const [a, b] = await Promise.all([
      request(server()).post('/auth/verify-email').send({ token }),
      request(server()).post('/auth/verify-email').send({ token }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.emailVerifiedAt).toBeTruthy();
  });

  // ───────────────────────── 16d: rate-limit TTL ─────────────────────────

  it('rate-limit counters always carry a TTL, even after a crashed increment', async () => {
    const rl = app.get(RateLimitService);

    // Normal path: first hit creates the key with an expiry.
    await rl.hit(`e2e-fresh:${STAMP}`, 5, 60);
    expect(await redis.ttl(`rl:e2e-fresh:${STAMP}`)).toBeGreaterThan(0);

    // Crash-recovery path: a counter stranded without a TTL (the old
    // implementation could crash between INCR and EXPIRE) is healed on the
    // next hit instead of rate-limiting that key forever.
    await redis.set(`rl:e2e-perm:${STAMP}`, '3');
    expect(await redis.ttl(`rl:e2e-perm:${STAMP}`)).toBe(-1);
    await rl.hit(`e2e-perm:${STAMP}`, 100, 60);
    expect(await redis.ttl(`rl:e2e-perm:${STAMP}`)).toBeGreaterThan(0);

    // Limit enforcement is unchanged.
    await rl.hit(`e2e-limit:${STAMP}`, 1, 60);
    await expect(rl.hit(`e2e-limit:${STAMP}`, 1, 60)).rejects.toMatchObject({ status: 429 });
  });

  // ───────────────────────── 16e: correction day/timezone ─────────────────────────

  it('rejects corrections whose proposed clock-in is not on the corrected day', async () => {
    // Link the admin to an employee record so they can request corrections.
    const emp = await request(server())
      .post('/employees')
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Mech',
        lastName: 'Worker',
        workEmail: `mech.worker.${STAMP}@example.test`,
        hireDate: '2025-06-01',
        jobTitle: 'Engineer',
      })
      .expect(201);
    const membership = await prisma.auth(adminUserId).membership.findFirst({ where: { userId: adminUserId } });
    await prisma.tenant(companyId).membership.update({
      where: { id: membership!.id },
      data: { employeeId: emp.body.id },
    });

    // Wrong calendar day entirely.
    await request(server())
      .post('/attendance/corrections')
      .set('Cookie', adminCookie)
      .send({
        day: YESTERDAY,
        proposedClockInAt: `${TWO_DAYS_AGO}T08:00:00.000Z`,
        reason: 'Instant not on day',
      })
      .expect(400);

    // Same UTC day, but 23:30Z is already 00:30 the NEXT day in Africa/Lagos.
    await request(server())
      .post('/attendance/corrections')
      .set('Cookie', adminCookie)
      .send({
        day: YESTERDAY,
        proposedClockInAt: `${YESTERDAY}T23:30:00.000Z`,
        reason: 'Timezone boundary',
      })
      .expect(400);

    // A proposal that lands on the corrected day (09:00 Lagos) is accepted.
    const ok = await request(server())
      .post('/attendance/corrections')
      .set('Cookie', adminCookie)
      .send({
        day: YESTERDAY,
        proposedClockInAt: `${YESTERDAY}T08:00:00.000Z`,
        proposedClockOutAt: `${YESTERDAY}T16:00:00.000Z`,
        reason: 'Forgot to clock in',
      })
      .expect(201);
    expect(ok.body.status).toBe('PENDING');
  });
});
