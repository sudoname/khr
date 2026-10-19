/**
 * Database-level proof that row-level security is fail-closed for the
 * application role.
 *
 * The regular e2e suite exercises app-layer isolation but connects as the
 * table OWNER (local dev DATABASE_URL), which bypasses non-FORCEd RLS. This
 * suite connects a second Prisma client as the non-owner role `khr_app` —
 * exactly how the api/worker connect in production — and asserts the policy
 * matrix introduced by the `rls_fail_closed` migration:
 *
 *   no GUC          → sees nothing, writes nothing (DEFAULT DENY)
 *   app.company_id  → rows of that tenant only (USING + WITH CHECK)
 *   auth scope      → own Membership rows only, SELECT only
 *   audit scope     → AuditLog INSERT only, no reads
 *   platform scope  → cross-tenant SELECT only, no writes
 *
 * Plus the `audit_append_only` migration (WP-4): AuditLog rows can never be
 * updated or deleted — khr_app loses the grants, and a trigger blocks even
 * the owner. The single allowed mutation is the FK ON DELETE SET NULL from
 * User (anonymization on user deletion).
 *
 * Requires the local docker-compose Postgres with migrations applied.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  PrismaClient,
  auditClient,
  authClient,
  platformClient,
  tenantClient,
} from '@peopleflow/database';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

jest.setTimeout(120_000);

const STAMP = Date.now();
const APP_ROLE = 'khr_app';
// Local-only throwaway credential, set for the duration of the suite.
const APP_PASSWORD = `rls-e2e-${STAMP}`;

function appRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

describe('RLS fail-closed (khr_app role)', () => {
  // When the suite itself runs with DATABASE_URL pointing at khr_app (see
  // TEST_RESULTS), OWNER_DATABASE_URL must carry the owner credential used
  // for fixtures and the sanity assertions.
  const ownerUrl = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL must be set (repo-root .env)');

  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  let app: PrismaClient;

  // Seeded fixtures (created as owner, which bypasses RLS).
  let companyA: { id: string };
  let companyB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let empA: { id: string };
  let empB: { id: string };

  beforeAll(async () => {
    if (!process.env.OWNER_DATABASE_URL) {
      // The migration creates khr_app passwordless; give it a throwaway local
      // password so this suite can authenticate over TCP. Skipped when the
      // whole run is already using khr_app credentials (DATABASE_URL) — then
      // we must not invalidate the password other suites are connecting with.
      await owner.$executeRawUnsafe(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'`);
    }

    companyA = await owner.company.create({
      data: { name: `RLS A ${STAMP}`, slug: `rls-a-${STAMP}` },
      select: { id: true },
    });
    companyB = await owner.company.create({
      data: { name: `RLS B ${STAMP}`, slug: `rls-b-${STAMP}` },
      select: { id: true },
    });
    userA = await owner.user.create({
      data: { email: `rls.a.${STAMP}@example.test`, firstName: 'Rls', lastName: 'A', passwordHash: 'x' },
      select: { id: true },
    });
    userB = await owner.user.create({
      data: { email: `rls.b.${STAMP}@example.test`, firstName: 'Rls', lastName: 'B', passwordHash: 'x' },
      select: { id: true },
    });
    await owner.membership.create({
      data: { userId: userA.id, companyId: companyA.id, role: 'COMPANY_ADMIN' },
    });
    await owner.membership.create({
      data: { userId: userB.id, companyId: companyB.id, role: 'COMPANY_ADMIN' },
    });
    empA = await owner.employee.create({
      data: {
        companyId: companyA.id,
        employeeNo: `RLS-A-${STAMP}`,
        firstName: 'Emp',
        lastName: 'A',
        workEmail: `emp.a.${STAMP}@example.test`,
        jobTitle: 'Engineer',
        employmentType: 'FULL_TIME',
        hireDate: new Date('2026-01-05T00:00:00.000Z'),
      },
      select: { id: true },
    });
    empB = await owner.employee.create({
      data: {
        companyId: companyB.id,
        employeeNo: `RLS-B-${STAMP}`,
        firstName: 'Emp',
        lastName: 'B',
        workEmail: `emp.b.${STAMP}@example.test`,
        jobTitle: 'Engineer',
        employmentType: 'FULL_TIME',
        hireDate: new Date('2026-01-05T00:00:00.000Z'),
      },
      select: { id: true },
    });

    // Already running as khr_app? Reuse that URL; otherwise swap credentials.
    const appUrl = process.env.OWNER_DATABASE_URL ? process.env.DATABASE_URL! : appRoleUrl(ownerUrl);
    app = new PrismaClient({ datasources: { db: { url: appUrl } } });
    await app.$connect();
  });

  afterAll(async () => {
    await app?.$disconnect();
    // Cascades remove memberships/employees; users go last.
    await owner.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await owner.$disconnect();
  });

  // ───────────────────────── default deny ─────────────────────────

  describe('with no GUC set (default deny)', () => {
    it('owner sees the seeded rows (sanity: RLS is what hides them)', async () => {
      const rows = await owner.employee.findMany({ where: { id: { in: [empA.id, empB.id] } } });
      expect(rows).toHaveLength(2);
    });

    it('sees no Employee, Membership or AuditLog rows', async () => {
      expect(await app.employee.findMany({ where: { id: { in: [empA.id, empB.id] } } })).toHaveLength(0);
      expect(await app.membership.findMany({ where: { userId: { in: [userA.id, userB.id] } } })).toHaveLength(0);
      expect(await app.auditLog.count()).toBe(0);
    });

    it('cannot INSERT into an RLS table', async () => {
      await expect(
        app.employee.create({
          data: {
            companyId: companyA.id,
            employeeNo: `RLS-DENY-${STAMP}`,
            firstName: 'Deny',
            lastName: 'Me',
            workEmail: `deny.${STAMP}@example.test`,
            jobTitle: 'Intruder',
            employmentType: 'FULL_TIME',
            hireDate: new Date('2026-01-05T00:00:00.000Z'),
          },
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('UPDATE and DELETE match zero rows', async () => {
      const upd = await app.employee.updateMany({ where: { id: empA.id }, data: { jobTitle: 'Hijacked' } });
      expect(upd.count).toBe(0);
      const del = await app.membership.deleteMany({ where: { userId: userA.id } });
      expect(del.count).toBe(0);
    });
  });

  // ───────────────────────── tenant scope ─────────────────────────

  describe('tenantClient', () => {
    it('sees only its own tenant rows', async () => {
      const dbA = tenantClient(app, companyA.id);
      const rows = await dbA.employee.findMany({ where: { id: { in: [empA.id, empB.id] } } });
      expect(rows.map((r) => r.id)).toEqual([empA.id]);
      expect(await dbA.employee.findUnique({ where: { id: empB.id } })).toBeNull();
    });

    it('cannot mutate another tenant row', async () => {
      const dbA = tenantClient(app, companyA.id);
      await expect(
        dbA.employee.update({ where: { id: empB.id }, data: { jobTitle: 'Hijacked' } }),
      ).rejects.toThrow(); // P2025: where-injection + RLS hide the row entirely
      const untouched = await owner.employee.findUniqueOrThrow({ where: { id: empB.id } });
      expect(untouched.jobTitle).toBe('Engineer');
    });

    it('forces created rows into its own tenant (caller-supplied companyId ignored)', async () => {
      const dbA = tenantClient(app, companyA.id);
      const created = await dbA.employee.create({
        data: {
          // Attempt to smuggle a row into tenant B — the tenant client
          // overwrites companyId, and WITH CHECK would reject it anyway.
          companyId: companyB.id,
          employeeNo: `RLS-SMUGGLE-${STAMP}`,
          firstName: 'Smuggle',
          lastName: 'Test',
          workEmail: `smuggle.${STAMP}@example.test`,
          jobTitle: 'Engineer',
          employmentType: 'FULL_TIME',
          hireDate: new Date('2026-01-05T00:00:00.000Z'),
        } as never,
      });
      expect((created as { companyId: string }).companyId).toBe(companyA.id);
      await owner.employee.delete({ where: { id: (created as { id: string }).id } });
    });

    it('cannot re-home a row to another tenant (WITH CHECK)', async () => {
      const dbA = tenantClient(app, companyA.id);
      await expect(
        dbA.employee.update({ where: { id: empA.id }, data: { companyId: companyB.id } as never }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('scope is transaction-local: the raw connection stays blind afterwards', async () => {
      expect(await app.employee.count({ where: { id: empA.id } })).toBe(0);
    });
  });

  // ───────────────────────── auth scope ─────────────────────────

  describe('authClient', () => {
    it('reads only the given user own memberships', async () => {
      const auth = authClient(app, userA.id);
      const mine = await auth.membership.findMany({});
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.every((m) => m.userId === userA.id)).toBe(true);
      expect(await auth.membership.findMany({ where: { userId: userB.id } })).toHaveLength(0);
    });

    it('sees no other tenant table', async () => {
      const auth = authClient(app, userA.id);
      expect(await auth.employee.count({ where: { id: { in: [empA.id, empB.id] } } })).toBe(0);
    });

    it('cannot write memberships', async () => {
      const auth = authClient(app, userA.id);
      await expect(
        auth.membership.create({
          data: { userId: userA.id, companyId: companyB.id, role: 'COMPANY_ADMIN' },
        }),
      ).rejects.toThrow(/row-level security/i);
      const upd = await auth.membership.updateMany({
        where: { userId: userA.id },
        data: { role: 'EMPLOYEE' },
      });
      expect(upd.count).toBe(0);
    });
  });

  // ───────────────────────── audit scope ─────────────────────────

  describe('auditClient', () => {
    it('can INSERT audit rows (tenantless and tenant-tagged) but not read them back', async () => {
      const audit = auditClient(app);
      const res = await audit.auditLog.createMany({
        data: [
          { action: `rls.e2e.${STAMP}`, companyId: null },
          { action: `rls.e2e.${STAMP}`, companyId: companyA.id },
        ],
      });
      expect(res.count).toBe(2);
      expect(await audit.auditLog.count({ where: { action: `rls.e2e.${STAMP}` } })).toBe(0);
      // The rows really landed (owner can see them)…
      expect(await owner.auditLog.count({ where: { action: `rls.e2e.${STAMP}` } })).toBe(2);
      // …and the tenant-tagged one is readable in tenant scope.
      expect(
        await tenantClient(app, companyA.id).auditLog.count({ where: { action: `rls.e2e.${STAMP}` } }),
      ).toBe(1);
      // No cleanup: AuditLog is append-only (see WP-4 tests below); the
      // STAMP-unique action keeps runs independent.
    });
  });

  // ───────────────────────── append-only audit (WP-4) ─────────────────────────

  describe('append-only AuditLog', () => {
    const action = `rls.e2e.${STAMP}`;

    it('khr_app cannot UPDATE audit rows even in tenant scope (grant revoked)', async () => {
      const dbA = tenantClient(app, companyA.id);
      await expect(
        dbA.auditLog.updateMany({ where: { action }, data: { action: `${action}.tampered` } }),
      ).rejects.toThrow(/permission denied|append-only/i);
      expect(await owner.auditLog.count({ where: { action } })).toBe(2);
    });

    it('khr_app cannot DELETE audit rows even in tenant scope (grant revoked)', async () => {
      const dbA = tenantClient(app, companyA.id);
      await expect(dbA.auditLog.deleteMany({ where: { action } })).rejects.toThrow(
        /permission denied|append-only/i,
      );
      expect(await owner.auditLog.count({ where: { action } })).toBe(2);
    });

    it('even the table owner cannot UPDATE or DELETE (trigger)', async () => {
      await expect(
        owner.auditLog.updateMany({ where: { action }, data: { action: `${action}.tampered` } }),
      ).rejects.toThrow(/append-only/i);
      await expect(owner.auditLog.deleteMany({ where: { action } })).rejects.toThrow(/append-only/i);
      expect(await owner.auditLog.count({ where: { action } })).toBe(2);
    });

    it('deleting a user still anonymizes their audit rows (FK SET NULL carve-out)', async () => {
      const anonAction = `rls.e2e.anon.${STAMP}`;
      const userC = await owner.user.create({
        data: { email: `rls.c.${STAMP}@example.test`, firstName: 'Rls', lastName: 'C', passwordHash: 'x' },
        select: { id: true },
      });
      await owner.auditLog.create({ data: { action: anonAction, userId: userC.id } });
      // Must not trip the trigger: the FK action's UPDATE only nulls userId.
      await owner.user.delete({ where: { id: userC.id } });
      const row = await owner.auditLog.findFirst({ where: { action: anonAction } });
      expect(row).not.toBeNull();
      expect(row?.userId).toBeNull();
    });

    it('audit INSERTs still work after the lockdown (audit scope)', async () => {
      // createMany: audit scope is INSERT-only, so INSERT..RETURNING (create)
      // cannot see the new row back.
      const audit = auditClient(app);
      const res = await audit.auditLog.createMany({
        data: [{ action: `${action}.post-lockdown`, companyId: companyA.id }],
      });
      expect(res.count).toBe(1);
      expect(await owner.auditLog.count({ where: { action: `${action}.post-lockdown` } })).toBe(1);
    });
  });

  // ───────────────────────── platform scope ─────────────────────────

  describe('platformClient', () => {
    it('reads across tenants but cannot write', async () => {
      const platform = platformClient(app);
      const rows = await platform.employee.findMany({ where: { id: { in: [empA.id, empB.id] } } });
      expect(rows.map((r) => r.id).sort()).toEqual([empA.id, empB.id].sort());

      const upd = await platform.employee.updateMany({
        where: { id: empA.id },
        data: { jobTitle: 'Platform Hijack' },
      });
      expect(upd.count).toBe(0);
      const del = await platform.employee.deleteMany({ where: { id: empA.id } });
      expect(del.count).toBe(0);
    });
  });
});
