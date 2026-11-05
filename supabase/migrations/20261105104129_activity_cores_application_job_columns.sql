-- Q2742 part 2 (HIGH, Builder 3, 2026-11-05; lead: one migration, lh-authz-rls review before queueing): get_my_activity_cores
-- now hands application_jobs and direct_offers back with ONLY the job columns the client asks for. Before, both came
-- whole (to_jsonb of get_jobs_for_my_applications() / get_my_pending_direct_offers(): all 126 jobs columns), whatever
-- the caller sent. Measured on prod 11-05 (read-only, rolled back, as the test helper 7b923b19): application_jobs is
-- 576,579 B for 136 jobs; 73,795 B of it are the columns no reader of the activity rows names.
--
-- The list is a NEW third argument, p_application_job_columns, not p_job_columns: the applied readers also read
-- offered_to_helper_id (activityFilters, jobStatusLine: the definers null it unless I am the offeree or the poster),
-- which authenticated may not SELECT, and posted_jobs is a SECURITY INVOKER SELECT of p_job_columns, so naming it
-- there would refuse the whole read (42501). It is a KEY FILTER on the definers' rows (jsonb_each ... WHERE key =
-- ANY), never a SELECT list: it can only take keys away, so it widens nothing; a name the row does not have is simply
-- absent. NULL (the default: a client that sends only the two lists, during the deploy window) keeps the old whole
-- rows, so an older web build reads exactly what it read before.
--
-- Restated from 20261103231310_activity_cores_carry_open_continue_days.sql, whose md5(prosrc)
-- 5102427137583c0f9594ead23365f9eb equals prod (read 2026-11-05 ~4:45 AM by Builder 3; 1 overload; STABLE SECURITY
-- INVOKER; acl authenticated + service_role). Only the new argument, its check, and the two filtered keys are new;
-- the other seven keys are byte-for-byte unchanged. The signature changes, so DROP + CREATE (one transaction, as
-- db-deploy applies a file) and the grants restated by role name. Replay-safe: DROP IF EXISTS of both signatures.

DROP FUNCTION IF EXISTS public.get_my_activity_cores(text[], text[]);
DROP FUNCTION IF EXISTS public.get_my_activity_cores(text[], text[], text[]);

CREATE FUNCTION public.get_my_activity_cores(p_job_columns text[], p_application_columns text[],
                                             p_application_job_columns text[] DEFAULT NULL)
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
  -- Q2742 part 2: the applied / offered job keys to keep. NULL = whole rows (an older client); else the same checks.
  IF p_application_job_columns IS NOT NULL AND (
       cardinality(p_application_job_columns) = 0 OR cardinality(p_application_job_columns) > 200
       OR EXISTS (SELECT 1 FROM unnest(p_application_job_columns) c WHERE c IS NULL OR c !~ '^[a-z_][a-z0-9_]*$')) THEN
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
      SELECT coalesce(jsonb_agg(CASE WHEN p_application_job_columns IS NULL THEN to_jsonb(j) ELSE (
                 SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(to_jsonb(j)) e
                  WHERE e.key = ANY (p_application_job_columns)) END), '[]'::jsonb)
        FROM public.get_jobs_for_my_applications() j),
    'direct_offers', (
      SELECT coalesce(jsonb_agg(CASE WHEN p_application_job_columns IS NULL THEN to_jsonb(d) ELSE (
                 SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(to_jsonb(d)) e
                  WHERE e.key = ANY (p_application_job_columns)) END), '[]'::jsonb)
        FROM public.get_my_pending_direct_offers() d),
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

REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[]) TO authenticated, service_role;
