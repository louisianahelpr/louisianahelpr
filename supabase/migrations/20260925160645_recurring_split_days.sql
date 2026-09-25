-- Recurring series: split days, per-date Helprs, pick-up, and leaving a series.
-- Owner decisions 2026-09-25 (docs/OPEN.md Q407 (4), (5), (6) and the pick-up
-- addendum). Builds on 20260925052841_recurring_series_end.
--
-- (4) At posting time the poster chooses 'one person for every visit' or 'OK to
--     split the days': jobs.series_split_ok (default false = one person). Locked
--     once a Helpr is hired on the series. Helprs see it before applying
--     (open_jobs_browse projects it, with the day set and week count).
--
-- (5) Every visit date after visit one has AT MOST ONE holder:
--     public.series_visit_holds (parent_job_id, visit_date) -> helper_id.
--       - one person: the Helpr hired on the series holds every future date
--         (seeded by trg_series_holds_on_hire when recurring_helper_id is set,
--         and backfilled below for series already running).
--       - split: the first hired Helpr gets an offer and picks the dates they
--         want (claim_series_dates); the poster then offers the remaining dates
--         to the next Helpr they choose (offer_series_dates, to someone who
--         applied), and so on. A date nobody holds stays offerable.
--     charge-recurring-visits funds a date ONLY when it is held, books the
--     HOLDER on it (helper_id, application, payout) and charges nothing for an
--     unheld date. trg_series_visit_within_end refuses a visit whose helper is
--     not the date's holder, so the charge and the payout cannot follow anyone
--     else, even across a race with a give-up.
--
-- (6) give_up_series_dates / end_recurring_series (Helpr side) hand dates back:
--     the hold is deleted and a release row (recurring_visit_releases, reused:
--     "this date was given up and nobody has it yet") is written. A reliability
--     strike (apply_job_denial_consequence, the existing ladder) applies ONLY
--     when a released date starts within 24 hours (is_late_cancellation), once
--     per call. The poster is told, and so is every other Helpr on the series.
--
-- Pick-up (owner addendum 2026-09-25): a released date is claimable by any
--     Helpr currently on the series (holds a future date, or is the first hired
--     Helpr), except the one who gave it up; first to claim wins (the parent is
--     locked FOR UPDATE, the hold is a primary key). The poster is told who took
--     it. Until someone does, the poster can still offer it to someone new.
--
-- recurring_visit_releases: its client INSERT/DELETE policies are dropped and
--     its client write grants revoked (it had policies and a cron reader but no
--     writer in the app). Only the definer functions below write it.
--
-- end_recurring_series (poster side unchanged) now tells every Helpr on the
--     series; on the Helpr side it no longer ends the poster's series: it hands
--     back that Helpr's future dates (owner decision 6).
--
-- DEPLOY ORDER: charge-recurring-visits reads series_visit_holds. If
--     functions-deploy lands before db-deploy, the holds read fails and the cron
--     funds nothing that run (fail closed, one page per series); the next run
--     after db-deploy is normal. The web app reads the new objects only through
--     calls that treat 42703/42P01/PGRST202/PGRST205 as "not deployed yet".

-- ── (4) the choice ─────────────────────────────────────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS series_split_ok boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.series_split_ok IS
  'Recurring series only: true = the poster is OK with different Helprs taking different visit dates; false = one Helpr for every visit. Chosen at posting time, locked once a Helpr is hired.';

-- ── The schedule, in SQL ───────────────────────────────────────────────────
-- Mirror of recurringVisitDates() (supabase/functions/_shared/recurringSchedule.ts
-- and src/lib/recurringSchedule.ts): calendar weeks from the Sunday that opens
-- the start date's week, capped at 52, dates before the start dropped.
-- Parity is proven in src/test/pglite/recurringSplitDays.pglite.mjs.
CREATE OR REPLACE FUNCTION public.series_visit_dates(p_start date, p_days smallint[], p_weeks integer)
RETURNS SETOF date
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT t.d
    FROM generate_series(0, LEAST(COALESCE(p_weeks, 0), 52) - 1) AS w
   CROSS JOIN (SELECT DISTINCT x::int AS dow FROM unnest(p_days) AS x WHERE x BETWEEN 0 AND 6) AS days
   CROSS JOIN LATERAL (
     SELECT (p_start - EXTRACT(DOW FROM p_start)::int + w * 7 + days.dow)::date AS d
   ) AS t
   WHERE p_start IS NOT NULL
     AND t.d >= p_start
   ORDER BY t.d
$fn$;

REVOKE ALL ON FUNCTION public.series_visit_dates(date, smallint[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_visit_dates(date, smallint[], integer) TO authenticated, service_role;

-- ── (5) who holds each date ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.series_visit_holds (
  parent_job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- One id per CLAIM: charge-recurring-visits keys its Stripe idempotency on
  -- it, so a date re-claimed within 24h of a refunded charge is a new charge,
  -- never a replay of the refunded one.
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_job_id, visit_date),
  CONSTRAINT series_visit_holds_id_key UNIQUE (id)
);

CREATE INDEX IF NOT EXISTS idx_series_visit_holds_helper
  ON public.series_visit_holds (helper_id, visit_date);

ALTER TABLE public.series_visit_holds ENABLE ROW LEVEL SECURITY;
-- Read-only to clients. Every write is a definer function below.
REVOKE ALL ON TABLE public.series_visit_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.series_visit_holds TO authenticated;
GRANT ALL ON TABLE public.series_visit_holds TO service_role;

CREATE TABLE IF NOT EXISTS public.series_date_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT series_date_offers_parent_helper_key UNIQUE (parent_job_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_series_date_offers_helper
  ON public.series_date_offers (helper_id);

ALTER TABLE public.series_date_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_date_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.series_date_offers TO authenticated;
GRANT ALL ON TABLE public.series_date_offers TO service_role;

-- Who is on a series: the poster, the first hired Helpr while still hired on
-- the parent, anyone holding a date from today on, and anyone with an offer.
-- SECURITY DEFINER so the policies below can ask it without recursing through
-- the RLS of the tables it reads.
CREATE OR REPLACE FUNCTION public.is_series_party(p_parent uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p_uid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.jobs j
             WHERE j.id = p_parent
               AND (j.customer_id = p_uid
                    OR (j.recurring_helper_id = p_uid AND j.helper_id = p_uid)))
    OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                WHERE h.parent_job_id = p_parent AND h.helper_id = p_uid
                  AND h.visit_date >= (now() AT TIME ZONE 'America/Chicago')::date)
    OR EXISTS (SELECT 1 FROM public.series_date_offers o
                WHERE o.parent_job_id = p_parent AND o.helper_id = p_uid)
  )
$fn$;

REVOKE ALL ON FUNCTION public.is_series_party(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_series_party(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Series parties read holds" ON public.series_visit_holds;
CREATE POLICY "Series parties read holds"
  ON public.series_visit_holds FOR SELECT TO authenticated
  USING (public.is_series_party(parent_job_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Poster and offeree read offers" ON public.series_date_offers;
CREATE POLICY "Poster and offeree read offers"
  ON public.series_date_offers FOR SELECT TO authenticated
  USING (
    helper_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = series_date_offers.parent_job_id
                  AND j.customer_id = (SELECT auth.uid()))
  );

-- ── recurring_visit_releases: server-written only ─────────────────────────
DO $releases$
BEGIN
  IF to_regclass('public.recurring_visit_releases') IS NULL THEN
    RAISE NOTICE 'recurring_visit_releases absent: skipped';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "Helper releases their own visit dates" ON public.recurring_visit_releases;
  DROP POLICY IF EXISTS "Helper un-releases a future date" ON public.recurring_visit_releases;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.recurring_visit_releases FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE public.recurring_visit_releases FROM anon;
  GRANT SELECT ON TABLE public.recurring_visit_releases TO authenticated;
  -- Every Helpr on the series sees a released date (they may pick it up).
  DROP POLICY IF EXISTS "Series participants read releases" ON public.recurring_visit_releases;
  CREATE POLICY "Series participants read releases"
    ON public.recurring_visit_releases FOR SELECT TO authenticated
    USING (
      helper_id = (SELECT auth.uid())
      OR public.is_series_party(parent_job_id, (SELECT auth.uid()))
    );
  COMMENT ON TABLE public.recurring_visit_releases IS
    'A series visit date a Helpr gave up that nobody has picked up yet (one row per date; deleted when someone claims it). Written only by definer functions (20260925160645).';
END
$releases$;

-- ── Internal: hand dates back ──────────────────────────────────────────────
-- Deletes p_helper's holds on p_dates (future dates with no visit created),
-- records each as released, tells the poster and every other Helpr on the
-- series. Returns the dates actually released. Called only by the definer
-- functions below (no client EXECUTE). app.series_end_rpc lets a banned
-- caller hand dates back (ban gate on recurring_visit_releases); it only
-- reduces activity.
-- p_title / p_customer come from the caller, which already read the series:
-- this function takes no lock on the parent, so the visit-cancel path (which
-- holds only the VISIT row) cannot deadlock against a claim (which holds the
-- parent, then the visit).
CREATE OR REPLACE FUNCTION public.series_release_dates(
  p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
RETURNS date[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_released date[];
  v_list text;
  v_flag text := current_setting('app.series_end_rpc', true);
BEGIN
  IF p_parent IS NULL OR p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN ARRAY[]::date[];
  END IF;

  PERFORM set_config('app.series_end_rpc', '1', true);

  -- A date with a booked visit is not released here (it is cancelled from its
  -- own card, helper_cancel_booking, which vacates the visit first). A
  -- VACATED visit (open, no Helpr, still funded) is released like an
  -- uncreated date: the next Helpr takes over that visit row.
  WITH gone AS (
    DELETE FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id = p_helper
       AND h.visit_date = ANY (p_dates)
       AND NOT EXISTS (SELECT 1 FROM public.jobs c
                        WHERE c.parent_job_id = p_parent AND c.date_needed = h.visit_date
                          AND NOT (c.status::text = 'open' AND c.helper_id IS NULL)
                        FOR SHARE)
    RETURNING h.visit_date
  )
  SELECT COALESCE(array_agg(visit_date ORDER BY visit_date), ARRAY[]::date[]) INTO v_released FROM gone;

  IF cardinality(v_released) > 0 THEN
    INSERT INTO public.recurring_visit_releases (parent_job_id, helper_id, visit_date, reason)
    SELECT p_parent, p_helper, d, p_reason FROM unnest(v_released) AS d
    ON CONFLICT (parent_job_id, visit_date)
      DO UPDATE SET helper_id = EXCLUDED.helper_id, reason = EXCLUDED.reason, created_at = now();

    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_released) AS d;

    IF p_customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        p_customer, p_parent,
        CASE WHEN cardinality(v_released) = 1 THEN 'A visit date is open again' ELSE 'Visit dates are open again' END,
        format('A Helpr gave up %s on "%s". Another Helpr on the series can pick %s up, or you can offer %s to someone new. A date nobody takes is not charged.',
               v_list, COALESCE(p_title, 'your series'),
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END),
        'job_updates', '/posts?job=' || p_parent::text);
    END IF;

    -- Every other Helpr on the series (holding a date from today on), not the
    -- one who gave it up.
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    SELECT DISTINCT h.helper_id, p_parent,
           'A date opened up — pick it up',
           format('%s on "%s" %s open. First to pick %s up gets %s.',
                  v_list, COALESCE(p_title, 'your series'),
                  CASE WHEN cardinality(v_released) = 1 THEN 'is' ELSE 'are' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END),
           'job_updates', '/jobs?job=' || p_parent::text
      FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id <> p_helper
       AND h.visit_date >= (now() AT TIME ZONE 'America/Chicago')::date;
  END IF;

  PERFORM set_config('app.series_end_rpc', COALESCE(v_flag, '0'), true);
  RETURN v_released;
END;
$fn$;

REVOKE ALL ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) TO service_role;

-- Internal: the strike for handing back a date that starts within 24 hours.
-- The same test a late single-job cancel uses (is_late_cancellation) and the
-- same ladder (apply_job_denial_consequence). One strike per call at most.
CREATE OR REPLACE FUNCTION public.series_give_up_strike(p_parent uuid, p_helper uuid, p_dates date[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job record;
  v_late date;
BEGIN
  -- Callers (give_up_series_dates, end_recurring_series) hold the parent FOR UPDATE.
  SELECT j.id, j.title, j.start_time INTO v_job FROM public.jobs j WHERE j.id = p_parent FOR SHARE;
  IF v_job.id IS NULL OR p_dates IS NULL THEN
    RETURN false;
  END IF;
  SELECT min(d) INTO v_late
    FROM unnest(p_dates) AS d
   WHERE public.is_late_cancellation(
           true,
           EXTRACT(EPOCH FROM (((d + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') - now())) / 3600.0);
  IF v_late IS NULL THEN
    RETURN false;
  END IF;
  PERFORM public.apply_job_denial_consequence(
    p_helper, p_parent,
    format('Gave up a recurring visit less than 24 hours before it: "%s" on %s',
           COALESCE(v_job.title, 'Unknown'), to_char(v_late, 'FMMon FMDD')));
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.series_give_up_strike(uuid, uuid, date[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.series_give_up_strike(uuid, uuid, date[]) TO service_role;

-- ── Seeding holds when the series gets its Helpr ─────────────────────────
-- AFTER trigger on the parent when recurring_helper_id changes
-- (stamp_recurring_series_helper sets it on hire and clears it when the hired
-- Helpr leaves the parent). NOT `UPDATE OF recurring_helper_id`: that fires
-- only when the column is in the statement's SET list, and the hire never sets
-- it there (the BEFORE trigger stamp_recurring_series_helper does), so the
-- trigger compares OLD and NEW instead.
CREATE OR REPLACE FUNCTION public.series_holds_on_hire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_future date[];
BEGIN
  IF NEW.parent_job_id IS NOT NULL OR NEW.recurrence_days IS NULL THEN
    RETURN NULL;
  END IF;

  -- The Helpr who was on the parent left it: their future dates go back.
  IF TG_OP = 'UPDATE' AND OLD.recurring_helper_id IS NOT NULL
     AND NEW.recurring_helper_id IS DISTINCT FROM OLD.recurring_helper_id THEN
    SELECT array_agg(h.visit_date) INTO v_future
      FROM public.series_visit_holds h
     WHERE h.parent_job_id = NEW.id AND h.helper_id = OLD.recurring_helper_id AND h.visit_date > v_today;
    PERFORM public.series_release_dates(NEW.id, OLD.recurring_helper_id, v_future, 'left_series', NEW.title, NEW.customer_id);
    DELETE FROM public.series_date_offers o
     WHERE o.parent_job_id = NEW.id AND o.helper_id = OLD.recurring_helper_id;
  END IF;

  IF NEW.recurring_helper_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.recurring_helper_id IS DISTINCT FROM OLD.recurring_helper_id)
     AND NEW.series_ended_on IS NULL
     AND NEW.status::text <> 'cancelled' THEN
    IF NEW.series_split_ok THEN
      -- Split: the first hired Helpr picks their dates.
      INSERT INTO public.series_date_offers (parent_job_id, helper_id)
      VALUES (NEW.id, NEW.recurring_helper_id)
      ON CONFLICT (parent_job_id, helper_id) DO NOTHING;
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (NEW.recurring_helper_id, NEW.id, 'Pick your visit dates',
              format('"%s" can be split between Helprs. Pick the visit dates you want from My Jobs.', COALESCE(NEW.title, 'This series')),
              'job_updates', '/jobs?job=' || NEW.id::text);
    ELSE
      -- One person: every future date nobody holds is theirs.
      WITH got AS (
        INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id)
        SELECT NEW.id, d, NEW.recurring_helper_id
          FROM public.series_visit_dates(NEW.date_needed, NEW.recurrence_days, NEW.recurrence_weeks) AS d
         WHERE d > NEW.date_needed AND d > v_today
           AND NOT EXISTS (SELECT 1 FROM public.jobs c WHERE c.parent_job_id = NEW.id AND c.date_needed = d FOR SHARE)
        ON CONFLICT (parent_job_id, visit_date) DO NOTHING
        RETURNING visit_date
      )
      DELETE FROM public.recurring_visit_releases r
       USING got
       WHERE r.parent_job_id = NEW.id AND r.visit_date = got.visit_date;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.series_holds_on_hire() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_series_holds_on_hire ON public.jobs;
CREATE TRIGGER trg_series_holds_on_hire
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (OLD.recurring_helper_id IS DISTINCT FROM NEW.recurring_helper_id)
  EXECUTE FUNCTION public.series_holds_on_hire();

DROP TRIGGER IF EXISTS trg_series_holds_on_hire_insert ON public.jobs;
CREATE TRIGGER trg_series_holds_on_hire_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (NEW.recurring_helper_id IS NOT NULL)
  EXECUTE FUNCTION public.series_holds_on_hire();

-- ── RPC: pick dates (the first Helpr, an offered Helpr, or a pick-up) ──────
CREATE OR REPLACE FUNCTION public.claim_series_dates(p_job_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_offered boolean;
  v_on_series boolean;
  v_d date;
  v_releaser uuid;
  v_child_id uuid;
  v_child_status text;
  v_child_helper uuid;
  v_child_start time;
  v_min_fundable date;
  v_claimed date[] := ARRAY[]::date[];
  v_taken date[] := ARRAY[]::date[];
  v_refused date[] := ARRAY[]::date[];
  v_name text;
  v_list text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- One claim at a time per series: first to commit wins every contested date.
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.recurring_helper_id, j.recurrence_days,
         j.recurrence_weeks, j.parent_job_id, j.date_needed, j.series_ended_on, j.status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;
  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'series_ended';
  END IF;
  IF v_uid = v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_offered := EXISTS (SELECT 1 FROM public.series_date_offers o
                        WHERE o.parent_job_id = v_job.id AND o.helper_id = v_uid)
               OR (v_job.recurring_helper_id = v_uid AND v_job.helper_id = v_uid);
  v_on_series := v_offered OR EXISTS (
    SELECT 1 FROM public.series_visit_holds h
     WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date >= v_today);
  IF NOT v_on_series THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.are_users_blocked(v_job.customer_id, v_uid) THEN
    RAISE EXCEPTION 'series_blocked';
  END IF;

  -- The earliest uncreated date a future charge-recurring-visits run can still
  -- fund (see the check in the loop).
  v_min_fundable := (now() AT TIME ZONE 'UTC')::date
                    + (CASE WHEN (now() AT TIME ZONE 'UTC')::time < '05:30'::time THEN 1 ELSE 2 END);

  FOREACH v_d IN ARRAY (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::date[]) FROM unnest(p_dates) AS x)
  LOOP
    IF v_d <= v_job.date_needed OR v_d <= v_today
       OR NOT EXISTS (SELECT 1 FROM public.series_visit_dates(v_job.date_needed, v_job.recurrence_days, v_job.recurrence_weeks) AS s
                       WHERE s = v_d) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    v_child_id := NULL;
    SELECT c.id, c.status::text, c.helper_id, c.start_time
      INTO v_child_id, v_child_status, v_child_helper, v_child_start
      FROM public.jobs c
     WHERE c.parent_job_id = v_job.id AND c.date_needed = v_d
     FOR UPDATE;
    IF v_child_id IS NOT NULL
       AND NOT (v_child_status = 'open' AND v_child_helper IS NULL
                AND ((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now()) THEN
      v_taken := v_taken || v_d;
      CONTINUE;
    END IF;
    -- An uncreated date must still be fundable: charge-recurring-visits runs
    -- daily at 06:06 UTC and funds dates strictly after its run date, so a
    -- date claimed after the last run that could fund it would be held and
    -- never booked (money audit 2026-09-25). 05:30 leaves the run its margin.
    IF v_child_id IS NULL
       AND v_d < v_min_fundable THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    v_releaser := NULL;
    SELECT r.helper_id INTO v_releaser
      FROM public.recurring_visit_releases r
     WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
    -- The one who gave a date up does not take it back; a Helpr on the series
    -- without an offer picks up only a date someone gave up.
    IF v_releaser = v_uid OR (NOT v_offered AND v_releaser IS NULL) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id)
    VALUES (v_job.id, v_d, v_uid)
    ON CONFLICT (parent_job_id, visit_date) DO NOTHING;
    IF FOUND THEN
      v_claimed := v_claimed || v_d;
      DELETE FROM public.recurring_visit_releases r
       WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
      -- A vacated visit is already funded: the claimer takes over that row
      -- (its escrow and payout follow helper_id), never a public reopening.
      IF v_child_id IS NOT NULL THEN
        UPDATE public.jobs
           SET helper_id = v_uid,
               status = 'accepted',
               helper_confirmed_at = now()
         WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;
        INSERT INTO public.applications (job_id, helper_id, status, message)
        VALUES (v_child_id, v_uid, 'accepted', NULL)
        ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted';
      END IF;
    ELSE
      v_taken := v_taken || v_d;
    END IF;
  END LOOP;

  IF cardinality(v_claimed) > 0 AND v_job.customer_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.full_name), '') INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_claimed) AS d;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (v_job.customer_id, v_job.id,
            CASE WHEN cardinality(v_claimed) = 1 THEN 'A visit date was picked up' ELSE 'Visit dates were picked up' END,
            format('%s took %s on "%s".', COALESCE(v_name, 'A Helpr'), v_list, COALESCE(v_job.title, 'your series')),
            'job_updates', '/posts?job=' || v_job.id::text);
  END IF;

  RETURN jsonb_build_object('claimed', to_jsonb(v_claimed), 'taken', to_jsonb(v_taken), 'refused', to_jsonb(v_refused));
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_series_dates(uuid, date[]) TO authenticated, service_role;

-- ── RPC: the poster offers the open dates to someone who applied ──────────
CREATE OR REPLACE FUNCTION public.offer_series_dates(p_job_id uuid, p_helper_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_open int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.recurrence_days, j.recurrence_weeks, j.parent_job_id,
         j.date_needed, j.series_ended_on, j.status, j.recurring_helper_id
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;
  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'series_ended';
  END IF;
  IF p_helper_id IS NULL OR p_helper_id = v_uid THEN
    RAISE EXCEPTION 'not_an_applicant';
  END IF;
  -- Someone who asked for this series and is still waiting on it.
  IF NOT EXISTS (SELECT 1 FROM public.applications a
                  WHERE a.job_id = v_job.id AND a.helper_id = p_helper_id AND a.status = 'pending') THEN
    RAISE EXCEPTION 'not_an_applicant';
  END IF;
  IF public.are_users_blocked(v_uid, p_helper_id) THEN
    RAISE EXCEPTION 'series_blocked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.user_id = p_helper_id
                AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'helper_unavailable';
  END IF;

  SELECT count(*) INTO v_open
    FROM public.series_visit_dates(v_job.date_needed, v_job.recurrence_days, v_job.recurrence_weeks) AS d
   WHERE d > v_job.date_needed AND d > v_today
     AND NOT EXISTS (SELECT 1 FROM public.series_visit_holds h WHERE h.parent_job_id = v_job.id AND h.visit_date = d)
     AND NOT EXISTS (SELECT 1 FROM public.jobs c WHERE c.parent_job_id = v_job.id AND c.date_needed = d
                       AND NOT (c.status::text = 'open' AND c.helper_id IS NULL)
                     FOR SHARE);
  IF v_open = 0 THEN
    RAISE EXCEPTION 'nothing_to_offer';
  END IF;

  INSERT INTO public.series_date_offers (parent_job_id, helper_id)
  VALUES (v_job.id, p_helper_id)
  ON CONFLICT (parent_job_id, helper_id) DO UPDATE SET offered_at = now();

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (p_helper_id, v_job.id, 'Visit dates offered to you',
          format('The person who posted "%s" offered you %s open visit date%s. Pick the ones you want from My Jobs.',
                 COALESCE(v_job.title, 'a recurring job'), v_open, CASE WHEN v_open = 1 THEN '' ELSE 's' END),
          'job_updates', '/jobs?job=' || v_job.id::text);

  RETURN jsonb_build_object('offered_to', p_helper_id, 'open_dates', v_open);
END;
$fn$;

REVOKE ALL ON FUNCTION public.offer_series_dates(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_series_dates(uuid, uuid) TO authenticated, service_role;

-- ── RPC: a Helpr gives up some of their dates ─────────────────────────────
CREATE OR REPLACE FUNCTION public.give_up_series_dates(p_job_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_mine date[];
  v_released date[];
  v_strike boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT j.id, j.parent_job_id, j.recurrence_days, j.title, j.customer_id INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;

  -- Only the caller's own future dates that have no visit yet. A booked visit
  -- is cancelled from its own card (helper_cancel_booking).
  SELECT COALESCE(array_agg(h.visit_date ORDER BY h.visit_date), ARRAY[]::date[]) INTO v_mine
    FROM public.series_visit_holds h
   WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid
     AND h.visit_date = ANY (p_dates) AND h.visit_date > v_today
     AND NOT EXISTS (SELECT 1 FROM public.jobs c WHERE c.parent_job_id = v_job.id AND c.date_needed = h.visit_date FOR SHARE);
  IF cardinality(v_mine) = 0 THEN
    RAISE EXCEPTION 'not_your_dates';
  END IF;

  v_released := public.series_release_dates(v_job.id, v_uid, v_mine, 'given_up', v_job.title, v_job.customer_id);
  IF cardinality(v_released) > 0 THEN
    v_strike := public.series_give_up_strike(v_job.id, v_uid, v_released);
  END IF;
  RETURN jsonb_build_object('released', to_jsonb(v_released), 'strike', v_strike);
END;
$fn$;

REVOKE ALL ON FUNCTION public.give_up_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.give_up_series_dates(uuid, date[]) TO authenticated, service_role;

-- ── end_recurring_series: the poster ends it; a Helpr leaves it ───────────
-- Restated from 20260925052841. Poster side: unchanged, except that every Helpr
-- on the series is told (holders from today on, and the standing Helpr while
-- still hired on the parent). Helpr side (owner decision 6): hands back that
-- Helpr's future dates instead of ending the poster's series, with the 24-hour
-- strike rule.
CREATE OR REPLACE FUNCTION public.end_recurring_series(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_last_created date;
  v_end date;
  v_booked int;
  v_child record;
  v_mine date[];
  v_released date[];
  v_strike boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.recurring_helper_id, j.helper_id, j.recurrence_days,
         j.parent_job_id, j.date_needed, j.series_ended_on, j.status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;

  -- ── A Helpr leaves: their future dates go back (owner decision 6) ──────
  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
    SELECT COALESCE(array_agg(h.visit_date ORDER BY h.visit_date), ARRAY[]::date[]) INTO v_mine
      FROM public.series_visit_holds h
     WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date > v_today;
    -- A party: holds a future date, or is the standing Helpr still hired on
    -- the parent. A recurring_helper_id left behind after helper_id moved on,
    -- with no dates, is not.
    IF cardinality(v_mine) = 0
       AND (v_uid IS DISTINCT FROM v_job.recurring_helper_id OR v_uid IS DISTINCT FROM v_job.helper_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    v_released := public.series_release_dates(v_job.id, v_uid, v_mine, 'left_series', v_job.title, v_job.customer_id);
    IF cardinality(v_released) > 0 THEN
      v_strike := public.series_give_up_strike(v_job.id, v_uid, v_released);
    END IF;
    DELETE FROM public.series_date_offers o WHERE o.parent_job_id = v_job.id AND o.helper_id = v_uid;
    RETURN jsonb_build_object(
      'action', 'left',
      'released', to_jsonb(v_released),
      'strike', v_strike,
      -- Booked visits (created, funded) stay theirs; each is cancelled from its own card.
      'booked_visits_remaining', (SELECT count(*) FROM (
                                     SELECT 1 FROM public.jobs c
                                      WHERE c.parent_job_id = v_job.id AND c.helper_id = v_uid
                                        AND c.status IN ('accepted', 'in_progress') AND c.date_needed >= v_today
                                        FOR SHARE) AS booked)
    );
  END IF;

  -- ── The poster ends the series ─────────────────────────────────────────
  -- Visits already created are funded and booked; they stay, each with its own
  -- cancel path. FOR SHARE: a visit cancelled or created mid-call cannot move
  -- the count or the end date under us. Lock order is parent (above) then
  -- visits. The visit insert path takes the parent first too
  -- (trg_series_visit_within_end, and the parent_job_id foreign key), and the
  -- cancel RPCs lock only the visit they cancel.
  v_booked := 0;
  FOR v_child IN
    SELECT c.date_needed, c.status
      FROM public.jobs c
     WHERE c.parent_job_id = v_job.id
       FOR SHARE
  LOOP
    IF v_child.status IN ('accepted', 'in_progress') AND v_child.date_needed >= v_today THEN
      v_booked := v_booked + 1;
    END IF;
    IF v_child.status <> 'cancelled' THEN
      v_last_created := GREATEST(v_last_created, v_child.date_needed);
    END IF;
  END LOOP;

  IF v_job.status = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'already_ended',
      'ended_on', COALESCE(v_job.series_ended_on, v_job.date_needed),
      'booked_visits_remaining', v_booked
    );
  END IF;

  -- GREATEST ignores NULLs, so a series with no created visit ends on the
  -- later of visit one and today.
  v_end := GREATEST(v_job.date_needed, v_today, v_last_created);

  PERFORM set_config('app.series_end_rpc', '1', true);
  UPDATE public.jobs SET series_ended_on = v_end WHERE id = v_job.id;
  PERFORM set_config('app.series_end_rpc', '0', true);

  -- Every Helpr on the series: anyone holding a date from today on, and the
  -- standing Helpr while still the one hired on the parent (a stale
  -- recurring_helper_id is not told, review 2026-09-25).
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  SELECT u.helper_id, v_job.id,
         'Recurring series ended',
         format('The person who posted it ended the recurring series "%s". No new visits will be booked or charged.%s',
                COALESCE(v_job.title, 'A job'),
                CASE WHEN v_booked > 0
                     THEN format(' %s visit%s already booked still go%s ahead unless cancelled.',
                                 v_booked, CASE WHEN v_booked = 1 THEN '' ELSE 's' END,
                                 CASE WHEN v_booked = 1 THEN 'es' ELSE '' END)
                     ELSE '' END),
         'job_updates',
         '/jobs?job=' || v_job.id::text
    FROM (
      SELECT h.helper_id FROM public.series_visit_holds h
       WHERE h.parent_job_id = v_job.id AND h.visit_date >= v_today
      UNION
      SELECT v_job.recurring_helper_id WHERE v_job.recurring_helper_id = v_job.helper_id
    ) AS u
   WHERE u.helper_id IS NOT NULL;

  RETURN jsonb_build_object(
    'action', 'ended',
    'ended_on', v_end,
    'booked_visits_remaining', v_booked
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.end_recurring_series(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_recurring_series(uuid) TO authenticated, service_role;

-- ── A visit is created only for the Helpr who holds its date ──────────────
-- Restated from 20260925052841 (no new visit once ended) plus the holder rule.
-- FOR SHARE on the parent, then on the hold: a give-up (parent FOR UPDATE,
-- then DELETE of the hold) either finishes first, and this insert is refused
-- (the cron refunds), or waits for it.
CREATE OR REPLACE FUNCTION public.enforce_series_visit_within_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ended date;
  v_holder uuid;
BEGIN
  IF NEW.parent_job_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT j.series_ended_on INTO v_ended
    FROM public.jobs j
   WHERE j.id = NEW.parent_job_id
   FOR SHARE;
  IF v_ended IS NOT NULL THEN
    RAISE EXCEPTION 'series_ended: the series ended on %; no new visit (%)', v_ended, NEW.date_needed
      USING ERRCODE = '23514';
  END IF;
  SELECT h.helper_id INTO v_holder
    FROM public.series_visit_holds h
   WHERE h.parent_job_id = NEW.parent_job_id AND h.visit_date = NEW.date_needed
   FOR SHARE;
  IF v_holder IS NULL OR v_holder IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'series_date_unheld: % on % is not held by this Helpr', NEW.parent_job_id, NEW.date_needed
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_visit_within_end() FROM PUBLIC, anon, authenticated;

-- ── A Helpr cancelling a booked series visit ───────────────────────────────
-- Restated from 20260924220318 (newest) with two changes for series visits
-- (visit one included):
--   - the reliability strike applies ONLY within 24 hours of the visit
--     (owner decision 6; a one-off job keeps its unconditional strike, which
--     the owner is being asked about separately);
--   - the vacated visit goes back to the SERIES, not to the public: the hold
--     is released (series_release_dates tells the poster and the other Helprs
--     on the series, who can pick it up; the poster can offer it), and the
--     visit row (still funded) waits for the next holder. open_jobs_browse
--     does not list a series visit (below).
CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
  v_series_visit boolean;
BEGIN
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at,
         j.parent_job_id, j.recurrence_days
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- ADDED 2026-09-14: reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the poster or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the poster or support.';
  END IF;

  v_series_visit := v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL;

  IF NOT v_series_visit
     OR public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN
    v_result := public.apply_job_denial_consequence(
      auth.uid(), v_job.id,
      'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
  ELSE
    -- A series visit more than 24 hours out: no strike (owner decision 6).
    v_result := jsonb_build_object('action', 'none', 'reason', 'series_visit_more_than_24h');
  END IF;

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;

  IF v_job.parent_job_id IS NOT NULL THEN
    -- The date goes back to the series: the poster and the other Helprs on it
    -- are told by series_release_dates.
    PERFORM public.series_release_dates(v_job.parent_job_id, auth.uid(), ARRAY[v_job.date_needed], 'visit_cancelled',
                                        v_job.title, v_job.customer_id);
  ELSE
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Your Helpr cancelled',
      'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
      'warning',
      '/posts?job=' || v_job.id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;

-- ── Client lock: + the split choice once a Helpr is hired ─────────────────
-- Restated from 20260925160644 (newest) with series_split_ok added.
CREATE OR REPLACE FUNCTION public.enforce_series_columns_client_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.series_ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id THEN
    RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days AND OLD.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Cancel the series and post a new one with the new days.';
  END IF;
  IF NEW.series_ended_on IS DISTINCT FROM OLD.series_ended_on THEN
    RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- HIGH-2 (money audit 2026-09-25): a committed or cancelled job's date and
  -- start time price its cancellation fee and its refund. Once a Helpr or a
  -- crew is on it, it is a recurring visit, or it is cancelled, they change
  -- only through an accepted change request (a definer RPC).
  IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.start_time IS DISTINCT FROM OLD.start_time)
     AND (OLD.helper_id IS NOT NULL
          OR OLD.parent_job_id IS NOT NULL
          OR OLD.status::text = 'cancelled'
          OR public.job_has_crew(OLD.id)) THEN
    RAISE EXCEPTION 'schedule_locked: the date and start time of a booked or cancelled job cannot be edited (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Ask for a new date or time; it changes when the other person accepts.';
  END IF;
  -- One person / split: the terms Helprs applied under. Fixed once anyone is
  -- hired on the series.
  IF NEW.series_split_ok IS DISTINCT FROM OLD.series_split_ok
     AND (OLD.helper_id IS NOT NULL OR OLD.recurring_helper_id IS NOT NULL) THEN
    RAISE EXCEPTION 'series_locked: one-person or split days cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- A hired series parent: every column the visit dates are computed from is
  -- the schedule the Helpr agreed to.
  IF OLD.recurrence_days IS NOT NULL AND OLD.parent_job_id IS NULL AND OLD.helper_id IS NOT NULL
     AND (NEW.recurrence_weeks IS DISTINCT FROM OLD.recurrence_weeks
          OR NEW.date_needed IS DISTINCT FROM OLD.date_needed
          OR NEW.start_time IS DISTINCT FROM OLD.start_time
          OR NEW.recurrence_end_date IS DISTINCT FROM OLD.recurrence_end_date) THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'End the series and post a new one with the new schedule.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_columns_client_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_series_columns_client_lock ON public.jobs;
CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on, series_split_ok ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();

-- ── Backfill: a series already running is one-person ──────────────────────
-- Its standing Helpr (still the one hired on the parent) holds every future
-- date that has no visit and was not released. Replay-safe (ON CONFLICT).
INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id)
SELECT j.id, d, j.recurring_helper_id
  FROM public.jobs j
 CROSS JOIN LATERAL public.series_visit_dates(j.date_needed, j.recurrence_days, j.recurrence_weeks) AS d
 WHERE j.parent_job_id IS NULL
   AND j.recurrence_days IS NOT NULL
   AND j.recurring_helper_id IS NOT NULL
   AND j.recurring_helper_id = j.helper_id
   AND j.customer_id IS NOT NULL
   AND j.series_ended_on IS NULL
   AND j.status::text <> 'cancelled'
   AND d > j.date_needed
   AND d > (now() AT TIME ZONE 'America/Chicago')::date
   AND NOT EXISTS (SELECT 1 FROM public.jobs c WHERE c.parent_job_id = j.id AND c.date_needed = d)
   AND NOT EXISTS (SELECT 1 FROM public.recurring_visit_releases r WHERE r.parent_job_id = j.id AND r.visit_date = d)
ON CONFLICT (parent_job_id, visit_date) DO NOTHING;

-- ── Helprs see the terms before applying ──────────────────────────────────
-- open_jobs_browse restated verbatim from its newest definition
-- (20260915045110) with three columns APPENDED (CREATE OR REPLACE VIEW may only
-- add columns at the end): recurrence_days, recurrence_weeks, series_split_ok;
-- and one filter: `parent_job_id IS NULL`. A series visit is only ever open
-- when its Helpr cancelled it, and it goes back to the series, never to the
-- public (money audit MEDIUM-9, owner decision 5). get_open_jobs_for_map,
-- get_ranked_open_jobs and get_public_open_jobs read jobs directly and still
-- list it: docs/OPEN.md queues that.
-- Stays security_invoker = false (Q182, 20260923205337); grants are kept by
-- CREATE OR REPLACE.
DO $view$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;
  EXECUTE $v$
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok
   FROM jobs
  WHERE status = 'open'::job_status AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier)
$v$;
END
$view$;

-- Browse is read-only to clients (20260923205337). CREATE OR REPLACE keeps the
-- grants; restated so a replay from scratch ends in the same place.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- Every jobs ADD COLUMN ends with the grant sync (offeredHelperPrivacy.test.ts).
SELECT public.sync_jobs_select_grants();
