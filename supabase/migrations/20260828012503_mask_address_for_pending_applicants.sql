-- The street address must not be readable until the helper is ACCEPTED.
--
-- `jobs.location` stores the FULL street address — `jobSubmitHelpers.ts`
-- composes it as "<street>, <city>, <state> <zip>". Public browsing is already
-- safe: `get_ranked_open_jobs` and `get_open_jobs_for_map` both wrap it in
-- `public.mask_job_location()`, which coarsens it to "City, ST".
--
-- But two RLS SELECT policies on `jobs` hand out the RAW row — and RLS is
-- row-level, so once a policy grants the row PostgREST returns every column
-- regardless of what the UI renders:
--
--   "Applicants can view their pending applied jobs"
--       (status = 'open' AND user_has_pending_application(id, auth.uid()))
--     Anyone may apply to any open job, so ANY helper could obtain ANY
--     poster's home address simply by applying.
--
--   "Targeted helper can view direct offer"
--       (offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending')
--     Reads the raw row before the offer is accepted.
--
-- This migration adds the replacement read path. The policies themselves are
-- dropped in the FOLLOWING migration, so that the client can be switched over
-- first and there is no window where an already-deployed build loses its job
-- rows.
--
-- Mechanism: mirror what the browse RPCs already do — a SECURITY DEFINER
-- function that projects the job row with `public.mask_job_location(location)`
-- substituted in. `RETURNS SETOF public.jobs` keeps the exact row shape the
-- client already consumes (and the generated TS type), and the
-- `jsonb_populate_record` projection means a future column added to `jobs`
-- flows through without touching this function.
--
-- The full address is still returned when the caller is the poster
-- (`customer_id`) or the ASSIGNED helper (`helper_id`) — those parties are
-- entitled to it and already get it from the "Users can view their own jobs"
-- policy, which is unchanged. Admins are likewise unchanged.

-- ---------------------------------------------------------------------------
-- Jobs behind MY applications.
--
-- Row set is exactly what the two policies + "Users can view their own jobs"
-- grant today for the client's `.in("id", <my application job ids>)` read:
--   * I am the poster or the assigned helper   → full address
--   * the job is still open and I have applied → masked "City, ST"
--   * anything else                            → not returned (same as today,
--     where RLS denies it and the card renders with `job: null`)
-- ---------------------------------------------------------------------------
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
  SELECT jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE
               WHEN j.customer_id = v_uid OR j.helper_id = v_uid THEN j.location
               ELSE public.mask_job_location(j.location)
             END
           )
         )
  FROM public.jobs j
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

-- ---------------------------------------------------------------------------
-- Direct offers extended to ME and still awaiting my response.
--
-- Same row set as the "Targeted helper can view direct offer" policy, ordered
-- the way the client already orders it, with the address masked. Accepting the
-- offer sets `helper_id = me` (server-side, in `respond_to_direct_offer`), at
-- which point "Users can view their own jobs" hands over the full address.
-- ---------------------------------------------------------------------------
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
  SELECT jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE
               WHEN j.customer_id = v_uid OR j.helper_id = v_uid THEN j.location
               ELSE public.mask_job_location(j.location)
             END
           )
         )
  FROM public.jobs j
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
  ORDER BY j.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated;
