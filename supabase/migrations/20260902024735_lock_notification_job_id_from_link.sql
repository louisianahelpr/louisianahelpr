-- Lock notification_job_id_from_link() — the REVOKE its own migration missed.
--
-- 20260901035600 defined public.notification_job_id_from_link(text) with no
-- explicit GRANT or REVOKE, so it shipped on the default PUBLIC EXECUTE.
-- migration-lint.yml caught it, but only AFTER the push, because db-deploy.yml
-- does not depend on the lint job — the two run in parallel off the same
-- commit. Verified live on prod immediately after that deploy: an anonymous
-- POST to /rest/v1/rpc/notification_job_id_from_link returned 200.
--
-- ── Severity, stated honestly ────────────────────────────────────────────────
-- Low, on its own. The function is LANGUAGE sql / IMMUTABLE / PARALLEL SAFE,
-- it is NOT security definer, and it reads no table — it runs four regexes
-- over a string the caller already supplied and hands back a uuid. An
-- anonymous caller learns nothing they did not already have.
--
-- It is fixed anyway because the default grant is the failure mode this repo
-- has been bitten by four times (#355/#358/#364/#366): the Supabase advisor
-- pass strips implicit PUBLIC EXECUTE, and whatever depended on it breaks
-- silently, at a time unrelated to the change that introduced it.
--
-- ── Why REVOKE and not GRANT ─────────────────────────────────────────────────
-- Both in-tree callers execute as the function owner, so neither needs a
-- grant to anon or authenticated:
--   • notifications_fill_job_id() (20260901035600) is SECURITY DEFINER, and a
--     SECURITY DEFINER function runs as its owner, who keeps EXECUTE here
--     regardless of what is revoked from PUBLIC.
--   • the one-time backfill in that same migration ran as the migration owner.
-- No view, RLS policy, CHECK constraint, generated column or client call site
-- references it (grepped the whole tree, not just the SQL).
REVOKE ALL ON FUNCTION public.notification_job_id_from_link(text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notification_job_id_from_link(text) IS
  'Extracts the job uuid a notification link points at, or NULL. Pure text; reads no table. Locked: the only callers are notifications_fill_job_id() (SECURITY DEFINER, runs as owner) and the 20260901035600 backfill.';
