-- `SELECT (r.rec).*` costs one full evaluation of the lateral PER OUTPUT COLUMN.
--
-- Postgres has no concept of "this composite subexpression, once". Writing
-- `(r.rec).*` expands at parse time into `(r.rec).id, (r.rec).title, ...` — one
-- copy of the whole `jsonb_populate_record(NULL::jobs, to_jsonb(j) || ...)`
-- expression per column of `public.jobs`, which is ~100 of them. The planner
-- then inlines the single-row lateral into the target list, so the sub-selects
-- vanish from EXPLAIN entirely and the cost hides inside the Nested Loop with
-- no node of its own to blame. Every one of those copies re-runs
-- user_may_see_job_address(), mask_job_location(), to_jsonb() and
-- jsonb_populate_record().
--
-- Measured on prod for user 437de07d-1bd7-46c8-a451-6b46aa3bcad5 (26 rows,
-- force_generic_plan): 887 ms / 18,688 shared buffers. Under concurrent load
-- this crossed statement_timeout, so the "Applied" bucket of My Jobs and the
-- dashboard returned 57014 to the browser for the most active helpers.
--
-- The fix is to put the record in the FROM clause instead of the target list.
-- A set-returning function as a lateral FROM item is a real Function Scan node
-- executed once per row, and `rec.*` is then plain column expansion over its
-- output. Same rows, one evaluation: 8.8 ms / 391 buffers, a 100x reduction
-- that matches the ~100 columns exactly.
--
-- Equivalence was proven against live prod data before this shipped: both forms
-- returned the same 26 rows with a zero-row symmetric difference (EXCEPT in
-- both directions), over a set that exercises BOTH masking branches — 25 rows
-- where user_may_see_job_address() is true and 1 where it is false.
--
-- Bodies below are copied verbatim from pg_get_functiondef() on prod; the ONLY
-- change is the lateral form. SECURITY DEFINER, STABLE, search_path and the
-- grants are restated identically and re-asserted at the end.

CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
           )
         ) AS rec
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
          -- A group roster member who is not the lead. NULL-safe as above.
          OR EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = j.id AND g.helper_id = v_uid
             )
        );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
           )
         ) AS rec
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
  ORDER BY j.created_at DESC;
END;
$function$;

-- Grants restated to match prod's proacl exactly
-- ({postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} for
-- both). CREATE OR REPLACE preserves existing ACLs, so this is belt-and-braces
-- against a future drop/recreate picking up Supabase's default of also granting
-- anon. REVOKE names anon explicitly: revoking PUBLIC alone does NOT remove the
-- individual anon grant.
REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated, service_role;
