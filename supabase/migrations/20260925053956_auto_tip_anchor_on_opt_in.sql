-- Auto-tip candidates are anchored on WHEN THE JOB COMPLETED and WHEN THE
-- POSTER TURNED AUTO-TIP ON (CJ-008).
--
-- MEASURED (prod, 2026-09-25): auto_tip_candidates() selected completed jobs
-- by `j.updated_at > now() - 24h` while reading the poster's auto_tip_mode as
-- it is NOW. Two money defects follow from that one predicate:
--   1. An outage longer than 24h loses every auto-tip in the gap for good:
--      a job completed outside the last 24h is never a candidate again.
--   2. updated_at is not the completion time. 18 of 52 completed jobs had
--      updated_at more than a day after completed_at, so any later write to an
--      old job (a review, a dispute marker) made it a candidate again, and a
--      poster who turned auto-tip on today could be charged a tip on a job
--      finished months before they opted in.
--
-- Now:
--   profiles.auto_tip_enabled_at  set by trigger when auto_tip_mode goes from
--                                 'off' to on, kept while it stays on, cleared
--                                 when it goes off. The trigger owns it: a
--                                 client write to the column is overwritten.
--   auto_tip_candidates()         completed_at >= auto_tip_enabled_at (no tip
--                                 for a job finished before the opt-in) and
--                                 completed_at inside a 14-day lookback, so a
--                                 missed hourly run drains on the next one.
--                                 The NOT EXISTS on tips(source='auto') stays
--                                 the dedupe, so widening cannot double-charge.
--   _since_hours defaults to 336 (14 days). auto-tip-charge calls it with no
--   argument, so whichever of this migration and that function deploys first,
--   the result is either the old 24h behaviour or the new anchored one.
--
-- Backfill: posters already on get auto_tip_enabled_at = now() - 24h, which
-- keeps exactly the reach they had at migration time (jobs completed in the
-- last 24h) and nothing older.
--
-- Guard: src/test/autoTipAnchoredOnOptIn.test.ts.
-- PGlite: src/test/pglite/autoTipAnchoredOnOptIn.pglite.mjs.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, backfill only NULLs of opted-in rows
-- and before the trigger exists (DROP TRIGGER IF EXISTS first), CREATE OR
-- REPLACE for both functions.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_tip_enabled_at timestamptz;

CREATE OR REPLACE FUNCTION public.profiles_stamp_auto_tip_enabled_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.auto_tip_mode = 'off' THEN
    NEW.auto_tip_enabled_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.auto_tip_mode = 'off' THEN
    NEW.auto_tip_enabled_at := now();
  ELSE
    NEW.auto_tip_enabled_at := OLD.auto_tip_enabled_at;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.profiles_stamp_auto_tip_enabled_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_stamp_auto_tip_enabled_at ON public.profiles;

UPDATE public.profiles
   SET auto_tip_enabled_at = now() - interval '24 hours'
 WHERE auto_tip_mode <> 'off'
   AND auto_tip_enabled_at IS NULL;

CREATE TRIGGER profiles_stamp_auto_tip_enabled_at
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_stamp_auto_tip_enabled_at();

CREATE OR REPLACE FUNCTION public.auto_tip_candidates(_since_hours integer DEFAULT 336)
RETURNS TABLE (
  job_id uuid,
  customer_id uuid,
  helper_id uuid,
  budget numeric,
  tip_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.customer_id, j.helper_id, j.budget,
         public.resolve_auto_tip(j.customer_id, j.budget)
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.customer_id
  WHERE j.status = 'completed'::job_status
    AND j.helper_id IS NOT NULL
    AND p.auto_tip_mode <> 'off'
    AND p.auto_tip_enabled_at IS NOT NULL
    AND j.completed_at >= p.auto_tip_enabled_at
    AND j.completed_at > now() - make_interval(hours => _since_hours)
    AND public.resolve_auto_tip(j.customer_id, j.budget) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.tips t
      WHERE t.job_id = j.id AND t.source = 'auto'
    );
$$;

REVOKE ALL ON FUNCTION public.auto_tip_candidates(integer) FROM PUBLIC, anon, authenticated;
