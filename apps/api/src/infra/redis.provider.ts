import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

export const REDIS = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: () =>
    new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    }),
};
