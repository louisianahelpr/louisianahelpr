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
--   3. get_ranked_open_jobs (SECURITY DEFINER, anon EXECUTE, no app caller today but callable over REST) returned the
--      raw description to anyone (lh-authz-rls review of this branch). It is its newest definition (20261104080753)
--      with one change: description is mask_guest_contact(description) when auth.uid() IS NULL. Inside a definer
--      function CURRENT_USER is the owner, so the session test is auth.uid(). Same signature and return columns, so
--      CREATE OR REPLACE; grants and COMMENT restated as 20261104080753 states them.
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

-- 3. get_ranked_open_jobs: the newest definition (20261104080753) with the guest copy of the description.
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
  SELECT id, title, CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(description) ELSE description END AS description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
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
