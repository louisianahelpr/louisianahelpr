-- Q1586(c): A MEMBER UNDER 18 CANNOT APPLY FOR OR POST A JOB (owner, 2026-10-12:
-- "Grey out the button until the age is 18 or over").
--
-- Before this, a birthday under 18 was only a warning log: the app refused to
-- SAVE one in Finish your profile / Complete Profile, but nothing on the server
-- read profiles.date_of_birth at all, so a saved under-18 birthday (written by
-- a direct API call, or by an admin) applied and posted like any other account.
-- The app now greys out Apply and Post a Job for that member (useAgeGate); this
-- is the server half, so a direct API call cannot get around the grey-out.
--
--   member_under_18(user)   true when the member's saved birthday makes them
--                           under 18 TODAY in Louisiana (America/Chicago). They
--                           are 18 from the first minute of their 18th birthday
--                           there (a 29 February birthday turns 18 on 28
--                           February, which is what date + interval '18 years'
--                           gives). No birthday saved: false, so today's flow
--                           (birthday asked before the first Apply/Post) stays.
--                           Internal: REVOKEd from PUBLIC, anon, authenticated
--                           (it would tell any caller another member's age).
--   apply_to_job            refuses 'under_18' first, before the rate ladder.
--   applications INSERT     refused for an under-18 applicant from ANY path:
--                           apply_to_job, claim_series_dates (picking up series
--                           dates), complete_direct_offer_accept (accepting a
--                           direct offer, including the deferred completion in
--                           complete_pending_accepts_on_setup, which catches a
--                           per-job error, so a refusal there never rolls back
--                           the Stripe status write it runs inside).
--   job_accept_pending INSERT  refused for an under-18 Helpr: the "yes" to an
--                           offer remembered until payout setup is done.
--   series_visit_holds INSERT  refused: claim_series_dates holds a date with
--                           no visit yet WITHOUT an applications row, and the
--                           poster can offer dates to a past Helpr with no
--                           application at all (lh-authz-rls review of
--                           30e7034c4, must-fix 2).
--   group_job_helpers INSERT, and UPDATE OF helper_confirmed_at (the first
--                           confirm)   refused: a crew seat (re-review
--                           should-fix 1).
--   jobs UPDATE OF helper_id, helper_confirmed_at  refused when the Helpr
--                           being booked, or confirming a booking, is under 18
--                           (accept_application / accept_job_offer on an
--                           application that predates the birthday: review
--                           should-fix 3).
--   The member themself is told 'under_18'; anyone else (the poster hiring, a
--   server completing a remembered accept) gets 'helper_unavailable', never
--   the Helpr's age.
--   jobs INSERT             refused when the member posts their OWN job
--                           (auth.uid() = customer_id), which is every app and
--                           API post. A server writer with no member session
--                           (charge-recurring-visits adding the next visit of
--                           a series that already exists) is not a new post.
--   profiles UPDATE         a member whose saved birthday makes them under 18
--                           cannot rewrite or clear it themselves (that would
--                           undo the gate with one PATCH); an admin or a server
--                           path still can (complete-signup, which writes with
--                           the service role, refuses the same rewrite in
--                           its own code). A birthday that is 18+ is not
--                           touched by this (owner has not decided birthday
--                           edits in general).
--
-- Error code 'under_18' (42501); the app maps it to "You must be 18 or older
-- to apply for jobs." / "... to post a job." (src/lib/ageGate.ts).
--
-- Measured on prod 2026-10-12 (read-only): 75 profiles have a birthday, 0 of
-- them under 18, so nothing live is refused by this today.
--
-- apply_to_job is restated from 20261006023437_crew_free_spot_relisted.sql,
-- whose body is byte-identical to prod's (md5 e8fc9c7b… on 2026-10-12), with
-- only the under_18 check added. Replay-safe: every object is CREATE OR
-- REPLACE / DROP TRIGGER IF EXISTS, and each trigger is attached only when its
-- table exists.

CREATE OR REPLACE FUNCTION public.member_under_18(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(
    (SELECT (p.date_of_birth + interval '18 years') > (now() AT TIME ZONE 'America/Chicago')::date
       FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND p.date_of_birth IS NOT NULL
      LIMIT 1),
    false)
$fn$;
REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_under_18(uuid) TO service_role;

-- One trigger function for every "post work / take on work" write.
CREATE OR REPLACE FUNCTION public.refuse_under_18_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'jobs' AND TG_OP = 'INSERT' THEN
    -- Posting: the member's own new job.
    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.customer_id
       AND public.member_under_18(NEW.customer_id) THEN
      RAISE EXCEPTION 'under_18'
        USING ERRCODE = '42501', HINT = 'You must be 18 or older to post a job.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'jobs' AND TG_OP = 'UPDATE' THEN
    -- Only a Helpr being booked (helper_id set to someone new) or confirming
    -- their booking (helper_confirmed_at first set) is judged.
    IF NEW.helper_id IS NULL
       OR NOT (NEW.helper_id IS DISTINCT FROM OLD.helper_id
               OR (OLD.helper_confirmed_at IS NULL AND NEW.helper_confirmed_at IS NOT NULL)) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'group_job_helpers' AND TG_OP = 'UPDATE' THEN
    -- A crew member's first confirm of a seat held before the birthday was
    -- saved (rpc_group_member_confirm, complete_pending_crew_confirms_on_setup).
    IF NOT (OLD.helper_confirmed_at IS NULL AND NEW.helper_confirmed_at IS NOT NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- The Helpr taking on the work: applications, job_accept_pending,
  -- series_visit_holds, group_job_helpers, or the booking on jobs.
  IF public.member_under_18(NEW.helper_id) THEN
    IF auth.uid() IS NOT DISTINCT FROM NEW.helper_id THEN
      RAISE EXCEPTION 'under_18'
        USING ERRCODE = '42501', HINT = 'You must be 18 or older to apply for jobs.';
    END IF;
    -- Anyone else (the poster hiring, a server completing a remembered
    -- accept) is not told the Helpr's age.
    RAISE EXCEPTION 'helper_unavailable'
      USING ERRCODE = '42501', HINT = 'This Helpr can''t take this job.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_under_18_member() FROM PUBLIC, anon, authenticated;

-- The birthday a member under 18 has saved is not theirs to rewrite.
CREATE OR REPLACE FUNCTION public.lock_under_18_birthday()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND OLD.date_of_birth IS NOT NULL
     AND (OLD.date_of_birth + interval '18 years') > (now() AT TIME ZONE 'America/Chicago')::date
     AND auth.uid() IS NOT NULL
     AND auth.uid() = OLD.user_id THEN
    RAISE EXCEPTION 'under_18_birthday_locked'
      USING ERRCODE = '42501', HINT = 'A saved birthday under 18 can only be corrected by Louisiana Helpr support.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lock_under_18_birthday() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_jobs_refuse_under_18 ON public.jobs;
    CREATE TRIGGER trg_jobs_refuse_under_18
      BEFORE INSERT OR UPDATE OF helper_id, helper_confirmed_at ON public.jobs
      FOR EACH ROW EXECUTE FUNCTION public.refuse_under_18_member();
  END IF;
  IF to_regclass('public.series_visit_holds') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_series_visit_holds_refuse_under_18 ON public.series_visit_holds;
    CREATE TRIGGER trg_series_visit_holds_refuse_under_18
      BEFORE INSERT ON public.series_visit_holds
      FOR EACH ROW EXECUTE FUNCTION public.refuse_under_18_member();
  END IF;
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_group_job_helpers_refuse_under_18 ON public.group_job_helpers;
    CREATE TRIGGER trg_group_job_helpers_refuse_under_18
      BEFORE INSERT OR UPDATE OF helper_confirmed_at ON public.group_job_helpers
      FOR EACH ROW EXECUTE FUNCTION public.refuse_under_18_member();
  END IF;
  IF to_regclass('public.applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_applications_refuse_under_18 ON public.applications;
    CREATE TRIGGER trg_applications_refuse_under_18
      BEFORE INSERT ON public.applications
      FOR EACH ROW EXECUTE FUNCTION public.refuse_under_18_member();
  END IF;
  IF to_regclass('public.job_accept_pending') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_job_accept_pending_refuse_under_18 ON public.job_accept_pending;
    CREATE TRIGGER trg_job_accept_pending_refuse_under_18
      BEFORE INSERT ON public.job_accept_pending
      FOR EACH ROW EXECUTE FUNCTION public.refuse_under_18_member();
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_profiles_lock_under_18_birthday ON public.profiles;
    CREATE TRIGGER trg_profiles_lock_under_18_birthday
      BEFORE UPDATE OF date_of_birth ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.lock_under_18_birthday();
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_payment_status text;
  v_count int;
  v_cap_minute int := public.application_cap('minute');
  v_cap_hour   int := public.application_cap('hour');
  v_cap_day    int := public.application_cap('day');
BEGIN
  -- Q1586(c) (owner, 2026-10-12): a member whose saved birthday makes them
  -- under 18 cannot apply. Checked first, so the refusal never counts toward
  -- the rate ladder. The applications trigger refuses every other path too.
  IF public.member_under_18(auth.uid()) THEN
    RAISE EXCEPTION 'under_18'
      USING ERRCODE = '42501', HINT = 'You must be 18 or older to apply for jobs.';
  END IF;

  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  --
  -- Taken unconditionally, INCLUDING when every cap is off. It is not only the
  -- rate ladder's lock: it is also what stops two simultaneous applies from
  -- both passing the "already applied" check below and inserting a duplicate.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  IF v_cap_minute IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
    IF v_count >= v_cap_minute THEN
      RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
    END IF;
  END IF;

  IF v_cap_hour IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
    IF v_count >= v_cap_hour THEN
      RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
    END IF;
  END IF;

  IF v_cap_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
    IF v_count >= v_cap_day THEN
      RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
    END IF;
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT status, payment_status INTO v_status, v_payment_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  -- Q1409: a booked crew's free spot is re-listed until 15 minutes before
  -- its start (crew_spots_open), so it takes applications like an open job.
  IF v_status != 'open' AND NOT (v_status = 'accepted' AND COALESCE(public.crew_spots_open(p_job_id), 0) > 0) THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;

  -- ADDED 2026-09-06 -- the funding gate. Read under the same FOR SHARE lock
  -- as the status, so it cannot be raced by a refund landing mid-apply.
  -- Deliberately worded for the helper, not the poster: the job's funding
  -- state is not the helper's business beyond "you cannot take this yet".
  IF NOT public.job_payment_is_funded(v_payment_status) THEN
    RAISE EXCEPTION 'This job is not accepting applications yet'
      USING HINT = 'The poster has not completed checkout, so there is no payment held for this job.';
  END IF;

  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated, service_role;
