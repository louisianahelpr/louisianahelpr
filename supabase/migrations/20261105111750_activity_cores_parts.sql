-- Q2706 Posted (Builder 3, 2026-11-05; lead pre-approved the design, lh-authz-rls review before queueing):
-- get_my_activity_cores takes a fourth argument, p_parts text[] DEFAULT NULL, so a cold Posted-first link can ask for
-- the posted part and the applied part as two parallel calls and paint Posted without waiting on application_jobs.
-- Measured 11-05 (cwv-lab proxy 2, test helper, Fast 4G, cold /jobs?tab=posted, 3 interleaved rounds): LCP median
-- 1856 -> 1336 ms when the posted reads come apart from the cores call; the proxy made the poster WORSE because the
-- cores call still carried posted_jobs (a double download). Here each part is computed only when asked, so there is
-- no duplicate key between the two calls.
--
--   p_parts NULL          every key, exactly as before (every caller that does not send it: fetchActivityCores, an
--                         older web build).
--   ARRAY['posted']       posted_jobs, poster_applications, offer_targets, open_continue_days of the jobs I posted.
--   ARRAY['applied']      my_applications, application_jobs, direct_offers, violations, reviews, open_continue_days
--                         of the jobs I applied to.
--   anything else         bad_parts (22023): an empty list, a NULL, an unknown name, more than two.
--
-- It only chooses which of the existing keys are computed: no new read, no new row, no new column. Still STABLE
-- SECURITY INVOKER with the same identifier checks on the three column lists. open_continue_days keeps its body and
-- is scoped to the asked part's job ids (both parts: the same union as before).
--
-- Restated from 20261105104129_activity_cores_application_job_columns.sql (Q2742 part 2, l88; not on prod when this
-- was written, so it is the effective definition, not a live read). Only the new argument, its check, the two part
-- flags and the conditional assembly are new; every key's subquery is unchanged. The signature changes, so DROP +
-- CREATE (one transaction, as db-deploy applies a file) and the grants restated by role name. Replay-safe: DROP IF
-- EXISTS of all three signatures.

DROP FUNCTION IF EXISTS public.get_my_activity_cores(text[], text[]);
DROP FUNCTION IF EXISTS public.get_my_activity_cores(text[], text[], text[]);
DROP FUNCTION IF EXISTS public.get_my_activity_cores(text[], text[], text[], text[]);

CREATE FUNCTION public.get_my_activity_cores(p_job_columns text[], p_application_columns text[],
                                             p_application_job_columns text[] DEFAULT NULL,
                                             p_parts text[] DEFAULT NULL)
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
  v_posted_part boolean := p_parts IS NULL OR 'posted' = ANY (p_parts);
  v_applied_part boolean := p_parts IS NULL OR 'applied' = ANY (p_parts);
  v_out jsonb := '{}'::jsonb;
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
  -- Q2706: which parts to compute. NULL = both (every key, as before).
  IF p_parts IS NOT NULL AND (
       cardinality(p_parts) = 0 OR cardinality(p_parts) > 2
       OR EXISTS (SELECT 1 FROM unnest(p_parts) p WHERE p IS NULL OR p NOT IN ('posted', 'applied'))) THEN
    RAISE EXCEPTION 'bad_parts' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(format('%I', c), ', ') INTO v_job_cols FROM unnest(p_job_columns) c;
  SELECT string_agg(format('%I', c), ', ') INTO v_app_cols FROM unnest(p_application_columns) c;

  IF v_posted_part THEN
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(to_jsonb(t) - %L ORDER BY t.%I), %L::jsonb)
         FROM (SELECT %s, row_number() OVER (ORDER BY created_at DESC) AS %I
                 FROM public.jobs WHERE customer_id = $1) t',
      '_lh_ord', '_lh_ord', '[]', v_job_cols, '_lh_ord')
      INTO v_posted USING v_uid;

    v_out := v_out || jsonb_build_object(
      'posted_jobs', v_posted,
      'poster_applications', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', a.job_id, 'status', a.status, 'closed_reason', a.closed_reason)), '[]'::jsonb)
          FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE j.customer_id = v_uid),
      'offer_targets', (
        SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) FROM public.get_job_offer_targets() o)
    );
  END IF;

  IF v_applied_part THEN
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(to_jsonb(t) - %L ORDER BY t.%I), %L::jsonb)
         FROM (SELECT %s, row_number() OVER (ORDER BY created_at DESC) AS %I
                 FROM public.applications WHERE helper_id = $1) t',
      '_lh_ord', '_lh_ord', '[]', v_app_cols, '_lh_ord')
      INTO v_my_apps USING v_uid;

    v_out := v_out || jsonb_build_object(
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
         WHERE r.reviewer_id = v_uid)
    );
  END IF;

  -- Q2706: scoped to the asked parts' job ids (both parts: the same union as before).
  RETURN v_out || jsonb_build_object(
    -- Owner bug 11-03: the OPEN set continue days of my jobs (the ones I posted, the ones I applied to), so Activity
    -- dates a continuing job by its next day. The client's read word for word (status 'set', closed_at null), scoped
    -- to the job ids this payload carries, so an admin (who may read every open day, 20261103212624) gets only theirs.
    'open_continue_days', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('job_id', d.job_id, 'status', d.status, 'new_date', d.new_date,
                                                   'new_start_time', d.new_start_time)), '[]'::jsonb)
        FROM public.job_continue_days d
       WHERE d.status = 'set' AND d.closed_at IS NULL
         AND d.job_id IN (SELECT j.id FROM public.jobs j WHERE v_posted_part AND j.customer_id = v_uid
                          UNION SELECT a.job_id FROM public.applications a WHERE v_applied_part AND a.helper_id = v_uid))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) TO authenticated, service_role;
