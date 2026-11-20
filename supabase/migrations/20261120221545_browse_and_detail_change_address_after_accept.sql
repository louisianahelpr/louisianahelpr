-- Two more paths that handed a Helpr who has not accepted the job's street address (owner 2026-11-20: the address only
-- once the poster is verified AND the Helpr accepted; 20261120205350), found by the lh-authz-rls re-review:
--   1. open_jobs_browse returned the raw location to a pending direct offer's offeree
--      (`WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending' THEN location`). The view lists only
--      jobs nobody has accepted (open, or a crew still filling), so it is the town (mask_job_location) for everyone; the
--      poster and an accepted Helpr read the street from jobs itself. Restated from 20261114234033 with ONLY that
--      column changed: same columns, order and rows, still a definer view; grants restated.
--   2. job_detail_change_requests (old_location, new_location, new_latitude, new_longitude) is readable through
--      can_read_job_detail_change by every Helpr with an answer row, and request_job_detail_change gives one to
--      everyone in job_booked_helpr_ids: the job's helper_id (set at the OFFER) and every crew seat, confirmed or not.
--      Targeted fix: can_read_job_detail_change admits a Helpr's answer row only while that Helpr has accepted
--      (jobs.helper_confirmed_at, or a confirmed crew seat). job_booked_helpr_ids is NOT narrowed: the job-photo rules
--      (helpr_job_after_photos, job_photos_withheld, job_photos_shareable) and the detail-change lock also read it.
--      No client reads either table (the app goes through the definer RPCs), so nothing on screen changes.
--   3. (Review question) can_read_job_access_notes' recurring_helper_id branch needs no gate: recurring_helper_id is
--      set only by stamp_recurring_series_helper, which copies helper_id once helper_confirmed_at is set, and
--      enforce_hire_columns_rpc_only refuses any client write that names someone else.
-- Replay-safe (CREATE OR REPLACE). Guard: src/test/posterIdAtOffer.test.ts; proof: src/test/pglite/posterIdAtOffer.pglite.mjs.

-- 1. open_jobs_browse: 20261114234033's definition, location masked for everyone.
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(title) ELSE title END AS title,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(description) ELSE description END AS description,
    category,
    budget,
    date_needed,
        -- CHANGED (owner 2026-11-20, 20261120205350): never the street, the offeree included, the town for everyone.
        mask_job_location(location) AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(special_requirements) ELSE special_requirements END AS special_requirements,
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
    CASE WHEN CURRENT_USER = 'anon'::name THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE customer_id END AS customer_id,
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
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(materials_note) ELSE materials_note END AS materials_note,
    helper_fee_flat_cents,
    helper_fee_percent,
    scope_video_url,
    date_window_end
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND (date_needed IS NULL OR (CASE WHEN start_time IS NULL THEN ((COALESCE(date_window_end, date_needed) + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((COALESCE(date_window_end, date_needed) + start_time) AT TIME ZONE 'America/Chicago') END) > now()) AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)));

-- open_jobs_browse's grants, as its newest migration (20261114234033) states them.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- 2. can_read_job_detail_change: 20261007113957's definition; a Helpr's answer row counts only once they accepted.
CREATE OR REPLACE FUNCTION public.can_read_job_detail_change(_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.job_detail_change_requests r
             WHERE r.id = _request_id AND r.requested_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_detail_change_answers a
                JOIN public.job_detail_change_requests r ON r.id = a.request_id
                WHERE a.request_id = _request_id AND a.helper_id = auth.uid()
                  -- CHANGED (owner 2026-11-20): only a Helpr who accepted (or confirmed a crew seat) reads the change's address.
                  AND (EXISTS (SELECT 1 FROM public.jobs j
                                WHERE j.id = r.job_id AND j.helper_id = auth.uid() AND j.helper_confirmed_at IS NOT NULL)
                       OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                                   WHERE g.job_id = r.job_id AND g.helper_id = auth.uid() AND g.helper_confirmed_at IS NOT NULL)))
  );
$fn$;
REVOKE ALL ON FUNCTION public.can_read_job_detail_change(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_job_detail_change(uuid) TO authenticated, service_role;
