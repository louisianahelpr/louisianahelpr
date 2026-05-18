-- Atomic moderation RPCs for the helper-decline and poster-no-show flows.
--
-- Both were previously unguarded multi-step client sequences: count
-- prior violations, insert a violation, maybe insert a ban + flip
-- profiles.ban_status, reject the application, reopen the job. A
-- failure partway through left a helper half-banned, or a job stuck in
-- "accepted" with a rejected application — inconsistent moderation
-- state with no rollback. These two SECURITY DEFINER functions run the
-- whole sequence in one transaction.
--
-- Notifications (helper + admins) deliberately stay client-side and
-- best-effort — only the data-integrity writes are made atomic here.
-- Each function returns {action, prior_count, ...} so the client can
-- render the correct notification copy and toast.

-- ───────────────────────────────────────────────────────────────────
-- decline_job_offer — a helper declines a job offer they were selected
-- for. 5-strike escalation: warning at prior strikes 2-3, permanent
-- ban at prior strike >= 4 (i.e. the 5th decline).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_job_offer(
  p_application_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_prior_count int;
  v_action text;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title
    INTO v_job_helper, v_job_title
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id).
  IF v_job_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  SELECT count(*) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_app_helper AND violation_type = 'job_denial';

  v_action := CASE
    WHEN v_prior_count >= 4 THEN 'permanent_ban'
    WHEN v_prior_count >= 2 THEN 'warning'
    ELSE 'none'
  END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (v_app_helper, 'job_denial',
          'Declined job offer: "' || COALESCE(v_job_title, 'Unknown') || '"',
          v_job_id, v_action);

  IF v_action = 'warning' THEN
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = v_app_helper;
  ELSIF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (v_app_helper, 'permanent', 'Declined 5 job offers after being selected', v_app_helper);
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = v_app_helper;
  END IF;

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  RETURN jsonb_build_object('action', v_action, 'prior_count', v_prior_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_job_offer(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────
-- report_helper_no_show — a poster reports the assigned helper as a
-- no-show. 2-strike escalation: warning on the first no-show,
-- permanent ban on the second.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_helper_no_show(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_prior_count int;
  v_action text;
BEGIN
  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title
    INTO v_customer_id, v_helper_id, v_job_title
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  SELECT count(*) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id AND violation_type = 'no_show';

  v_action := CASE WHEN v_prior_count >= 1 THEN 'permanent_ban' ELSE 'warning' END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, reported_by, action_taken)
  VALUES (v_helper_id, 'no_show',
          'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
          p_job_id, auth.uid(), v_action);

  IF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (v_helper_id, 'permanent', 'Repeated no-show violations', auth.uid());
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = v_helper_id;
  ELSE
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = v_helper_id;
  END IF;

  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'action', v_action,
    'prior_count', v_prior_count,
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_helper_no_show(uuid) TO authenticated;
