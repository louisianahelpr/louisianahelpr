-- Fix the return shape of the two masked-job RPCs added moments ago.
--
-- They compiled and deployed clean, but threw on first call:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type jobs does not match expected type uuid in column 1
--
-- `RETURN QUERY` in PL/pgSQL matches the query's COLUMNS against the declared
-- SETOF row type -- it does not accept a single column that happens to be the
-- composite. `SELECT jsonb_populate_record(...)` is one column of type `jobs`,
-- so Postgres compared `jobs` against the first column of `jobs` (`id uuid`)
-- and refused.
--
-- The fix is to expand the projected record: build it once in a LATERAL, then
-- `SELECT (r.rec).*`. Behaviour is otherwise identical, and this shape was
-- verified against live prod rows before shipping -- seed helper 1102, a
-- pending applicant on job ...0002, now reads "Delcambre, LA" where the raw
-- row says "1408 Rue Beauregard, Delcambre, LA 70528".
--
-- REPLAY-SAFETY: CREATE OR REPLACE over functions defined by an earlier
-- migration; references nothing defined later.

CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (r.rec).*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT jsonb_populate_record(
             NULL::public.jobs,
             to_jsonb(j) || jsonb_build_object(
               'location',
               CASE
                 WHEN j.customer_id = v_uid OR j.helper_id = v_uid THEN j.location
                 ELSE public.mask_job_location(j.location)
               END
             )
           ) AS rec
  ) r
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
        );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (r.rec).*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT jsonb_populate_record(
             NULL::public.jobs,
             to_jsonb(j) || jsonb_build_object(
               'location',
               CASE
                 WHEN j.customer_id = v_uid OR j.helper_id = v_uid THEN j.location
                 ELSE public.mask_job_location(j.location)
               END
             )
           ) AS rec
  ) r
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
  ORDER BY j.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated;
