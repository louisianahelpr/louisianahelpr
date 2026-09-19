-- A CANCELLED job's thread closes to new messages IMMEDIATELY (owner,
-- 2026-09-19).
--
-- ── THE BUG, VERIFIED LIVE ON PROD (pg_get_functiondef, 2026-09-19) ────────
-- `public.can_message_in_job` gates on:
--     COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)
-- and `job_messaging_closes_at` ended with:
--     FROM public.jobs j WHERE j.id = _job_id AND j.status = 'completed';
-- so for a CANCELLED job the SELECT returned no row, the function returned
-- NULL, `NULL > now()` was NULL, and the outer COALESCE fell through to
-- `true`. Messaging on a cancelled job stayed open FOREVER. Completed jobs
-- locked 24h after completion; cancelled ones never locked at all.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────
-- One CASE on status, two arms:
--   completed  — UNCHANGED. `completed_at` (or the legacy fallback) + 24h.
--                Do not touch this; the 24h window is what gives a dispute
--                something to read.
--   cancelled  — a closing instant that is ALREADY IN THE PAST, anchored on
--                `cancelled_at`, so `closes_at > now()` is false from the
--                moment of cancellation.
-- Every other status still returns NULL and stays open, which is what the
-- gate's outer COALESCE is for.
--
-- ── THE NULL-`cancelled_at` TRAP, AND WHAT WAS CHOSEN ─────────────────────
-- `jobs.cancelled_at` is NULLABLE. Anchoring on it bare would reproduce the
-- exact bug being fixed, on old rows: a NULL anchor makes the whole
-- expression NULL, `NULL > now()` is NULL, and the gate's COALESCE says
-- `true` — open forever, surviving on legacy data.
--
-- Counted read-only on prod (fncmgoasalhdgfwzhsqa, 2026-09-19):
--     cancelled jobs total .......... 97
--     of those, cancelled_at IS NULL . 0
-- So there is no backfill to do TODAY. The guard is written anyway, because
-- "zero right now" is not a constraint: nothing in the schema stops a future
-- insert, a service-role script or an admin tool from landing a cancelled row
-- with no timestamp, and the failure mode would be silent and permanent.
--
-- The fallback chain is COALESCE(cancelled_at, updated_at, created_at):
--   - `updated_at` is NOT NULL and is the timestamp the cancelling UPDATE
--     itself moved, so on a legacy row it is the best available stand-in for
--     "when this was cancelled";
--   - `created_at` is NOT NULL and is the last resort.
-- Both being NOT NULL, the expression cannot be NULL, so the outer COALESCE
-- in the gate can never be reached down this arm. Deliberately NOT
-- '-infinity': a real timestamp keeps the value meaningful to anything that
-- reads it (the client renders it), and the two fallbacks are already
-- guaranteed non-null, so the sentinel would only ever hide a schema change.
--
-- ── WHY `get_messaging_closes_at` MOVES TOO ───────────────────────────────
-- That RPC is how the CLIENT learns a thread is closed, and it carried the
-- same `status = 'completed'` filter. Fixing only the gate would have given
-- us the worst outcome: the server refuses the send, but the composer never
-- learns to replace itself, so the user types a message and taps Send to be
-- told no — the fail-on-tap pattern this codebase has explicitly rejected.
-- The gate and the RPC must agree about which jobs are closed, so they are
-- changed in the same migration. `can_message_in_job` itself is untouched:
-- it already reads whatever `job_messaging_closes_at` answers.
--
-- Replay-safe: CREATE OR REPLACE only, no DROP, no new objects, and every
-- REVOKE restated (Postgres' default privileges re-grant on a DROP+CREATE,
-- and restating costs nothing on a replace). Verified on prod beforehand:
--   job_messaging_closes_at  {postgres=X/postgres,service_role=X/postgres}
--   get_messaging_closes_at  {postgres=X/postgres,authenticated=X/postgres,
--                             service_role=X/postgres}
-- which is the shape the GRANTs at the bottom restore.

CREATE OR REPLACE FUNCTION public.job_messaging_closes_at(_job_id uuid)
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE j.status
    WHEN 'completed' THEN
      -- UNCHANGED from the shipped behaviour: 24h after completion.
      COALESCE(
        j.completed_at,
        public.job_legacy_completed_at(j.poster_completed_at, j.helper_completed_at,
                                       j.revision_completed_at, j.updated_at)
      ) + interval '24 hours'
    WHEN 'cancelled' THEN
      -- Already in the past by construction. See the NULL trap note above:
      -- updated_at and created_at are both NOT NULL, so this arm can never
      -- evaluate to NULL and can never fall through to "still open".
      COALESCE(j.cancelled_at, j.updated_at, j.created_at)
    ELSE NULL
  END
  FROM public.jobs j
  WHERE j.id = _job_id;
$function$;

REVOKE ALL ON FUNCTION public.job_messaging_closes_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_messaging_closes_at(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_messaging_closes_at(_job_ids uuid[])
RETURNS TABLE(job_id uuid, closes_at timestamp with time zone, server_now timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT j.id, public.job_messaging_closes_at(j.id), now()
  FROM public.jobs j
  WHERE j.id = ANY (_job_ids)
    AND cardinality(_job_ids) <= 500
    -- WAS `j.status = 'completed'`. Cancelled joins it so the client learns
    -- about a closed cancelled thread instead of discovering it on send.
    AND j.status IN ('completed', 'cancelled')
    AND auth.uid() IS NOT NULL
    AND (
      auth.uid() IN (j.customer_id, j.helper_id, j.offered_to_helper_id)
      OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 WHERE g.job_id = j.id AND g.helper_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.messages m
                 WHERE m.job_id = j.id
                   AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid()))
    );
$function$;

REVOKE ALL ON FUNCTION public.get_messaging_closes_at(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_messaging_closes_at(uuid[]) TO authenticated, service_role;
