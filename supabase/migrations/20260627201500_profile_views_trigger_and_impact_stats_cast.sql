-- Fix-forward for the two issues #844 tried to solve, but as a NEW migration
-- so prod (which is running fine on the old shapes) gets brought into the new
-- shape explicitly, instead of rewriting historical files and creating drift.
--
-- 1) public.profile_views.hour_bucket — GENERATED ALWAYS AS column → trigger.
--    Prod accepts the generated column today, but a fresh-rebuild against
--    stricter Postgres rejects `date_trunc(text, timestamp)` in GENERATED ALWAYS
--    because date_trunc is STABLE, not IMMUTABLE. Converting prod to a
--    BEFORE INSERT trigger matches what fresh rebuilds will create.
--
-- 2) public.get_platform_impact_stats() — wrap AVG() in an explicit ::numeric
--    cast before ROUND(). The bare form relies on implicit casting which is
--    flagged by some Postgres lints; the explicit cast is portable.
--
-- All statements are replay-safe via IF (NOT) EXISTS / DROP EXPRESSION IF EXISTS
-- / DROP TRIGGER IF EXISTS / CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1) profile_views.hour_bucket → trigger-populated
-- ---------------------------------------------------------------------------

-- Drop the GENERATED ALWAYS expression if present. PG13.4+ keeps the existing
-- stored values; the column becomes a normal column afterwards. Idempotent.
ALTER TABLE public.profile_views
  ALTER COLUMN hour_bucket DROP EXPRESSION IF EXISTS;

-- Restore a sensible default so direct INSERTs (that somehow bypass the
-- trigger) still satisfy the NOT NULL constraint. Matches the new file shape.
ALTER TABLE public.profile_views
  ALTER COLUMN hour_bucket SET DEFAULT LOCALTIMESTAMP;

-- Trigger function: keep hour_bucket in lockstep with viewed_at, bucketed to
-- the hour. CREATE OR REPLACE is idempotent.
CREATE OR REPLACE FUNCTION public.set_profile_view_hour_bucket()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.hour_bucket := date_trunc('hour', NEW.viewed_at);
  RETURN NEW;
END;
$$;

-- DROP + CREATE keeps the trigger definition in sync if a previous attempt
-- left a slightly different body. Trigger names are unique per table.
DROP TRIGGER IF EXISTS profile_views_set_hour_bucket ON public.profile_views;
CREATE TRIGGER profile_views_set_hour_bucket
  BEFORE INSERT ON public.profile_views
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_view_hour_bucket();

-- Backfill: re-derive hour_bucket from viewed_at for any rows where the two
-- have drifted. On prod these are guaranteed in sync (the old GENERATED ALWAYS
-- enforced it), so this is a no-op there — but a fresh rebuild that ran the
-- intermediate states could end up with a mismatch, and this normalizes it.
UPDATE public.profile_views
SET    hour_bucket = date_trunc('hour', viewed_at)
WHERE  hour_bucket IS DISTINCT FROM date_trunc('hour', viewed_at);

-- ---------------------------------------------------------------------------
-- 2) get_platform_impact_stats — explicit ::numeric cast on the AVG
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_platform_impact_stats()
RETURNS TABLE(
  total_jobs_completed bigint,
  total_earnings_circulated numeric,
  total_helpers_active bigint,
  total_parishes_served bigint,
  total_posters bigint,
  avg_response_minutes numeric,
  jobs_this_month bigint,
  earnings_this_month numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COALESCE(SUM(budget) FILTER (WHERE status = 'completed'), 0),
    COUNT(DISTINCT helper_id) FILTER (WHERE helper_id IS NOT NULL AND status = 'completed'),
    COUNT(DISTINCT location) FILTER (WHERE status = 'completed' AND location IS NOT NULL),
    COUNT(DISTINCT customer_id),
    ROUND((AVG(
      EXTRACT(EPOCH FROM (
        SELECT MIN(ja.created_at) FROM applications ja WHERE ja.job_id = jobs.id
      ) - jobs.created_at) / 60
    ) FILTER (WHERE status != 'open'))::numeric, 0),
    COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', now())),
    COALESCE(SUM(budget) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', now())), 0)
  FROM jobs;
$$;
