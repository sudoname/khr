import pino from 'pino';
import { config } from './config';

export const logger = pino(
  config.isProd
    ? { level: 'info' }
    : {
        level: 'debug',
        transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
      },
);
