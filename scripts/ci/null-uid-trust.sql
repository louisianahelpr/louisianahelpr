-- Class check: a NULL auth.uid() must never, on its own, be what makes a
-- function trust a write. Returns one row per offending function; ZERO ROWS =
-- CLEAN.
--
-- Why: 23 guard triggers in public (jobs money locks, award and cancellation
-- gates, profile self-escalation, credential status, dispute whitelist, message
-- read-only/block checks) returned early on `auth.uid() IS NULL`, meaning
-- "service role". An anon PostgREST request has a NULL uid too, so any path
-- that let anon write those tables (the open_jobs_browse view did, 2026-09-15)
-- skipped every guard. 20260915101102 rebuilt them on public.is_server_context()
-- (NULL uid AND the JWT role claim and SET ROLE are not anon/authenticated).
--
-- Shapes flagged, in the comment-stripped body of any plpgsql function in public:
--   A  pass-through   IF <uid> IS NULL [OR ...] THEN RETURN NEW|OLD|NULL
--   B  gated guard    IF <uid> IS NOT NULL AND ... THEN <anything but RETURN>
--                     (the guard only runs when there IS a uid, so NULL skips it)
-- where <uid> is auth.uid() or a variable assigned from it. The IF condition is
-- fine if it ALSO tests the server context: is_server_context(), auth.role(),
-- current_user, session_user or current_setting('role'...).
-- An RPC that RETURNs nothing / RAISEs on a NULL uid is a denial, not shape A
-- (`RETURN;`, `RETURN QUERY`, `RAISE` are not matched).
--
-- EXEMPT, each reviewed 2026-09-15 (add here only with a reason a reviewer can
-- check against the body):
--   apply_message_scan_consequence  A: RETURN NULL in an AFTER trigger skips
--       ESCALATING anyone; the fraud_flags evidence row is written before it.
--   audit_admin_job_status_change   A: NULL uid is not an admin; the next line
--       returns for every non-admin too. Skips an audit row, never a guard.
--   enforce_ban_gate                B: no uid, no account to be banned
--       (is_caller_banned() is false for a NULL uid regardless).
--   enforce_jobs_arrival_integrity  B: the flagged branch also requires
--       auth.uid() = OLD.customer_id, which a NULL uid can never satisfy, so
--       pre-excluding NULL changes nothing. The arrival-reset block above it is
--       not uid-gated and runs for every writer (20260915101102 reconcile).
--
-- Shared by:
--   .github/workflows/db-smoke.yml      replayed schema (deploy gate)
--   scripts/check-live-privileges.mjs   live prod (db-deploy after push,
--                                       db-drift-detect nightly)
--   scripts/probes/null-uid-guards.probe.mjs  PGlite red/green proof
-- Keep it a single SELECT.
WITH src AS (
  SELECT p.oid,
         p.proname,
         regexp_replace(p.prosrc, '--[^\n]*', '', 'g') AS body
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace
     AND l.lanname = 'plpgsql'
),
uidvars AS (
  -- auth.uid() itself, plus every local variable assigned from it.
  SELECT s.oid, 'auth\.uid\(\)' AS uidre FROM src s
  UNION
  SELECT s.oid, lower(m[1])
    FROM src s
   CROSS JOIN LATERAL regexp_matches(
           s.body,
           '([a-z_][a-z0-9_]*)\s+(?:uuid\s*)?(?::=|default)\s*\(?\s*(?:select\s+)?auth\.uid\(\)',
           'gi') AS m
),
conds AS (
  SELECT s.oid, s.proname, 'A' AS shape, m[2] AS cond
    FROM src s
   CROSS JOIN LATERAL regexp_matches(s.body,
           '(^|[^a-z_])(?:els)?if\s+([^;]*?)\mthen\s+return\s+(?:new|old|null)\M', 'gi') AS m
  UNION ALL
  SELECT s.oid, s.proname, 'B', m[2]
    FROM src s
   CROSS JOIN LATERAL regexp_matches(s.body,
           '(^|[^a-z_])(?:els)?if\s+([^;]*?)\mthen\s+(?!return\M)[a-z]', 'gi') AS m
)
SELECT DISTINCT c.proname AS function_name,
       c.shape,
       left(regexp_replace(c.cond, '\s+', ' ', 'g'), 160) AS condition
  FROM conds c
  JOIN uidvars u ON u.oid = c.oid
 WHERE (   (c.shape = 'A' AND c.cond ~* ('(^|[^a-z0-9_.])' || u.uidre || '\s+is\s+null\M'))
        OR (c.shape = 'B' AND c.cond ~* ('^\s*\(?\s*' || u.uidre || '\s+is\s+not\s+null\s+and\M')))
   AND c.cond !~* '(is_server_context\s*\(|auth\.role\s*\(|\mcurrent_user\M|\msession_user\M|current_setting\s*\(\s*''role'')'
   AND c.proname NOT IN ('apply_message_scan_consequence',
                         'audit_admin_job_status_change',
                         'enforce_ban_gate',
                         'enforce_jobs_arrival_integrity')
 ORDER BY 1, 2
