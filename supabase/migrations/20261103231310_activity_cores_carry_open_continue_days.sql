-- Activity back to ONE request (owner: requests per page; lead follow-up 11-03 to 498f59e7eb). get_my_activity_cores
-- also returns 'open_continue_days': the open SET continue days (status 'set', closed_at null) of the jobs I posted
-- or applied to, the rows fetchMyOpenContinueDays read in a second request beside the cores. The client takes them
-- from the payload when the key is there and sends its own read only when it is not (an older database) or the cores
-- read failed. A ninth key; the other eight are byte-for-byte unchanged.
--
-- Restated from 20261101181403_activity_cores_one_read.sql, whose md5(prosrc) b252b764b000a1c050363f8086ac4ddd and
-- md5(pg_get_functiondef) 864b467c2509600aefe4118350cbb31a equal prod (read 2026-11-03 by Builder 79; 1 overload;
-- STABLE SECURITY INVOKER; acl authenticated + service_role). Still SECURITY INVOKER: job_continue_days is read
-- under the caller's own RLS ("Job parties read continue days"), as the direct read was. It widens nothing.
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
       WHERE r.reviewer_id = v_uid),
    -- Owner bug 11-03: the OPEN set continue days of my jobs (the ones I posted, the ones I applied to), so Activity
    -- dates a continuing job by its next day. The client's read word for word (status 'set', closed_at null), scoped
    -- to the job ids this payload carries, so an admin (who may read every open day, 20261103212624) gets only theirs.
    'open_continue_days', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', d.job_id, 'status', d.status, 'new_date', d.new_date,
                                                   'new_start_time', d.new_start_time)), '[]'::jsonb)
        FROM public.job_continue_days d
       WHERE d.status = 'set' AND d.closed_at IS NULL
         AND d.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid
                          UNION SELECT a.job_id FROM public.applications a WHERE a.helper_id = v_uid))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[]) TO authenticated, service_role;
