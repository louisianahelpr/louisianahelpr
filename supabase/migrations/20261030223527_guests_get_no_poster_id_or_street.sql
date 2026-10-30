-- Guests shared a job link can now open the job (owner, 10-30, reversing the
-- 2026-09-02 sign-in rule). Two private things the public read still carried
-- are closed here, by the lead's decision of 10-30.
--
-- 1. open_jobs_browse.customer_id reads NULL for a signed-out visitor (role anon).
--    It was the poster's account id, readable and filterable with the public key.
--    Everyone else keeps it: a member's own-job check compares it to their id,
--    and service_role and definer functions read the view with no auth.uid(), so
--    the test is the role and not auth.uid(). The row rules below still read the
--    table's column, so a guest sees the same rows, and `customer_id=eq.<id>` from
--    a guest now matches nothing.
--    The body is the newest definition, 20261029194021_browse_carries_scope_video.sql,
--    verbatim but for that one column (its column list and WHERE equal the live
--    pg_get_viewdef read 10-30). Still security_invoker = false, same order, same
--    types, grants restated as live.
--    What a guest loses: the rating badge and tier placement on /browse, which
--    looked the poster up by this id. The feed already handles a null id (a
--    deleted poster) as "no enrichment" (DashboardGuest.tsx).
--
-- 2. mask_job_location kept a street whenever an address had exactly two parts:
--    "123 Main St, Lafayette" came back whole. Two parts now keep "town, state"
--    only when the last part really is a state and the first holds no digit;
--    otherwise the last part alone. A single part with a digit ("123 Main St")
--    is NULL: it can only be a street. Three or more parts are unchanged.
--    Measured on prod 10-30: of 18 real jobs' addresses, 0 have two parts and 0
--    have one, so no job's shown town changes today.

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
    CASE WHEN CURRENT_USER = 'anon'::name THEN NULL::uuid ELSE customer_id END AS customer_id,
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
    scope_video_url
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND (date_needed IS NULL OR (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > now()) AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)));

-- open_jobs_browse's grants, as its newest migration (20261029194021) states them.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mask_job_location(loc text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT string_to_array(loc, ',') AS parts,
           array_length(string_to_array(loc, ','), 1) AS n,
           trim(split_part(loc, ',', 1)) AS first_part,
           trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1) - 1)) AS town,
           regexp_replace(
             trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1))),
             '\s*\d{5}(-\d{4})?\s*$', ''
           ) AS last_part
  )
  SELECT CASE
    WHEN loc IS NULL OR loc = '' THEN loc
    WHEN p.n >= 3 THEN p.town || ', ' || p.last_part
    WHEN p.n = 2 AND p.last_part = '' THEN
      CASE WHEN p.first_part ~ '\d' THEN NULL ELSE p.first_part END
    WHEN p.n = 2 AND (p.last_part ~ '^[A-Z]{2}$' OR p.last_part ~* '^(la|louisiana)$') AND p.first_part !~ '\d' THEN
      p.first_part || ', ' || p.last_part
    WHEN p.n = 2 THEN p.last_part
    WHEN loc ~ '\d' THEN NULL
    ELSE loc
  END
  FROM p;
$function$;
