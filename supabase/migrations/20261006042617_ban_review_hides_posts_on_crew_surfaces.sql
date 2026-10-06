-- Q1411 (owner 2026-10-05): while an account is under an OPEN ban settlement
-- review its open posts leave every browse surface and take no new
-- application; the applicant sees the same neutral "This job is no longer
-- available." as any withdrawn post.
--
-- WHY A SEPARATE MIGRATION. 20261006030849 first carried these five
-- definitions, written against the pre-crew bodies. The crew batch (Q1378,
-- Q1409) landed first and restated the same five in 20261006023437 and
-- 20261006031016 (a booked crew's free spot is re-listed until its start).
-- Deployed after them, the older bodies would have dropped the re-listing.
-- So 20261006030849 no longer defines them, and this file restates the
-- crew-era bodies (verbatim from those two migrations) plus the one Q1411
-- clause each: C13 in enforce_application_job_state, and NOT EXISTS (open
-- review on the poster) in open_jobs_browse, get_ranked_open_jobs,
-- get_open_jobs_for_map and get_public_open_jobs.
--
-- Replay-safe: CREATE OR REPLACE throughout; the view goes through the same
-- to_regclass guard as 20261006031016; grants restated as those files did.
-- Proof: src/test/pglite/banEvasionCardBankName.pglite.mjs (hidden posts),
-- src/test/banReviewHidesPostsOnCrewSurfaces.test.ts (each clause is present
-- in this file's bodies and the crew re-listing survives).

-- ── open_jobs_browse ─────────────────────────────────────────────────────────
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
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)))
$v$;
END
$view$;

-- Browse is read-only to clients (20260923205337). CREATE OR REPLACE keeps the
-- grants; restated so a replay from scratch ends in the same place.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- ── get_ranked_open_jobs ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text)
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
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode,
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
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Q1411: not while the poster is under an open ban settlement review.
      AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
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
    END AS distance_band
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
$function$;
REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;

-- ── get_open_jobs_for_map ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ~ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    j.boost_expires_at,
    j.expires_at
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
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
REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;

-- ── get_public_open_jobs ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  SELECT j.id, j.title, j.category::text,
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
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed >= CURRENT_DATE
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

-- ── enforce_application_job_state (C13) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.expires_at,
         j.parent_job_id
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C3 (2026-09-21). You cannot apply to your own post. See the header: the
  -- INSERT policy never named customer_id, no constraint covered it, and the
  -- only enforcement lived inside the apply_to_job RPC — which the client's
  -- own PGRST202 fallback, and any direct PostgREST call, goes around.
  --
  -- Deliberately BEFORE the status/early-access/date checks: whatever else is
  -- wrong with the job, this is the reason the person can act on.
  --
  -- Compared against NEW.helper_id rather than auth.uid() so it holds for the
  -- SECURITY DEFINER paths too (apply_to_job, respond_to_direct_offer), where
  -- a row could be written for a helper_id other than the caller. A poster who
  -- direct-offers a job to themselves is refused here as well, which is
  -- correct: the row that offer would create is still a self-application.
  IF v_job.customer_id = NEW.helper_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job'
      USING ERRCODE = '42501',
            HINT = 'You posted this job, so you cannot also apply to it.';
  END IF;

  -- C10 (2026-09-24, Q341). No application across a block, in either
  -- direction. The INSERT policy already said so, but apply_to_job is SECURITY
  -- DEFINER and never reaches the policy; this trigger is on every path. The
  -- code does not say who blocked whom — the helper gets the same sentence
  -- either way.
  IF public.are_users_blocked(NEW.helper_id, v_job.customer_id) THEN
    RAISE EXCEPTION 'applicant_blocked'
      USING ERRCODE = '42501',
            HINT = 'This job is not available to you.';
  END IF;

  -- C11 (20260927012806, money review MEDIUM-1). claim_series_dates hands a
  -- VACATED series visit (still funded) to the Helpr who claimed its date: it
  -- books the visit, then records their accepted application. By then the
  -- visit is no longer 'open' and it may still be in its Early Access window,
  -- so the discovery checks below (C1, C4-C9) do not describe that write. The
  -- claim sets app.series_claim_rpc only around that one INSERT, after its
  -- own checks (the claimer is on the series, not banned, not blocked, not
  -- the poster); C3 and C10 above still run on it.
  IF current_setting('app.series_claim_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- C12 (authz review HIGH). A series VISIT is never applied to. A visit a
  -- Helpr gave up is 'open' with no helper and still funded, but it belongs
  -- to the series: it goes only to a Helpr already on the series, through
  -- claim_series_dates (C11 above). No discovery surface lists it
  -- (20260927015010), and this refuses the direct INSERT and apply_to_job.
  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_visit_not_open'
      USING ERRCODE = '42501',
            HINT = 'This visit is part of a series.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  -- Q1409: and a booked crew's re-listed free spot (crew_spots_open), the
  -- same rule every browse surface lists it by.
  IF v_job.status <> 'open'
     AND NOT (v_job.status = 'accepted' AND COALESCE(public.crew_spots_open(NEW.job_id), 0) > 0) THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  IF COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C13 (Q1411, owner 2026-10-05). The poster is under an open ban settlement
  -- review: the post is hidden from browse and takes no new application.
  -- The same neutral words as C6: the applicant learns nothing about why.
  IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
              WHERE q.user_id = v_job.customer_id AND q.review_state = 'open') THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. A job whose day has passed is not workable. This IS a feed filter —
  -- `date_needed >= CURRENT_DATE` appears in get_ranked_open_jobs,
  -- get_public_open_jobs and get_open_jobs_for_map (not in open_jobs_browse) —
  -- which is why the TimeZone above has to match theirs exactly.
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'The date this job was needed has already passed.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_job_state() TO service_role;
