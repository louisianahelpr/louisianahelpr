-- F268a follow-up (lead 11-14, Builder 2): a guest's copy of an open job masks contact details in EVERY free-text field
-- a guest can read, not only the description, and masks email addresses too.
--
-- 20261112202620 masked phones and numbered street addresses in open_jobs_browse.description (and the ranked feed's)
-- for a signed-out caller. A poster can type the same things into the title, the special requirements and the
-- materials note, which anon could read raw from the same view; and an email address passed through everywhere.
--   1. public.mask_guest_contact(text): also turns an email address into "[email hidden]" (first, so an address's
--      digits are never half-read as a phone number). Still pure IMMUTABLE SQL, no table reads; grants restated.
--   2. open_jobs_browse: the 20261112202620 definition with three more columns read through the mask when
--      CURRENT_USER is anon: title, special_requirements, materials_note. Same columns in the same order, same rows,
--      still a definer view; grants restated.
--   3. get_ranked_open_jobs (anon EXECUTE): the 20261112202620 definition with title and special_requirements masked
--      when auth.uid() IS NULL (the session test inside a definer function). Grants and COMMENT restated.
--   4. get_open_jobs_for_map (anon EXECUTE): the 20261110210539 definition with the title masked for a guest.
--   5. get_public_open_jobs (anon EXECUTE, the landing teaser): the 20261104084501 definition with the title masked
--      for a guest.
--   6. public_profile_by_handle (anon EXECUTE, /u/<handle> prints each open job's title to guests): the
--      20261105165059 definition with the open jobs' title masked for a guest (lh-authz-rls review of this change).
-- Members read every field as before. Same signatures and result columns, so CREATE OR REPLACE throughout.
-- Not text, so not masked here: the job's photos and scope video (open_jobs_browse still returns photos and
-- scope_video_url to anon; the guest page prints neither).

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
        regexp_replace(
          t,
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}',
          '[email hidden]', 'g'),
        '(\+?1[\s.-]*)?\(?\m\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\M',
        '[phone hidden]', 'g'),
      '\m\d{1,6}\s+(?:[A-Za-z0-9.''-]+\s+){0,3}(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|boulevard|hwy|highway|ct|court|cir|circle|pl|place|way|pkwy|parkway|trl|trail|loop|cv|cove)\M\.?',
      '[address hidden]', 'gi')
  END;
$function$;

REVOKE ALL ON FUNCTION public.mask_guest_contact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mask_guest_contact(text) TO anon, authenticated, service_role;

-- 2. open_jobs_browse: 20261112202620's definition, title / special_requirements / materials_note masked for anon.
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(title) ELSE title END AS title,
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

-- open_jobs_browse's grants, as its newest migration (20261112202620) states them.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- 3. get_ranked_open_jobs: 20261112202620's definition, title and special_requirements masked for a guest.
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text, helper_fee_flat_cents integer, helper_fee_percent numeric, date_window_end date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode, j.helper_fee_flat_cents, j.helper_fee_percent,
      j.date_window_end,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates, the identical
      -- masked pair open_jobs_browse already publishes.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED (20260901031421, 20260915051752).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            -- Q1848 (2): no poster boost while memberships are off for the poster.
            WHEN NOT public.feature_enabled_for_user('memberships', j.customer_id) THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'plus'  THEN 2.5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
      -- A series visit is re-offered only inside its series (20260927015010).
      AND j.parent_job_id IS NULL
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      -- Q2408: a window job stays listed until its window's LAST day (NULL end = one-day job, as before).
      AND (j.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now())
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Q1411: not while the poster is under an open ban settlement review.
      AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  )
  -- F268a: a caller with no session (anon over REST) gets the guest copy, as from open_jobs_browse.
  SELECT id, CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(title) ELSE title END AS title,
    CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(description) ELSE description END AS description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos,
    CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(special_requirements) ELSE special_requirements END AS special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term, so distance cannot be recovered
    -- by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band,
    -- Q1839: the jobs flat-fee stamp (roadmap F3), so a flat job's pay is
    -- priced 5% + 70c, never the viewer's tier.
    helper_fee_flat_cents,
    -- Q2400: and the percent stamped with it, so a job funded at 5% is never
    -- priced at the newer 10% default.
    helper_fee_percent,
    -- Q2408: the window's last day, so a card prints "Any day Nov 4-10".
    date_window_end
  FROM scored
  WHERE
    -- Radius filter. An unevaluable radius KEEPS the row.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term orders the feed and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unknown distance is NEUTRAL (the middle band), never "far".
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$
;

REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) IS
  'Public /jobs feed, ranked. The distance term is applied in ORDER BY only and '
  'is deliberately absent from the returned rank_score: every other term is '
  'derivable from fields in the same row, so returning it would hand back the '
  'exact distance by subtraction. Distance is measured against the job''s '
  '2dp-rounded coordinates — the same masked pair open_jobs_browse already '
  'publishes — so probing p_lat/p_lng for band boundaries cannot resolve a job '
  'more precisely than the app already discloses. distance_band is a band, '
  'never a number.';

-- 4. get_open_jobs_for_map: 20261110210539's definition, title masked for a guest.
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone, helper_fee_flat_cents integer, helper_fee_percent numeric, date_window_end date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  )
  SELECT
    j.id,
    -- Guest copy (20261114234033): a signed-out caller reads the title with contact details masked.
    CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END AS title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ~ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep.
    -- Owner bug 2026-11-10: a job whose address never geocoded is pinned at its ZIP's centroid, else its parish's
    -- (area.*), never dropped. jobs.latitude/longitude stay NULL: they mean "the address", and the arrival check
    -- trusts them.
    ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.latitude ELSE area.latitude END, 2) AS latitude,
    ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.longitude ELSE area.longitude END, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    j.boost_expires_at,
    j.expires_at,
    -- Q1839: the jobs flat-fee stamp (roadmap F3); the pin popup's JobCard
    -- prices a flat job 5% + 70c from it, never the viewer's tier.
    j.helper_fee_flat_cents,
    -- Q2400: and the percent stamped with it (a 5% job is never priced at 10%).
    j.helper_fee_percent,
    -- Q2408: the window's last day, so the pin popup prints "Any day Nov 4-10".
    j.date_window_end
  FROM public.jobs j
  CROSS JOIN cutoff
  -- Only for a job with no coordinate pair: its ZIP's centroid (louisiana_zip_parishes, 20260907051306), else the
  -- middle of its parish's ZIP centroids.
  LEFT JOIN LATERAL (
    SELECT COALESCE(zc.latitude, pc.latitude) AS latitude, COALESCE(zc.longitude, pc.longitude) AS longitude
      FROM (SELECT z.latitude, z.longitude FROM public.louisiana_zip_parishes z
             WHERE z.zip_code = left(regexp_replace(j.zip_code, '\D', '', 'g'), 5)
               AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL
             LIMIT 1) zc
      FULL JOIN (SELECT avg(z.latitude) AS latitude, avg(z.longitude) AS longitude FROM public.louisiana_zip_parishes z
                  WHERE lower(z.parish) = lower(btrim(regexp_replace(j.parish, '\s+Parish\s*$', '', 'i')))
                    AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL) pc ON true
     WHERE j.latitude IS NULL OR j.longitude IS NULL
  ) area ON true
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND ((j.latitude IS NOT NULL AND j.longitude IS NOT NULL) OR (area.latitude IS NOT NULL AND area.longitude IS NOT NULL))
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Q2408: a window job stays on the map until its window's LAST day (NULL end = one-day job, as before).
    AND (j.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now())
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;

-- 5. get_public_open_jobs: 20261104084501's definition, title masked for a guest.
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  SELECT j.id,
         -- Guest copy (20261114234033): a signed-out caller reads the title with contact details masked.
         CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END AS title,
         j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent,
         (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) AS is_boosted
  FROM public.jobs j
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    -- Funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed IS NOT NULL
    -- Q2408: a window job stays on the landing teaser until its window's LAST day.
    AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- BD-002: Early Access, on the SAME shared authority the other three
    -- discovery surfaces use. No offered_to_helper_id escape hatch here: the
    -- line above already withholds every job under a live direct offer.
    AND j.created_at <= public.early_access_cutoff()
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

REVOKE ALL ON FUNCTION public.get_public_open_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated, service_role;

-- 6. public_profile_by_handle: 20261105165059's definition, the open jobs' title masked for a guest.
CREATE OR REPLACE FUNCTION public.public_profile_by_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_p record;
  v_stats jsonb;
  v_listings jsonb;
  v_jobs jsonb;
  v_reviews jsonb;
  v_categories jsonb;
  v_done integer;
  v_wanted jsonb;
  v_declutter boolean;
  v_wanted_on boolean;
  v_listing_count integer;
  v_job_count integer;
  v_review_total integer;
  v_review_avg numeric;
BEGIN
  IF v_handle = '' OR length(v_handle) > 30 THEN
    RETURN NULL;
  END IF;

  SELECT p.user_id, p.full_name, p.avatar_url, p.created_at, p.handle, p.show_in_search,
         p.bio, p.location, p.skills, p.portfolio_urls,
         p.is_licensed, p.license_status, p.is_insured, p.insurance_status, p.business_name INTO v_p
    FROM public.profiles p
   WHERE p.handle = v_handle
      OR (p.handle IS NOT NULL
          AND p.user_id = (SELECT r.user_id FROM public.profile_handles_retired r
                            WHERE r.handle = v_handle AND r.user_id IS NOT NULL))
   ORDER BY (p.handle = v_handle) DESC
   LIMIT 1;
  IF v_p.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Review 2026-11-01: banned in any form, restricted (out of Declutter), deleted, unverified,
  -- seed, test or under 18 -> no page.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = v_p.user_id
                    AND p.email_verified
                    AND p.ban_status IS DISTINCT FROM 'banned'
                    AND p.ban_status IS DISTINCT FROM 'temp_banned'
                    AND p.ban_status IS DISTINCT FROM 'permanently_banned'
                    AND p.is_seed IS NOT TRUE
                    AND p.anonymized_at IS NULL)
     OR public.declutter_member_out(v_p.user_id)
     OR COALESCE(public.member_under_18(v_p.user_id), true)
     OR public.is_test_member(v_p.user_id) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'review_count', s.review_count,
           'avg_rating', s.avg_rating,
           'completed_jobs_as_helper', s.completed_jobs_as_helper,
           'completed_jobs_total', s.completed_jobs_total,
           'posted_jobs_total', s.posted_jobs_total,
           'on_time_rate', s.on_time_rate,
           'repeat_hire_percent', s.repeat_hire_percent,
           'is_id_verified', s.is_id_verified,
           'is_background_checked', s.is_background_checked)
    INTO v_stats
    FROM public.get_public_profile_stats(ARRAY[v_p.user_id]) s
   WHERE s.user_id = v_p.user_id
   LIMIT 1;

  v_declutter := public.declutter_open_to_guests();
  -- Wanted posts only while their own switch is open to everyone too (it is testers-only until then).
  v_wanted_on := v_declutter AND EXISTS (SELECT 1 FROM public.feature_switches s
                                          WHERE s.key = 'declutter_wanted' AND s.audience = 'everyone');

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'live_at' DESC), '[]'::jsonb) INTO v_listings
    FROM (
      SELECT jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'price_cents', i.current_price_cents,
               'area_label', i.area_label,
               'live_at', coalesce(i.live_at, i.created_at),
               'photo_id', (SELECT ph.id FROM public.declutter_item_photos ph
                             WHERE ph.item_id = i.id ORDER BY ph.position LIMIT 1)) AS x
        FROM public.declutter_items i
       WHERE v_declutter
         AND i.seller_id = v_p.user_id
         AND i.status = 'live'
         AND NOT i.seller_hidden
         AND i.is_seed IS NOT TRUE
         AND NOT public.declutter_seller_out(v_p.user_id)
       ORDER BY coalesce(i.live_at, i.created_at) DESC
       LIMIT 500
    ) l;

  -- Owner request 11-05 ("the link doesn't show all items listed"): the page said nothing past the first 24. Every
  -- live item now comes back (500 at most; 201 measured at 4 ms on prod), and the true count under the same rules.
  SELECT count(*)::integer INTO v_listing_count
    FROM public.declutter_items i
   WHERE v_declutter
     AND i.seller_id = v_p.user_id
     AND i.status = 'live'
     AND NOT i.seller_hidden
     AND i.is_seed IS NOT TRUE
     AND NOT public.declutter_seller_out(v_p.user_id);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'date_needed'), '[]'::jsonb) INTO v_jobs
    FROM (
      SELECT jsonb_build_object(
               'id', j.id,
               -- Guest copy (20261114234033): a signed-out caller reads the title with contact details masked.
               'title', CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END,
               'category', j.category::text,
               'town', public.mask_job_location(j.location),
               'budget', j.budget,
               'date_needed', j.date_needed) AS x
        FROM public.jobs j
       WHERE j.customer_id = v_p.user_id
         AND j.status = 'open'
         AND j.parent_job_id IS NULL
         AND j.is_seed IS NOT TRUE
         AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
         AND COALESCE(j.credential_tier, 0) = 0
         AND j.date_needed IS NOT NULL
         AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
         AND (j.expires_at IS NULL OR j.expires_at > now())
         AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status IS DISTINCT FROM 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                          WHERE q.user_id = j.customer_id AND q.review_state = 'open')
       ORDER BY j.date_needed
       LIMIT 100
    ) o;
  v_job_count := jsonb_array_length(v_jobs);

  SELECT count(*)::integer,
         coalesce(jsonb_agg(DISTINCT j.category::text) FILTER (WHERE j.category IS NOT NULL), '[]'::jsonb)
    INTO v_done, v_categories
    FROM public.jobs j
   WHERE j.helper_id = v_p.user_id
     AND j.status = 'completed'
     AND j.is_seed IS NOT TRUE
     AND NOT public.is_test_member(j.customer_id);

  -- Re-review 2026-11-01: the list is read here, not through get_public_profile_reviews, whose seed rule reads the
  -- caller (seed_hidden_from_caller), so test reviews showed to an admin, to test accounts, and to everyone while
  -- the seed switch is off. Same rules as the stats' review count (get_public_profile_stats.visible_reviews):
  -- published and visible, not on a cancelled or seed job, not from or about a test member; for every caller.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'rating', r.rating,
           'feedback', r.feedback,
           'created_at', r.created_at,
           'reviewer_name', public.member_display_name(r.reviewer_full_name),
           'job_category', r.job_category,
           'response_text', r.response_text,
           'response_at', r.response_at) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_reviews
    FROM (
      SELECT rv.rating, public.review_text(rv.feedback, rv.tags) AS feedback, rv.created_at, rv.response_text, rv.response_at, j.category::text AS job_category,
             -- The reviewer's public name only under the same rules as a page of their own (review 2026-11-01):
             -- verified, never banned in any form, not out of Declutter, not deleted, not under 18; else "A neighbor".
             (SELECT rp.full_name FROM public.profiles rp
               WHERE rp.user_id = rv.reviewer_id
                 AND rp.email_verified
                 AND rp.ban_status IS DISTINCT FROM 'banned'
                 AND rp.ban_status IS DISTINCT FROM 'temp_banned'
                 AND rp.ban_status IS DISTINCT FROM 'permanently_banned'
                 AND rp.anonymized_at IS NULL
                 AND NOT public.declutter_member_out(rp.user_id)
                 AND NOT COALESCE(public.member_under_18(rp.user_id), true)
               LIMIT 1) AS reviewer_full_name
        FROM public.reviews rv
        JOIN public.jobs j ON j.id = rv.job_id
       WHERE rv.reviewee_id = v_p.user_id
         AND rv.status = 'published'
         AND rv.feedback_visible_at IS NOT NULL
         AND rv.feedback_visible_at <= now()
         AND j.status <> 'cancelled'
         AND j.is_seed IS NOT TRUE
         AND NOT public.is_test_member(rv.reviewer_id)
         AND NOT public.is_test_member(rv.reviewee_id)
         AND NOT public.profile_review_same_person(rv.reviewer_id, rv.reviewee_id)
       ORDER BY rv.created_at DESC
       LIMIT 100
    ) r;

  -- Owner 11-05 (L4): a review between two accounts of one person (the same phone) never shows and never counts.
  -- M2: the true total under the list's own rules, and the stars from the same rows, so count, stars and list agree.
  SELECT count(*)::integer, round(avg(rt.rating)::numeric, 2)
    INTO v_review_total, v_review_avg
    FROM public.reviews rt
    JOIN public.jobs jt ON jt.id = rt.job_id
   WHERE rt.reviewee_id = v_p.user_id
     AND rt.status = 'published'
     AND rt.feedback_visible_at IS NOT NULL
     AND rt.feedback_visible_at <= now()
     AND jt.status <> 'cancelled'
     AND jt.is_seed IS NOT TRUE
     AND NOT public.is_test_member(rt.reviewer_id)
     AND NOT public.is_test_member(rt.reviewee_id)
     AND NOT public.profile_review_same_person(rt.reviewer_id, rt.reviewee_id);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_wanted
    FROM (
      SELECT jsonb_build_object(
               'id', w.id,
               'what', w.what,
               'category', w.category,
               'max_price_cents', w.max_price_cents,
               'created_at', w.created_at) AS x
        FROM public.declutter_wanted w
       WHERE v_wanted_on
         AND w.user_id = v_p.user_id
         AND w.status = 'open'
         AND w.public
         AND w.removed_at IS NULL
         AND w.expires_at > now()
         AND w.is_seed IS NOT TRUE
         -- The same poster rules as the Wanted browse (20261030225143).
         AND NOT public.declutter_member_out(w.user_id)
         AND NOT public.member_under_18(w.user_id)
         AND NOT public.declutter_seller_hidden(w.user_id)
       ORDER BY w.created_at DESC
       LIMIT 100
    ) wq;

  RETURN jsonb_build_object(
    'handle', v_p.handle,
    'name', public.member_display_name(v_p.full_name),
    'photo_url', v_p.avatar_url,
    'member_since', v_p.created_at,
    -- Owner request 11-05 ("it should be a full profile showing everything"): the fields get_safe_profiles already
    -- gives any caller, signed out included, under the same rules: bio, town (profiles.location holds a town name),
    -- skills, Recent work photos (public avatars bucket), and the license/insurance badges; the business name only
    -- with a verified badge, exactly as get_safe_profiles.
    'bio', nullif(btrim(coalesce(v_p.bio, '')), ''),
    'town', nullif(btrim(coalesce(v_p.location, '')), ''),
    'skills', nullif(btrim(coalesce(v_p.skills, '')), ''),
    'portfolio_urls', to_jsonb(coalesce(v_p.portfolio_urls, ARRAY[]::text[])),
    'licensed', (v_p.is_licensed AND v_p.license_status = 'verified'),
    'insured', (v_p.is_insured AND v_p.insurance_status = 'verified'),
    'business_name', CASE
                       WHEN (v_p.is_licensed AND v_p.license_status = 'verified')
                         OR (v_p.is_insured AND v_p.insurance_status = 'verified')
                       THEN v_p.business_name
                     END,
    'listing_count', coalesce(v_listing_count, 0),
    'show_in_search', coalesce(v_p.show_in_search, false),
    'job_count', coalesce(v_job_count, 0),
    -- The page's count and stars are this page's reviews (same-person ones out), not get_public_profile_stats' own.
    'stats', coalesce(v_stats, '{}'::jsonb)
             || jsonb_build_object('review_count', coalesce(v_review_total, 0), 'avg_rating', v_review_avg),
    'listings', v_listings,
    'jobs', v_jobs,
    'helpr', jsonb_build_object('jobs_done', v_done, 'categories', v_categories, 'reviews', v_reviews,
                               'review_total', coalesce(v_review_total, 0)),
    'wanted', v_wanted);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_profile_by_handle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO anon, authenticated, service_role;
