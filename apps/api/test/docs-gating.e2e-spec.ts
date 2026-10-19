/**
 * WP-3 — API docs are gated to non-production.
 *
 * SwaggerModule was mounted unconditionally in main.ts, exposing the full
 * API surface map (routes, DTO shapes, auth scheme) at /docs on the public
 * internet. mountDocs() must skip mounting when disabled (prod), so /docs
 * and /docs-json fall through to the standard 404 — not a 403 that would
 * confirm the route exists.
 */
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mountDocs } from '../src/docs';

@Module({})
class EmptyModule {}

async function makeApp(enabled: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [EmptyModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  mountDocs(app, enabled);
  await app.init();
  return app;
}

describe('API docs gating (WP-3)', () => {
  it('serves /docs when enabled (development)', async () => {
    const app = await makeApp(true);
    try {
      const res = await request(app.getHttpServer()).get('/docs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('swagger');
      await request(app.getHttpServer()).get('/docs-json').expect(200);
    } finally {
      await app.close();
    }
  });

  it('returns 404 (not 403) for /docs and /docs-json when disabled (production)', async () => {
    const app = await makeApp(false);
    try {
      await request(app.getHttpServer()).get('/docs').expect(404);
      await request(app.getHttpServer()).get('/docs-json').expect(404);
    } finally {
      await app.close();
    }
  });
});
