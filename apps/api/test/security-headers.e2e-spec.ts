/**
 * WP-11 — Baseline security headers on every API response.
 *
 * The API previously sent no security headers at all (and Express advertised
 * itself via X-Powered-By). securityHeaders middleware, registered in
 * AppModule so it also applies under the testing module, now sets a manual
 * (helmet-free) baseline. HSTS is prod-only, so it is not asserted here.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60_000);

describe('security headers (WP-11)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function expectSecured(res: request.Response) {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  }

  it('sets the baseline headers on a public route', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expectSecured(res);
  });

  it('sets the baseline headers on unauthenticated (401) responses too', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expectSecured(res);
  });
});
