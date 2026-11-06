-- get_my_activity_cores carries the ACTIVE continue days, 'active_continue_days' (Builder 2, 2026-11-06; lead plan
-- 11-05 + OK 11-06, "Nothing slow for users"): Home and the to-do list (useContinueDays) read job_continue_days on
-- their own on every signed-in load with a job under way (x145 in one a11y-prod run, the boot read set). The rows
-- now come in the cores payload the same load already asks for; the client uses them only as the FIRST answer
-- (initialData), and every later read is the old direct one (src/lib/activityCoreContinueDays.ts).
--
-- Restates 20261105111750_activity_cores_parts.sql (live prosrc md5 b6d044484f8239371fd0cac80701aa0d = that file's
-- body, read 2026-11-05 ~11:50 PM CT) with ONE new key. Same signature, so CREATE OR REPLACE (the grants stay; they
-- are restated by role name anyway). READ ONLY, no money, still STABLE SECURITY INVOKER: job_continue_days keeps its
-- party-only RLS (live: 'Job parties read continue days', poster or assigned Helpr, or admin), and the key is scoped
-- to the same job ids as open_continue_days, so an admin gets only their own. Returns no poster id ('proposer' only).
-- REPLAY-SAFETY: CREATE OR REPLACE of the existing signature.

CREATE OR REPLACE FUNCTION public.get_my_activity_cores(p_job_columns text[], p_application_columns text[],
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
                          UNION SELECT a.job_id FROM public.applications a WHERE v_applied_part AND a.helper_id = v_uid)),
    -- 20261106054856: the ACTIVE (proposed or set) continue days of the same jobs, for Home and the to-do list
    -- (useContinueDays read job_continue_days on its own on every signed-in load). The client's read word for word
    -- (fetchContinueDays: status in proposed/set), scoped to EXACTLY the job ids open_continue_days uses. 'proposer'
    -- is worked out here ('poster' when proposed_by is the job's poster, else 'helpr', as withProposer does), so no
    -- poster id is returned; the jobs row is read under the caller's own RLS (INVOKER), as the client's embed was.
    'active_continue_days', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'job_id', d.job_id, 'proposed_by', d.proposed_by,
                                                   'new_date', d.new_date, 'new_start_time', d.new_start_time,
                                                   'note', d.note, 'status', d.status,
                                                   'helper_confirmed_at', d.helper_confirmed_at,
                                                   'proposer', CASE WHEN d.proposed_by IS NOT NULL AND j.customer_id IS NOT NULL
                                                                     AND d.proposed_by = j.customer_id THEN 'poster' ELSE 'helpr' END)), '[]'::jsonb)
        FROM public.job_continue_days d
        LEFT JOIN public.jobs j ON j.id = d.job_id
       WHERE d.status IN ('proposed', 'set')
         AND d.job_id IN (SELECT j2.id FROM public.jobs j2 WHERE v_posted_part AND j2.customer_id = v_uid
                          UNION SELECT a.job_id FROM public.applications a WHERE v_applied_part AND a.helper_id = v_uid))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) TO authenticated, service_role;
