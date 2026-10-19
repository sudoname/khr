import 'reflect-metadata';
import { config } from './config'; // loads .env first
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { AppModule } from './app.module';
import { originAllowed, originCheck } from './common/origin.middleware';
import { mountDocs } from './docs';

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

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || originAllowed(origin)),
    credentials: true,
  });
  app.enableShutdownHooks();

  const docsMounted = mountDocs(app);

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`PeopleFlow API listening on http://localhost:${config.port}${docsMounted ? ' (docs at /docs)' : ''}`);
}

bootstrap();
