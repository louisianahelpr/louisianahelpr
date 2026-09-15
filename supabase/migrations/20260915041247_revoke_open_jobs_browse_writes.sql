-- open_jobs_browse must be SELECT-only for clients — a definer view bypasses jobs RLS on write.
--
-- CRITICAL, proven on prod 2026-09-15 inside a rolled-back transaction against
-- is_seed job 5eed0a10-0000-4000-8000-000000000001:
--   * as anon (no JWT):   DELETE FROM public.open_jobs_browse WHERE id=<job>  -> 1 row
--   * as a signed-in stranger (not a party to the job):
--                         UPDATE public.open_jobs_browse SET customer_id=<self> -> 1 row
-- The reviewer also reproduced an anon INSERT carrying a victim's customer_id
-- and payment_status='escrow'. Through PostgREST these are a plain DELETE / PATCH
-- / POST on /rest/v1/open_jobs_browse with the anon key.
--
-- WHY IT WORKS. The view is owned by `postgres` (rolbypassrls=true) and is
-- WITH (security_invoker=false), so a write through it lands on `jobs` with
-- jobs' RLS bypassed. The view is auto-updatable
-- (pg_relation_is_updatable=28). Its filter admits funded jobs
-- (payment_status IN ('escrow','payout_pending','released')). No app code ever
-- writes through it — every caller is .select()-only.
--
-- WHY THE 2026-07-06 FIX (20260706140000) DID NOT HOLD. That migration revoked
-- exactly these privileges. But prod carries a default-privilege rule
-- (pg_default_acl, read 2026-09-15):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ... TO anon, authenticated;   -- anon/authenticated get arwdxm on every RELATION
-- so every later `DROP VIEW; CREATE VIEW` of a postgres-owned view re-grants
-- INSERT/UPDATE/DELETE/REFERENCES/MAINTAIN, silently, over the migration's own
-- `GRANT SELECT`. 20260912021641 (require_photo_proof_per_job) recreated the
-- view that way and re-opened the hole. A one-off REVOKE is therefore not
-- enough on its own; the durable guard is the live-catalog class check
-- scripts/check-updatable-views.mjs (nightly in db-drift-detect), which fails
-- on ANY exposed-schema view that is security_invoker-off AND client-writable,
-- so the next recreation that re-opens this cannot pass unseen.
--
-- security_invoker stays FALSE on purpose: jobs' SELECT policies are all scoped
-- to `authenticated`, so this masked, owner-run view is the deliberate anon
-- guest-browse read path (DashboardGuest.tsx). The bug is the WRITE grant, not
-- the read behaviour — so this only tightens grants, exactly as 20260706140000
-- intended.
--
-- REPLAY-SAFETY: guarded on the view existing; REVOKE/GRANT are idempotent.

DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    -- Every write privilege, from every way a client role can hold it. Named
    -- roles AND PUBLIC: `FROM PUBLIC` alone leaves an explicit anon/authenticated
    -- grant, and the default-privilege grant above is explicit, per role.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
      ON public.open_jobs_browse
      FROM PUBLIC, anon, authenticated;

    -- The one privilege the view exists to provide.
    GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

    COMMENT ON VIEW public.open_jobs_browse IS
      'SELECT-only for anon/authenticated. Owner (postgres) bypasses RLS, so a write through this view would bypass jobs RLS; writes are revoked here (20260915041247) and re-checked live by scripts/check-updatable-views.mjs. If you DROP+CREATE this view, the default-privilege GRANT re-opens writes — re-run the REVOKE.';
  END IF;
END
$$;
