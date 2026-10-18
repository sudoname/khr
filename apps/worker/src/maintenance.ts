import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@peopleflow/database';
import { config } from './config';
import { logger } from './logger';

const QUEUE = 'maintenance';
const DAY_MS = 86_400_000;

/**
 * Hourly housekeeping:
 *  - delete sessions that expired (or were revoked) more than 7 days ago
 *  - delete security tokens that were used, or expired more than 7 days ago
 * Keeps the recent window so audits/debugging can still inspect them.
 */
export async function startMaintenance(prisma: PrismaClient): Promise<Worker> {
  const connection = () => new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE, { connection: connection() });
  await queue.upsertJobScheduler('hourly-cleanup', { every: 60 * 60 * 1000 }, { name: 'cleanup' });

  const worker = new Worker(
    QUEUE,
    async () => {
      const cutoff = new Date(Date.now() - 7 * DAY_MS);
      const [sessions, tokens] = await Promise.all([
        prisma.session.deleteMany({
          where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
        }),
        prisma.securityToken.deleteMany({
          where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: cutoff } }] },
        }),
      ]);
      logger.info({ sessions: sessions.count, tokens: tokens.count }, 'maintenance cleanup done');
    },
    { connection: connection() },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'maintenance job failed');
  });
  return worker;
}
