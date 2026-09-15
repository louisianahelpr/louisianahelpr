-- reject_pending_job stays gone: replaying the migrations must agree with prod.
--
-- 20260828011811 (business-seats removal, step 6) dropped reject_pending_job:
-- it required a non-null jobs.business_id, 0 jobs have one, and nothing in
-- src/ or supabase/functions/ calls it. 20260828020000 (cancellation requires
-- an RPC), written in parallel, republished it so it could open the
-- cancellation gate. On prod the drop won — the function does not exist
-- (checked 2026-09-15) — but in the repo 20260828020000 sorts later, so a
-- fresh replay (db-smoke, a restore, PGlite probes) resurrects a dead
-- business-approval RPC that prod does not have.
--
-- Found by scripts/audit/function-body-drift.mjs ("missing
-- reject_pending_job(uuid,text)"). This drop is a no-op on prod.
--
-- REPLAY-SAFETY: IF EXISTS.

DROP FUNCTION IF EXISTS public.reject_pending_job(uuid, text);
