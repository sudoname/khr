/**
 * WP-7 — Registration timing oracle.
 *
 * register() returned early on the email-exists branch before doing any
 * argon2 work, while the fresh path paid a full argon2id hash. The response
 * body was identical, but response time revealed whether an email was
 * registered. The hash now runs before the branch, so both paths pay the
 * same hashing cost.
 *
 * The spy targets the raw CJS exports of 'argon2' (default import ===
 * module.exports under esModuleInterop); the service's `import * as argon2`
 * namespace resolves properties off that same object, so the spy observes
 * its calls.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma.service';
import { REDIS } from '../src/infra/redis.provider';

jest.setTimeout(120_000);

const STAMP = Date.now();
const PASSWORD = 'E2e-Password-123!';
const EMAIL = `wp7.user.${STAMP}@example.test`;
const COMPANY = `Wp7 Alpha ${STAMP}`;
const NEUTRAL = 'If this email is available, your workspace has been created. Check your inbox.';

describe('registration timing oracle (WP-7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let hashSpy: jest.SpyInstance;

  const server = () => app.getHttpServer();

  async function flushRateLimits() {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
  }

  const registerOnce = () =>
    request(server())
      .post('/auth/register')
      .send({ companyName: COMPANY, sector: 'TECHNOLOGY', firstName: 'Wp7', lastName: 'User', email: EMAIL, password: PASSWORD });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    await flushRateLimits();
    hashSpy = jest.spyOn(argon2, 'hash');
  });

  afterAll(async () => {
    hashSpy.mockRestore();
    await prisma.company.deleteMany({ where: { name: COMPANY } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await flushRateLimits();
    await app.close();
    redis.disconnect();
  });

  it('fresh registration hashes the password and returns the neutral message', async () => {
    hashSpy.mockClear();
    const res = await registerOnce().expect(201);
    expect(res.body.message).toBe(NEUTRAL);
    expect(hashSpy).toHaveBeenCalled();
  });

  it('re-registering an existing email pays the same hashing cost with an identical body', async () => {
    hashSpy.mockClear();
    const res = await registerOnce().expect(201);
    expect(res.body.message).toBe(NEUTRAL);
    // The timing-oracle fix: the exists branch must also run argon2.
    expect(hashSpy).toHaveBeenCalled();
    // And it must not have created anything.
    expect(await prisma.company.count({ where: { name: COMPANY } })).toBe(1);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });
});
