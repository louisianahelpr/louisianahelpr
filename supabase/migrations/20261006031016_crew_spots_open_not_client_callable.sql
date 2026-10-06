-- Q1409, lh-authz-rls review of c5785c40d (2026-10-05, low): public.crew_spots_open
-- was granted to anon and authenticated (open_jobs_browse called it, and a
-- security_invoker = false view still checks function EXECUTE as the caller),
-- but its body has none of the browse exclusions (seed hiding, early access,
-- credential tier, direct offer, funded). So anyone holding a job's UUID could
-- learn whether it exists (NULL vs 0) and its empty-spot count, hidden and
-- seed jobs included.
--
-- Fix (the reviewer's preferred one): open_jobs_browse counts the spots INLINE
-- (the same expression as crew_spots_open, over the view's own columns; the
-- view reads jobs and group_job_helpers as its owner), and crew_spots_open is
-- no longer client-callable. Every other caller of it is SECURITY DEFINER
-- (get_ranked_open_jobs, get_open_jobs_for_map, get_public_open_jobs,
-- apply_to_job, enforce_application_job_state, get_jobs_for_my_applications)
-- and so runs it as its owner. The view now exposes a crew's open-spot count
-- only on a row the browse exclusions already admit.
--
-- open_jobs_browse is restated from 20261006023437 with only the two
-- crew_spots_open(id) calls replaced (security_invoker = false kept; grants
-- restated). Replay-safe: CREATE OR REPLACE VIEW (same columns), REVOKE/GRANT.
-- Proof: src/test/pglite/crewSpotsOpenPrivate.pglite.mjs (--before is red).
-- Guard: src/test/crewFreeSpotRelisted.test.ts.

REVOKE ALL ON FUNCTION public.crew_spots_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO service_role;

-- open_jobs_browse, restated from 20261006023437 with the open-spot count inline.
DO $view$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;
  EXECUTE $v$
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok,
        CASE
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier)
$v$;
END
$view$;

-- Browse is read-only to clients (20260923205337). CREATE OR REPLACE keeps the
-- grants; restated so a replay from scratch ends in the same place.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
