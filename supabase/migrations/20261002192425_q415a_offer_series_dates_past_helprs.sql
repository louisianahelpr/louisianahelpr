-- Q415 (a), owner 2026-09-27 ("all six" recommendations accepted): the poster
-- can offer a series' open dates to someone they have already worked with, not
-- only to a Helpr who applied to the series before its first hire.
--
-- Restated from 20260927012806_recurring_split_days.sql. The ONLY change is the
-- eligibility check: a pending application on this series, OR a job this poster
-- posted that this Helpr completed. Every other check (poster only, live
-- series, not self, not blocked, not banned, open dates) is unchanged.
-- The other half of (a), accepting new applications on a hired series card, is
-- its own item (docs/OPEN.md) because it crosses apply_to_job, the application
-- trigger, accept_application and the client apply flow.
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
  -- Someone who asked for this series and is still waiting on it, or (Q415 (a))
  -- someone this poster has already worked with: a job they posted that this
  -- Helpr completed.
  IF NOT EXISTS (SELECT 1 FROM public.applications a
                  WHERE a.job_id = v_job.id AND a.helper_id = p_helper_id AND a.status = 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.jobs w
                      WHERE w.customer_id = v_uid AND w.helper_id = p_helper_id
                        AND w.status::text = 'completed'
                      FOR SHARE) THEN
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
