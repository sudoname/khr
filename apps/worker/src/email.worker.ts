import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { config } from './config';
import { logger } from './logger';

/** Mirrors the producer-side payload in apps/api (QueueService.sendEmail). */
export interface EmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
  companyId?: string;
}

export function startEmailWorker(): Worker<EmailJob> {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
  });

  const worker = new Worker<EmailJob>(
    'email',
    async (job) => {
      const { to, subject, text, html } = job.data;
      await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
      logger.info({ to, subject, jobId: job.id }, 'email sent');
    },
    {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, to: job?.data?.to, err: err.message }, 'email job failed');
  });
  return worker;
}
