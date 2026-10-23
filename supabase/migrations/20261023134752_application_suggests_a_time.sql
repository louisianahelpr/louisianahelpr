-- Applying asks "Does <day> at <time> work for you?"; a Helpr may suggest another day and time, and
-- hiring them agrees to it (owner, 2026-10-23: "when they apply can we add something like does this
-- date/time work for you? If not, submit your suggested time/day" ... "Hiring accepts it. POP also do some
-- kind of screen that says since you are hiring you are also agreeing to the helprs suggested date time";
-- "Every job").
--
-- WHAT WAS MISSING. apply_to_job(p_job_id, p_message) takes a note only, so Helprs wrote "can we change
-- the date/time?" into their message, and the poster had no structured way to see or accept it.
--
-- THE CHANGE (no existing function body is restated):
--  1. applications.suggested_date (date) and suggested_start_time (time), nullable. A suggestion is the
--     date plus an optional time (no time = the job's own start time on that day). Readable by the same
--     members who read the row (column grant to authenticated, like every other readable column).
--  2. public.apply_to_job_with_time(p_job_id, p_message, p_suggested_date, p_suggested_time): a NEW function
--     (its own name, not an overload, so every guard keyed on apply_to_job still reads one body). It runs
--     the unchanged 2-argument apply_to_job (every check: age, rate ladder, lock, status, funding, own job,
--     duplicate) and stores the suggestion on the row it just wrote, in the SAME transaction, so an
--     application never lands without the suggestion the Helpr chose. The 2-argument function stays for
--     installed apps. A suggestion is refused (suggestion_not_allowed) on a crew job, a series visit or a
--     quote-booked job (one time is shared, or the terms are locked), refused when it is in the past
--     (America/Chicago) or more than 90 days out (suggestion_date_invalid), and refused when it is the job's
--     own day and time (suggestion_same_as_job).
--  3. Hiring agrees to it. accept_application_at_suggested_time(p_application_id, p_deadline, p_offer_message):
--     the poster's ONE call for an applicant with a suggestion. It checks the caller is the job's poster,
--     the application is pending with a suggestion, the job is STILL a single job (not since turned into a
--     crew, a series or a quote job: suggestion_not_allowed) and the suggested start is at least 2 hours
--     away in America/Chicago (suggestion_too_soon), then moves the open job to that day/time with an
--     UPDATE and calls the unchanged accept_application. One transaction: a refused hire leaves the job's
--     date as it was. Which jobs triggers run on that UPDATE (read on prod, lh-authz-rls review 2026-10-23):
--     the open-edit notice to the other applicants, the quote lock, the poster money lock, the offer-deadline
--     and expiry recomputes do; the series client lock exits for a definer (current_user is not
--     authenticated) and the short-notice trigger is INSERT-only, which is why the two checks above are
--     made here. The job keeps its new time even if the Helpr then declines (the hire screen says so).
--  4. The database holds the line: trg_applications_hire_agrees_to_suggestion refuses accepting an
--     application whose suggestion is not the job's day/time (suggested_time_not_agreed), so an installed
--     app that cannot show the suggestion cannot hire past it either.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS suggested_date date;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS suggested_start_time time without time zone;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_suggested_time_needs_date') THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_suggested_time_needs_date
      CHECK (suggested_start_time IS NULL OR suggested_date IS NOT NULL);
  END IF;
END
$c$;
COMMENT ON COLUMN public.applications.suggested_date IS
  'The day the Helpr suggested instead of the job''s (owner 2026-10-23); NULL = the job''s day works. Written only by apply_to_job_with_time. Hiring this applicant moves the job to it (accept_application_at_suggested_time).';
COMMENT ON COLUMN public.applications.suggested_start_time IS
  'The start time the Helpr suggested; NULL with a suggested_date = the job''s own start time on that day.';
GRANT SELECT (suggested_date, suggested_start_time) ON public.applications TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_to_job_with_time(p_job_id uuid, p_message text, p_suggested_date date, p_suggested_time time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_app_id uuid;
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF p_suggested_date IS NULL AND p_suggested_time IS NOT NULL THEN
    RAISE EXCEPTION 'suggestion_date_invalid' USING ERRCODE = '22023', HINT = 'Pick a day for the time you suggest.';
  END IF;

  -- Every apply check, unchanged, first (it takes the helper's advisory lock, then the job FOR SHARE, in
  -- its own order); a refusal below rolls its insert back with it.
  v_app_id := public.apply_to_job(p_job_id, p_message);

  IF p_suggested_date IS NOT NULL THEN
    -- Already held FOR SHARE by apply_to_job in this transaction: no new lock order.
    SELECT j.date_needed, j.start_time, j.is_group_job, j.parent_job_id, j.is_recurring, j.recurrence_days, j.pricing_mode
      INTO v_job
      FROM public.jobs j WHERE j.id = p_job_id
      FOR SHARE;
    IF COALESCE(v_job.is_group_job, false) OR v_job.parent_job_id IS NOT NULL
       OR COALESCE(v_job.is_recurring, false) OR v_job.recurrence_days IS NOT NULL OR v_job.pricing_mode = 'quotes' THEN
      RAISE EXCEPTION 'suggestion_not_allowed' USING ERRCODE = '22023',
        HINT = 'This job keeps one time for everyone, so a different time can''t be suggested.';
    END IF;
    IF p_suggested_date < v_today OR p_suggested_date > v_today + 90 THEN
      RAISE EXCEPTION 'suggestion_date_invalid' USING ERRCODE = '22023',
        HINT = 'Pick a day from today to 90 days out.';
    END IF;
    IF p_suggested_date = v_job.date_needed
       AND COALESCE(p_suggested_time, v_job.start_time) IS NOT DISTINCT FROM v_job.start_time THEN
      RAISE EXCEPTION 'suggestion_same_as_job' USING ERRCODE = '22023',
        HINT = 'That is the job''s own day and time. Choose "Yes, that works" instead.';
    END IF;
  END IF;

  IF p_suggested_date IS NOT NULL THEN
    UPDATE public.applications
       SET suggested_date = p_suggested_date,
           suggested_start_time = p_suggested_time
     WHERE id = v_app_id;
  END IF;

  RETURN v_app_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_to_job_with_time(uuid, text, date, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_job_with_time(uuid, text, date, time without time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_application_at_suggested_time(p_application_id uuid, p_deadline timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job_id uuid;
  v_status text;
  v_date date;
  v_time time;
  v_customer uuid;
  v_job_status text;
  v_job record;
BEGIN
  SELECT a.job_id, a.status, a.suggested_date, a.suggested_start_time
    INTO v_job_id, v_status, v_date, v_time
    FROM public.applications a WHERE a.id = p_application_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  SELECT j.customer_id, j.status, j.is_group_job, j.parent_job_id, j.is_recurring, j.recurrence_days, j.pricing_mode, j.start_time
    INTO v_job
    FROM public.jobs j WHERE j.id = v_job_id FOR UPDATE;
  v_customer := v_job.customer_id;
  v_job_status := v_job.status;
  IF v_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;
  IF v_date IS NULL THEN
    RAISE EXCEPTION 'no_suggested_time' USING HINT = 'This applicant did not suggest a different time.';
  END IF;
  -- Still a single job? A poster can turn an open job into a crew, a series or a quote job after people
  -- apply, and the series lock does not run for this definer (header), so it is checked here.
  IF COALESCE(v_job.is_group_job, false) OR v_job.parent_job_id IS NOT NULL
     OR COALESCE(v_job.is_recurring, false) OR v_job.recurrence_days IS NOT NULL OR v_job.pricing_mode = 'quotes' THEN
    RAISE EXCEPTION 'suggestion_not_allowed' USING ERRCODE = '22023',
      HINT = 'This job now keeps one time for everyone, so their suggested time can''t be used.';
  END IF;
  -- The posting notice floor, at hire time (a suggestion is only checked when it is made).
  IF ((v_date + COALESCE(v_time, v_job.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago') < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'suggestion_too_soon' USING ERRCODE = '22023',
      HINT = 'Their suggested time is less than 2 hours away.';
  END IF;

  -- The poster's date edit: the jobs guards listed in the header run on it.
  UPDATE public.jobs
     SET date_needed = v_date,
         start_time = COALESCE(v_time, start_time)
   WHERE id = v_job_id;

  PERFORM public.accept_application(p_application_id, p_deadline, p_offer_message);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_application_at_suggested_time(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application_at_suggested_time(uuid, timestamp with time zone, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.applications_hire_agrees_to_suggestion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_date date;
  v_time time;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NEW.suggested_date IS NOT NULL THEN
    SELECT j.date_needed, j.start_time INTO v_date, v_time FROM public.jobs j WHERE j.id = NEW.job_id FOR SHARE;
    IF v_date IS DISTINCT FROM NEW.suggested_date
       OR (NEW.suggested_start_time IS NOT NULL AND v_time IS DISTINCT FROM NEW.suggested_start_time) THEN
      RAISE EXCEPTION 'suggested_time_not_agreed' USING ERRCODE = '42501',
        HINT = 'This applicant suggested a different day or time. Hiring them agrees to it.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.applications_hire_agrees_to_suggestion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_applications_hire_agrees_to_suggestion ON public.applications;
CREATE TRIGGER trg_applications_hire_agrees_to_suggestion
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_hire_agrees_to_suggestion();
