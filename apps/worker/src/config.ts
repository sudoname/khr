import * as dotenv from 'dotenv';
import * as path from 'path';

// Load repo-root .env first (monorepo layout), then any local overrides.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM ?? 'PeopleFlow HR <no-reply@peopleflow.local>',
  },
};
