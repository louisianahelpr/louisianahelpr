-- Recurring, rebuilt: a day-of-week series that charges per visit.
--
-- WHAT THE OLD MODEL COULD NOT EXPRESS, AND COULD NOT PAY FOR
--
-- `recurrence_interval` held ONE of daily/weekly/biweekly/monthly, so
-- "Mon, Wed and Fri for three weeks" was not expressible at all — the closest a
-- poster could get was Daily, which also books them Saturday and Sunday. And
-- the money half did not exist: the poster funded escrow once at checkout and
-- `spawn-recurring-jobs` posted every later visit with `payment_status` at its
-- 'pending' default, so a helper could work a visit with no escrow behind it.
-- The feature was withdrawn in the previous commit; this is the schema for the
-- version that replaces it.
--
-- THE MODEL
--
--   recurrence_days   — which weekdays, 0=Sunday … 6=Saturday. A SET, so
--                       Mon/Wed/Fri is one series, not three jobs.
--   recurrence_weeks  — how many weeks it runs. Bounded (1..52) because an
--                       unbounded series is an unbounded charge authority.
--   recurring_helper_id
--                     — the STANDING helper. They accept once and hold every
--                       visit; this is what makes "every Wednesday" mean the
--                       same person rather than a fresh scramble each week.
--
-- The parent job carries the definition and is also the FIRST visit (paid for
-- at checkout, like any job). Later visits become child jobs only when they are
-- funded — never before — so an unfunded visit cannot exist to be applied to.
--
-- `budget` on the parent is PER VISIT, not for the run. That is the number the
-- helper is quoted for the work they actually do on a given day, and it is what
-- each per-visit charge is computed from.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS recurrence_days smallint[],
  ADD COLUMN IF NOT EXISTS recurrence_weeks smallint,
  ADD COLUMN IF NOT EXISTS recurring_helper_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.jobs.recurrence_days IS
  'Weekdays this series runs, 0=Sunday..6=Saturday. NULL for a one-time job.';
COMMENT ON COLUMN public.jobs.recurrence_weeks IS
  'How many weeks the series runs from date_needed. NULL for a one-time job.';
COMMENT ON COLUMN public.jobs.recurring_helper_id IS
  'The standing helper who holds every visit in this series. Set when they accept; cleared if they leave the whole run.';

-- Bounds, not suggestions: `recurrence_weeks` is how long the poster's saved
-- card can be charged without them touching the app again, so an out-of-range
-- value is a money problem, not a display problem. Guarded + NOT VALID so the
-- migration cannot fail on a legacy row (there are none — prod has zero
-- recurring jobs — but a from-scratch replay must not depend on that).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_recurrence_weeks_range'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_recurrence_weeks_range
      CHECK (recurrence_weeks IS NULL OR (recurrence_weeks >= 1 AND recurrence_weeks <= 52))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_recurrence_days_valid'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_recurrence_days_valid
      CHECK (
        recurrence_days IS NULL
        OR (
          array_length(recurrence_days, 1) BETWEEN 1 AND 7
          AND recurrence_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
        )
      )
      NOT VALID;
  END IF;
END $$;

-- ── Released dates ──────────────────────────────────────────────────────────
--
-- The standing helper holds every visit BY DEFAULT. Releasing is the exception
-- path: one date they cannot make, given up without giving up the series.
--
-- This is deliberately NOT a `job_denial` violation. That ladder (warning at 3,
-- permanent ban at 5) is for backing out of a job you applied for and were
-- picked for. Telling a poster three weeks ahead that you cannot make one
-- Wednesday is the opposite behaviour — it is what you WANT a reliable helper
-- to do — and penalising it would push helpers to no-show instead. Abandoning
-- the whole run is a different act and still counts.
--
-- A released date is SKIPPED: no visit, and the poster is not charged for one.
-- The poster is notified and can post that date as a one-off if they want
-- cover. We do not silently hand the date to a stranger, and we never charge
-- for a visit nobody is committed to.
CREATE TABLE IF NOT EXISTS public.recurring_visit_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One release per date per series. A double-tap is the same release, not two.
  UNIQUE (parent_job_id, visit_date)
);

ALTER TABLE public.recurring_visit_releases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_recurring_releases_parent
  ON public.recurring_visit_releases (parent_job_id, visit_date);

-- The standing helper releases their own dates; the poster reads them (their
-- schedule has a hole in it and they need to see it). Nobody else sees either.
DROP POLICY IF EXISTS "Helper releases their own visit dates" ON public.recurring_visit_releases;
CREATE POLICY "Helper releases their own visit dates"
  ON public.recurring_visit_releases
  FOR INSERT TO authenticated
  WITH CHECK (
    helper_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = parent_job_id AND j.recurring_helper_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Series participants read releases" ON public.recurring_visit_releases;
CREATE POLICY "Series participants read releases"
  ON public.recurring_visit_releases
  FOR SELECT TO authenticated
  USING (
    helper_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = parent_job_id AND j.customer_id = auth.uid()
    )
  );

-- Un-releasing is allowed while the date is still in the future: a helper whose
-- plans changed back should be able to take their own date again rather than
-- watch it get skipped. Past dates are history and stay put.
DROP POLICY IF EXISTS "Helper un-releases a future date" ON public.recurring_visit_releases;
CREATE POLICY "Helper un-releases a future date"
  ON public.recurring_visit_releases
  FOR DELETE TO authenticated
  USING (helper_id = auth.uid() AND visit_date > CURRENT_DATE);
