/**
 * WP-12 — API responses default to Cache-Control: private, no-store.
 *
 * API payloads are tenant data; without an explicit Cache-Control, shared
 * proxies and browser heuristics may cache them. The securityHeaders
 * middleware now sets a no-store default; asset-streaming routes (logos,
 * photos) override it with their own short-lived values after the fact.
 * The matching (app)-route web headers live in next.config.mjs and are
 * covered by the config sanity-load, not this suite.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60_000);

describe('API cache-control default (WP-12)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('public routes are not cacheable', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('unauthenticated error responses are not cacheable either', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});
