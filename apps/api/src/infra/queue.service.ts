import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';

export interface EmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** For audit/trace only; never used to widen access. */
  companyId?: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  readonly email = new Queue<EmailJob>('email', { connection: this.connection });

  async sendEmail(job: EmailJob) {
    try {
      await this.email.add('send', job, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    } catch (err) {
      // Queue unavailability must not break auth flows; log and continue.
      this.logger.error(`Failed to enqueue email to ${job.to}: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.email.close();
    this.connection.disconnect();
  }
}
