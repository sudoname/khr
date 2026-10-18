import { PrismaClient } from '@peopleflow/database';
import { startEmailWorker } from './email.worker';
import { startMaintenance } from './maintenance';
import { logger } from './logger';

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const emailWorker = startEmailWorker();
  const maintenanceWorker = await startMaintenance(prisma);
  logger.info('worker started: email + maintenance queues');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await Promise.allSettled([emailWorker.close(), maintenanceWorker.close(), prisma.$disconnect()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(err, 'worker failed to start');
  process.exit(1);
});
