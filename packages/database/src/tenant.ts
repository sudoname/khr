import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Models that carry a `companyId` column and must always be scoped to the
 * active tenant. Any query made through `tenantClient` against these models
 * has the tenant filter injected at the data-access layer, regardless of what
 * the caller supplied.
 *
 * Defense-in-depth: every operation through the tenant client also runs with
 * the transaction-local setting `app.company_id`, which activates the
 * Postgres RLS policies (see migrations `rls_policies` / `rls_enforcement`).
 * When the app connects as the non-owner role `khr_app`, a model missing from
 * this set is therefore still contained at the database level.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Membership',
  'Location',
  'Department',
  'Employee',
  'EmergencyContact',
  'Compensation',
  'EmploymentEvent',
  'Holiday',
  'LeaveType',
  'LeavePolicy',
  'LeaveBalance',
  'LeaveRequest',
  'LeaveApproval',
  'AttendancePolicy',
  'AttendanceRecord',
  'AttendanceCorrection',
  'AuditLog',
  'EmployeeAvatar',
  'CompanyLogo',
  'PayrollSettings',
  'PayrollRun',
  'Payslip',
]);

const UNIQUE_WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const FILTER_WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Returns a Prisma client whose queries against tenant models are forcibly
 * scoped to `companyId`. Callers cannot widen the scope: supplied filters are
 * AND-ed with the tenant filter, create data has companyId overwritten, and
 * each operation runs in a transaction with `app.company_id` set so Postgres
 * RLS applies as a second enforcement layer.
 *
 * NOTE: because every operation is wrapped in its own transaction here,
 * `$transaction` on the tenant client is NOT supported — multi-statement
 * transactions must use the raw client with an explicit
 * `set_config('app.company_id', ..., true)` as their first statement (see
 * PayrollService.compute for the pattern).
 */
export function tenantClient(prisma: PrismaClient, companyId: string) {
  if (!companyId) throw new Error('tenantClient requires a companyId');
  return prisma.$extends({
    name: `tenant:${companyId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let scoped = args;
          if (model && TENANT_MODELS.has(model)) {
            const a: Record<string, unknown> = { ...(args as Record<string, unknown>) };

            if (UNIQUE_WHERE_OPS.has(operation)) {
              // Prisma "extended where unique" allows extra scalar filters
              // alongside the unique selector.
              a.where = { ...(a.where as object), companyId };
            } else if (FILTER_WHERE_OPS.has(operation)) {
              a.where = { AND: [(a.where as object) ?? {}, { companyId }] };
            }

            if (operation === 'create') {
              a.data = { ...(a.data as object), companyId };
            } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
              const data = (a as { data?: unknown }).data;
              a.data = Array.isArray(data)
                ? data.map((d) => ({ ...(d as object), companyId }))
                : { ...(data as object), companyId };
            } else if (operation === 'upsert') {
              a.create = { ...(a.create as object), companyId };
            }

            scoped = a as never;
          }

          // Run the operation in a transaction that carries the tenant id as
          // a transaction-local GUC, activating the Postgres RLS policies.
          // Applied to ALL models (not just TENANT_MODELS) so that a model
          // accidentally missing from the set is still contained by RLS.
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.company_id', ${companyId}, TRUE)`,
            query(scoped) as unknown as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof tenantClient>;
