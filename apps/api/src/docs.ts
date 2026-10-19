import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config } from './config';

/**
 * WP-3: Swagger docs are a development aid. In production the route is never
 * mounted, so /docs (and /docs-json) fall through to Nest's standard 404 —
 * indistinguishable from any other unknown path (404, not 403).
 */
export function mountDocs(app: INestApplication, enabled: boolean = !config.isProd): boolean {
  if (!enabled) return false;
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PeopleFlow HR API')
    .setDescription('Multi-tenant HR management platform API')
    .setVersion('0.1.0')
    .addCookieAuth(config.sessionCookieName)
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  return true;
}
