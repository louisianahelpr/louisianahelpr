-- Recurring series: N weeks FROM THE START DATE, picked weekdays only
-- (owner, 2026-10-01).
--
-- The bug: series_visit_dates (20260927012806) counted CALENDAR weeks from the
-- Sunday that opens the start's week and dropped the picked days before the
-- start. Fri 2026-10-02, Mon+Thu, 2 weeks gave Oct 5 and Oct 8 only, while the
-- first job itself was saved and charged on the unpicked Friday. The poster saw
-- 2 visits and paid for 3.
--
-- The rule now, identical in src/lib/recurringSchedule.ts and
-- supabase/functions/_shared/recurringSchedule.ts: every date in
-- [p_start, p_start + 7 * weeks) whose weekday is picked, weeks capped at 52.
-- That is always weeks x |days| visits. The client saves the job on the FIRST
-- visit (jobSubmitHelpers.ts), and re-anchoring the window on the first visit
-- returns the same set, so every caller (series_holds_on_hire, claim/offer/
-- give-up, the visit-insert gate) agrees with what the poster was quoted.
--
-- Only this function changes; its callers all go through it. Same signature,
-- so CREATE OR REPLACE is replay-safe; grants restated (revoke by role name).
-- Parity: src/test/pglite/recurringSeriesWeeksFromStart.pglite.mjs.
CREATE OR REPLACE FUNCTION public.series_visit_dates(p_start date, p_days smallint[], p_weeks integer)
RETURNS SETOF date
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT (p_start + i)::date AS d
    FROM generate_series(0, LEAST(GREATEST(COALESCE(p_weeks, 0), 0), 52) * 7 - 1) AS i
   WHERE p_start IS NOT NULL
     AND EXTRACT(DOW FROM p_start + i)::int IN (
       SELECT x::int FROM unnest(p_days) AS x WHERE x BETWEEN 0 AND 6
     )
   ORDER BY 1
$fn$;

REVOKE ALL ON FUNCTION public.series_visit_dates(date, smallint[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_visit_dates(date, smallint[], integer) TO authenticated, service_role;
