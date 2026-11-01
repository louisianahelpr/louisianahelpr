-- The two activity cores in ONE read (Q104 request budget, release gate
-- e2e-real-backend 41330878323, 2026-11-01; owner: the budget is never raised).
--
-- The "Needs you" badge (NeedsYouBridge, mounted on every signed-in page) reads
-- both activity cores: posted (my jobs, the applications on them, my offer
-- targets) and applied (my applications, their jobs, my pending direct offers,
-- my job-denial violations, the reviews I wrote). That was 8 requests on every
-- cold signed-in page. This function returns the same eight row sets in one.
--
-- SECURITY INVOKER on purpose: every table read below runs as the caller, so
-- RLS and the column grants apply exactly as they do to the PostgREST reads it
-- replaces (a column the caller may not select, such as
-- jobs.offered_to_helper_id or applications.flag_reason, raises 42501 here as
-- it does there). The three SECURITY DEFINER functions it calls are the same
-- ones the client already calls, with the same arguments, under the caller's
-- own auth.uid(). It widens nothing.
--
-- The job and application column lists come from the client (JOB_READABLE_COLUMNS,
-- APPLICATION_READABLE_COLUMNS), so there is one list and a column the web adds
-- before this deploy raises 42703 as the direct read does. The client then
-- falls back to its old reads. Each name must be a plain identifier, and it is
-- quoted with %I.
--
-- The filters are the client's, word for word:
--   jobs          customer_id = me, newest first
--   applications  on jobs I posted (job_id, status, closed_reason)
--   applications  helper_id = me, newest first
--   user_violations user_id = me AND violation_type = 'job_denial' (job_id)
--   reviews       reviewer_id = me (job_id)
--
-- Replay-safe: CREATE OR REPLACE. Grants by role name.

CREATE OR REPLACE FUNCTION public.get_my_activity_cores(p_job_columns text[], p_application_columns text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job_cols text;
  v_app_cols text;
  v_posted jsonb;
  v_my_apps jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_job_columns), 0) = 0 OR cardinality(p_job_columns) > 200
     OR coalesce(cardinality(p_application_columns), 0) = 0 OR cardinality(p_application_columns) > 200
     OR EXISTS (SELECT 1 FROM unnest(p_job_columns || p_application_columns) c WHERE c IS NULL OR c !~ '^[a-z_][a-z0-9_]*$') THEN
    RAISE EXCEPTION 'bad_columns' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(format('%I', c), ', ') INTO v_job_cols FROM unnest(p_job_columns) c;
  SELECT string_agg(format('%I', c), ', ') INTO v_app_cols FROM unnest(p_application_columns) c;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(to_jsonb(t) - %L ORDER BY t.%I), %L::jsonb)
       FROM (SELECT %s, row_number() OVER (ORDER BY created_at DESC) AS %I
               FROM public.jobs WHERE customer_id = $1) t',
    '_lh_ord', '_lh_ord', '[]', v_job_cols, '_lh_ord')
    INTO v_posted USING v_uid;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(to_jsonb(t) - %L ORDER BY t.%I), %L::jsonb)
       FROM (SELECT %s, row_number() OVER (ORDER BY created_at DESC) AS %I
               FROM public.applications WHERE helper_id = $1) t',
    '_lh_ord', '_lh_ord', '[]', v_app_cols, '_lh_ord')
    INTO v_my_apps USING v_uid;

  RETURN jsonb_build_object(
    'posted_jobs', v_posted,
    'poster_applications', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', a.job_id, 'status', a.status, 'closed_reason', a.closed_reason)), '[]'::jsonb)
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
       WHERE j.customer_id = v_uid),
    'offer_targets', (
      SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) FROM public.get_job_offer_targets() o),
    'my_applications', v_my_apps,
    'application_jobs', (
      SELECT coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) FROM public.get_jobs_for_my_applications() j),
    'direct_offers', (
      SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) FROM public.get_my_pending_direct_offers() d),
    'violations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', v.job_id)), '[]'::jsonb)
        FROM public.user_violations v
       WHERE v.user_id = v_uid AND v.violation_type = 'job_denial'),
    'reviews', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', r.job_id)), '[]'::jsonb)
        FROM public.reviews r
       WHERE r.reviewer_id = v_uid)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[]) TO authenticated, service_role;
