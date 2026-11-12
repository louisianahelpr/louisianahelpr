-- F268a (owner 11-12, OWNER-DECISIONS: "a signed-out visitor opening a shared job link sees a FULL read-only job page
-- with the description and Sign up to apply ... Still no poster, address or coordinates (9-2 rule)").
--
-- The description has always been a column of open_jobs_browse, and anon could already select it; the guest page now
-- prints it. A poster's free text can carry a phone number or a street address, so a GUEST's copy is masked here, on the
-- server, before it leaves the database:
--   1. public.mask_guest_contact(text): a US phone number becomes "[phone hidden]" and a numbered street address
--      ("12 Oak St", "9816 Lake Peigneur Rd") becomes "[address hidden]". Pure text in, text out (IMMUTABLE, SQL,
--      no table reads). Anon executes it because a view's functions run with the caller's EXECUTE (the same grant
--      mask_job_location has).
--   2. open_jobs_browse is the newest definition (20261104074500) with exactly one change: `description` reads
--      mask_guest_contact(description) when CURRENT_USER is anon (the same test the view already uses for
--      customer_id). Members read the text as before. Same columns in the same order, same rows (the WHERE is
--      unchanged: open, funded, non-seed-hidden jobs only), still a definer view.
-- Grants restated as the newest migration states them.

CREATE OR REPLACE FUNCTION public.mask_guest_contact(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN t IS NULL OR t = '' THEN t
    ELSE regexp_replace(
      regexp_replace(
        t,
        '(\+?1[\s.-]*)?\(?\m\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\M',
        '[phone hidden]', 'g'),
      '\m\d{1,6}\s+(?:[A-Za-z0-9.''-]+\s+){0,3}(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|boulevard|hwy|highway|ct|court|cir|circle|pl|place|way|pkwy|parkway|trl|trail|loop|cv|cove)\M\.?',
      '[address hidden]', 'gi')
  END;
$function$;

REVOKE ALL ON FUNCTION public.mask_guest_contact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mask_guest_contact(text) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(description) ELSE description END AS description,
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
    materials_note,
    helper_fee_flat_cents,
    helper_fee_percent,
    scope_video_url,
    date_window_end
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND (date_needed IS NULL OR (CASE WHEN start_time IS NULL THEN ((COALESCE(date_window_end, date_needed) + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((COALESCE(date_window_end, date_needed) + start_time) AT TIME ZONE 'America/Chicago') END) > now()) AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)));

-- open_jobs_browse's grants, as its newest migration (20261104074500) states them.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
