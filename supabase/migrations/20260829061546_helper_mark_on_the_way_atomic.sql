-- Atomic "on the way" + a deep link that actually lands somewhere.
--
-- WHAT WAS WRONG (proven live 2026-08-28, job db21c20d):
--   1. The on_the_way transition was THREE sequential client writes
--      (job_tracking upsert, jobs.status = in_progress,
--      jobs.helper_on_the_way_at). An interrupted run left
--      status = in_progress with NO tracking row and NO departure
--      timestamp — the poster's timeline and the tracker disagreed about
--      whether anything had happened.
--   2. Because status and helper_on_the_way_at were two separate UPDATEs,
--      notify_poster_on_status_change fired twice and the poster got BOTH
--      "Work has started" and "<name> is on the way" for one tap.
--   3. notify_poster_on_status_change linked to '/my-posts?job=<id>' — the
--      Activity page reads no `job` param (only filter/q/highlight), so the
--      tap landed on the default "Needs you" list, which does not contain an
--      in_progress job. Those bucket as `scheduled`
--      (postedActivityBucket in src/pages/activity/activityFilters.ts).
--
-- 1. helper_mark_on_the_way: one transaction for the whole transition.
--    Mirrors mark_helper_arrival (20260828011057): SECURITY DEFINER, caller
--    must be the job's confirmed helper, valid only from accepted /
--    in_progress. The single jobs UPDATE (status + timestamp together) also
--    means the notify trigger fires ONCE and its ELSIF chain picks the
--    "is on the way" branch — the double notification dies here too.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, against tables from the initial
-- schema; the trigger function replaced in §2 is created by 20260824070000,
-- which precedes this file, and CREATE OR REPLACE is safe either way.

CREATE OR REPLACE FUNCTION public.helper_mark_on_the_way(
  p_job_id uuid,
  p_lat float8 DEFAULT NULL,
  p_lng float8 DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_now timestamptz := now();
  v_tracking_id uuid;
BEGIN
  -- Lock the row: two concurrent taps must not both run the transition.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'On-the-way can only be marked on an accepted or in-progress job.';
  END IF;
  IF v_job.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',
      HINT = 'Confirm the job before heading out.';
  END IF;

  -- Tracking row: job_tracking has no unique(job_id, helper_id), so update
  -- the newest existing row for this pair, else insert one.
  SELECT id INTO v_tracking_id
    FROM public.job_tracking
   WHERE job_id = p_job_id AND helper_id = v_job.helper_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_tracking_id IS NOT NULL THEN
    UPDATE public.job_tracking
       SET status = 'on_the_way',
           latitude = p_lat,
           longitude = p_lng,
           updated_at = v_now
     WHERE id = v_tracking_id;
  ELSE
    INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude)
    VALUES (p_job_id, v_job.helper_id, 'on_the_way', p_lat, p_lng)
    RETURNING id INTO v_tracking_id;
  END IF;

  -- ONE update: status transition + departure stamp together, so the notify
  -- trigger sees both in a single firing and an interrupted run can never
  -- leave one without the other.
  UPDATE public.jobs
     SET status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END,
         helper_on_the_way_at = COALESCE(helper_on_the_way_at, v_now)
   WHERE id = p_job_id;

  RETURN v_tracking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.helper_mark_on_the_way(uuid, float8, float8) FROM public;
REVOKE ALL ON FUNCTION public.helper_mark_on_the_way(uuid, float8, float8) FROM anon;
GRANT EXECUTE ON FUNCTION public.helper_mark_on_the_way(uuid, float8, float8) TO authenticated;

-- 2. Fix the dead deep link in notify_poster_on_status_change.
--    Byte-identical to the 20260824070000 version except v_link:
--    '/my-posts?job=' || id  →  '/my-posts?filter=scheduled'.
--    (Activity.tsx reads `filter`; in_progress posted jobs bucket as
--    "scheduled".)

CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_pref_in_app boolean;
  v_link text;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/my-posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/my-posts?filter=scheduled';
  SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/my-posts?filter=needs_you';

  ELSE
    RETURN NEW;
  END IF;

  -- Check in-app pref for poster
  SELECT
    CASE v_category
      WHEN 'transit_updates' THEN COALESCE(transit_updates, true)
      WHEN 'work_status' THEN COALESCE(work_status, true)
      ELSE true
    END INTO v_pref_in_app
  FROM public.notification_preferences WHERE user_id = NEW.customer_id;

  IF COALESCE(v_pref_in_app, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link);
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);
  ELSE
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'skipped', v_title, NEW.id, 'preference_off');
  END IF;

  RETURN NEW;
END;
$function$;
