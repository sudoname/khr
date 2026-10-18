import { PrismaClient } from '@prisma/client';

/**
 * Models that carry a `companyId` column and must always be scoped to the
 * active tenant. Any query made through `tenantClient` against these models
 * has the tenant filter injected at the data-access layer, regardless of what
 * the caller supplied. This is the primary tenant-isolation enforcement point
 * (complemented by Postgres RLS policies, see migration `rls_policies`).
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
 * AND-ed with the tenant filter, create data has companyId overwritten.
 */
export function tenantClient(prisma: PrismaClient, companyId: string) {
  if (!companyId) throw new Error('tenantClient requires a companyId');
  return prisma.$extends({
    name: `tenant:${companyId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
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

          return query(a as never);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof tenantClient>;
