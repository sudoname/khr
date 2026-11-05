import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Prisma, PrismaClient, tenantClient } from '@peopleflow/database';
import { COMPANY_ROLES, roleHas } from '@peopleflow/types';
import { config } from './config';
import { logger } from './logger';
import type { EmailJob } from './email.worker';

const QUEUE = 'reports';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Roles that may receive salary data — kept in sync with the permission matrix. */
const RECIPIENT_ROLES = COMPANY_ROLES.filter((r) => roleHas(r, 'compensation.read'));

/** Mirrors apps/api/src/payroll/nigeria-tax.ts toMonthlyGross. */
function toMonthlyGross(
  baseSalary: Prisma.Decimal,
  payFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'ANNUAL',
): Prisma.Decimal {
  switch (payFrequency) {
    case 'MONTHLY':
      return baseSalary;
    case 'ANNUAL':
      return baseSalary.div(12);
    case 'WEEKLY':
      return baseSalary.mul(52).div(12);
    case 'BIWEEKLY':
      return baseSalary.mul(26).div(12);
  }
}

/** Spreadsheet formula-injection guard (mirrors apps/api/src/common/csv.ts). */
const RISKY_PREFIX = /^[=+\-@\t\r]/;
function csvSafe(value: string | null | undefined): string {
  if (!value) return '';
  return RISKY_PREFIX.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface CompanyCsv {
  csv: string;
  filename: string;
  rows: number;
}

async function buildCompanyCsv(prisma: PrismaClient, companyId: string, now: Date): Promise<CompanyCsv | null> {
  const tenant = tenantClient(prisma, companyId);
  const employees = await tenant.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: {
      employeeNo: true,
      firstName: true,
      lastName: true,
      bankAccountNumber: true,
      compensations: {
        orderBy: { effectiveDate: 'desc' },
        take: 1,
        select: { baseSalary: true, payFrequency: true },
      },
    },
    orderBy: { employeeNo: 'asc' },
  });

  const month = MONTHS[now.getUTCMonth()];
  const year = now.getUTCFullYear();
  const paymentDate = `${String(now.getUTCDate()).padStart(2, '0')}/${month}/${year}`;

  const rows = employees
    .filter((e) => e.compensations.length > 0)
    .map((e) => [
      toMonthlyGross(e.compensations[0].baseSalary, e.compensations[0].payFrequency).toFixed(2),
      paymentDate,
      '',
      `SALARY FOR ${month} ${year}`.slice(0, 25),
      csvSafe(e.employeeNo),
      csvSafe(`${e.firstName} ${e.lastName}`.toUpperCase().slice(0, 50)),
      (e.bankAccountNumber ?? '').replace(/\D/g, '').slice(0, 15),
      '',
    ]);
  if (rows.length === 0) return null;

  const header = [
    'PaymentAmount',
    'PaymentDate',
    'Reference',
    'Remark',
    'VendorCode',
    'VendorName',
    'VendorAcctNumber',
    'VendorBankSortCode',
  ];
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  const filename = `bank-payments-${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}.csv`;
  return { csv, filename, rows: rows.length };
}

/**
 * Monthly bank payment file: on the 25th at 07:00 Lagos time, build the
 * GTBank bulk-payment CSV for every company and email it to members whose
 * role carries `compensation.read` (company admin, HR admin, payroll officer).
 */
export async function startBankPayments(prisma: PrismaClient): Promise<Worker> {
  const connection = () => new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE, { connection: connection() });
  await queue.upsertJobScheduler(
    'monthly-bank-payments',
    { pattern: '0 7 25 * *', tz: 'Africa/Lagos' },
    { name: 'bank-payments' },
  );

  const emailQueue = new Queue<EmailJob>('email', { connection: connection() });

  const worker = new Worker(
    QUEUE,
    async () => {
      const now = new Date();
      const companies = await prisma.company.findMany({ select: { id: true, name: true } });
      for (const company of companies) {
        try {
          const file = await buildCompanyCsv(prisma, company.id, now);
          if (!file) continue;

          const tenant = tenantClient(prisma, company.id);
          const recipients = await tenant.membership.findMany({
            where: { role: { in: [...RECIPIENT_ROLES] } },
            select: { user: { select: { email: true } } },
          });
          const to = recipients.map((r) => r.user.email).join(', ');
          if (!to) continue;

          await emailQueue.add(
            'send',
            {
              to,
              subject: `${company.name}: bank payment file — ${file.filename}`,
              text:
                `Attached is this month's bulk bank payment CSV for ${company.name} ` +
                `(${file.rows} employee${file.rows === 1 ? '' : 's'} with a compensation record). ` +
                `Amounts are the current monthly base salary; review before uploading to the bank.`,
              attachments: [{ filename: file.filename, content: file.csv, contentType: 'text/csv' }],
              companyId: company.id,
            },
            { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
          );
          logger.info({ companyId: company.id, rows: file.rows, to }, 'bank payment CSV queued');
        } catch (err) {
          // One bad company must not stop the rest.
          logger.error({ companyId: company.id, err: (err as Error).message }, 'bank payment CSV failed');
        }
      }
    },
    { connection: connection() },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'bank payments job failed');
  });
  return worker;
}
