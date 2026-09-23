-- Q117 (docs/OPEN.md): every migration version on prod must have been applied
-- by .github/workflows/db-deploy.yml, the only path that runs the gates
-- (migration lint, replay smoke, destructive-DDL pre-flight).
--
-- MEASURED 2026-09-23: prod's workflow_run_logs show the Supabase GitHub
-- integration (branch "main", id d604a554-ded1-4193-b8cf-35d01823433c,
-- is_default) cloning main and running "Applying migration ..." on every push:
-- 24 migrations in the 24h to 10:59Z, including 20260923100454 at 10:14:19Z
-- (its db-deploy run was red at lint, push job skipped) and 20260923101130 at
-- 10:21:06Z (db-deploy's push job started 10:24:14Z and found nothing to do).
--
-- This table is db-deploy's receipt: after `supabase db push` succeeds, the
-- workflow inserts one row per version the CLI printed "Applying migration"
-- for, with its own run id / attempt / sha. scripts/check-migration-provenance.mjs
-- (db-deploy after push, and db-drift-detect nightly) fails on any
-- schema_migrations version newer than the cutoff in
-- scripts/audit/migration-provenance.json that has no receipt, and on any
-- receipt whose run id is not a db-deploy.yml run on main.
--
-- Written ONLY by the workflow (as postgres, via the Management API). No
-- migration may write it (src/test/migrationProvenance.test.ts); no client
-- role can read or write it.
--
-- Replay-safe: the table is created only if absent; RLS, revoke and comment are
-- idempotent.

CREATE TABLE IF NOT EXISTS public.migration_deploy_ledger (
  version      text        PRIMARY KEY CHECK (version ~ '^[0-9]{14}$'),
  run_id       bigint      NOT NULL CHECK (run_id > 0),
  run_attempt  int         NOT NULL DEFAULT 1 CHECK (run_attempt > 0),
  head_sha     text        NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.migration_deploy_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.migration_deploy_ledger FROM PUBLIC, anon, authenticated;
-- Server-only, said out loud. The workflow writes as postgres (the owner).
GRANT SELECT, INSERT ON TABLE public.migration_deploy_ledger TO service_role;

COMMENT ON TABLE public.migration_deploy_ledger IS
  'Q117: db-deploy.yml''s receipt for each migration version it applied (run id, attempt, sha). Written only by that workflow; checked against supabase_migrations.schema_migrations by scripts/check-migration-provenance.mjs. Server-only.';
