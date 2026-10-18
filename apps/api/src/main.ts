import 'reflect-metadata';
import { config } from './config'; // loads .env first
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { AppModule } from './app.module';
import { originCheck } from './common/origin.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      level: config.isProd ? 'info' : 'debug',
      transport: config.isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(cookieParser());
  app.use(originCheck);

  app.enableCors({ origin: config.webOrigins, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PeopleFlow HR API')
    .setDescription('Multi-tenant HR management platform API')
    .setVersion('0.1.0')
    .addCookieAuth(config.sessionCookieName)
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`PeopleFlow API listening on http://localhost:${config.port} (docs at /docs)`);
}

bootstrap();
