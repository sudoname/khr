-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only AuditLog (WP-4).
--
-- The audit trail was writable: `khr_app` holds blanket
-- SELECT/INSERT/UPDATE/DELETE grants (rls_enforcement_and_employee_seq) and
-- the `tenant_isolation` policy is FOR ALL, so any tenant-scoped code path —
-- or an attacker with the app credential — could rewrite or erase audit
-- history for its own tenant. Two independent layers fix this:
--
--   1. Grants: REVOKE UPDATE, DELETE on "AuditLog" from khr_app.
--   2. Trigger: BEFORE UPDATE OR DELETE raises for EVERY role, including the
--      table owner (which bypasses non-FORCEd RLS and keeps all grants).
--
-- The one legitimate mutation is the FK action from "User"
-- (AuditLog_userId_fkey ... ON DELETE SET NULL): deleting a user anonymizes
-- their audit rows (userId → NULL) without touching any other column. The
-- trigger permits exactly that shape and nothing else.
--
-- INSERT behavior is unchanged: the `audit_insert` policy (rls_fail_closed)
-- still accepts rows in audit scope, and tenant-scoped inserts still pass
-- `tenant_isolation`'s WITH CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'khr_app') THEN
    REVOKE UPDATE, DELETE ON "AuditLog" FROM khr_app;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."userId" IS NOT NULL
     AND NEW."userId" IS NULL
     AND NEW."id" = OLD."id"
     AND NEW."companyId" IS NOT DISTINCT FROM OLD."companyId"
     AND NEW."action" = OLD."action"
     AND NEW."entity" IS NOT DISTINCT FROM OLD."entity"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId"
     AND NEW."meta" IS NOT DISTINCT FROM OLD."meta"
     AND NEW."ip" IS NOT DISTINCT FROM OLD."ip"
     AND NEW."createdAt" = OLD."createdAt"
  THEN
    -- FK ON DELETE SET NULL from "User": anonymization only.
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP;
END
$fn$;

DROP TRIGGER IF EXISTS audit_immutable ON "AuditLog";
CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
