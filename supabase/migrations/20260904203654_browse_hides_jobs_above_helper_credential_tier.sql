-- Discovery now HIDES a job whose credential_tier the viewer does not meet.
--
-- Until now credential_tier was purely an apply-time gate: the job appeared in
-- everyone's feed, and an unqualified helper only discovered the requirement
-- after tapping in (the detail sheet swaps Apply for a "Licensed & Insured
-- Only" deep link, and enforce_application_credential_tier is the server
-- backstop). Owner's call, 2026-09-04: "If they're not licensed or insured
-- then the job shouldn't show on their page."
--
-- THERE ARE FOUR DISCOVERY SURFACES AND THEY DO NOT SHARE A DEFINITION. Each
-- one hand-mirrors the others' filters, with comments saying so ("Mirrors
-- open_jobs_browse"). Any visibility rule added to one and not the others
-- drifts immediately, so all four are changed here together:
--   1. open_jobs_browse (view)   — dashboard list, jobs count, guest dashboard,
--                                  JobDetail, QuickApplyHandler
--   2. get_ranked_open_jobs      — the /jobs feed
--   3. get_open_jobs_for_map     — the browse map
--   4. get_public_open_jobs      — the landing page's public teaser
--
-- Deliberately NOT in this migration, and tracked as follow-up: the two
-- notification paths (notify_helpers_on_job_post, sweep_daily_job_digest)
-- still alert on parish match alone, so an unqualified helper would be told
-- about a job that is no longer in their feed — the exact "linking a helper to
-- a job they cannot see" problem notify_helpers_on_job_post's own comment says
-- it avoids for direct offers. Changing six objects in one migration is more
-- regression surface than one review can carry; discovery lands first.
--
-- The gate FAILS CLOSED. get_user_credential_tier() returns 0 for a NULL
-- user_id (every EXISTS inside it misses), so a signed-out guest sees only
-- tier-0 jobs on every surface including the landing page. That is deliberate:
-- "you only see jobs you could actually take" is one rule instead of two, and
-- it stops a guest signing up for a job that then vanishes.
--
-- PERFORMANCE: get_user_credential_tier runs six EXISTS subqueries, so it must
-- not run per row. It is wrapped in a scalar subquery — (SELECT
-- public.get_user_credential_tier(...)) — which makes it an InitPlan, evaluated
-- ONCE per statement. That is the same pattern these functions already use for
-- auth.uid() and early_access_cutoff(), and it is why the OR ordering below is
-- belt-and-braces rather than load-bearing.
--
-- The poster keeps seeing their OWN post in open_jobs_browse regardless of
-- their own credentials — a poster is not required to hold the licence they
-- are hiring for, and the two existing carve-outs in that view (early-access
-- and direct-offer) already use exactly this `customer_id = auth.uid()` shape.
-- The other three surfaces already exclude your own posts outright, so they
-- need no such carve-out.
--
-- KNOWN INTERACTION, deliberately left strict: a direct offer to a helper who
-- does not meet the tier is now invisible to them, so it will expire unanswered
-- after 24h and reopen. The right fix is upstream — the "Offer It to a Saved
-- Helpr" picker should not offer a credential-gated job to a helper who cannot
-- accept it — not a carve-out here that would show a job the apply trigger
-- refuses anyway.

-- ── 1. open_jobs_browse ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.open_jobs_browse AS
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
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier
   FROM jobs
  WHERE status = 'open'::job_status
    AND customer_id IS NOT NULL
    AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid())
    AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid())
    AND (NOT is_seed OR NOT seed_jobs_hidden_publicly())
    AND (
      COALESCE(credential_tier, 0) = 0
      OR customer_id = auth.uid()
      OR COALESCE((SELECT public.get_user_credential_tier(auth.uid())), 0) >= credential_tier
    );

-- ── 2. get_ranked_open_jobs (the /jobs feed) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.helper_preferred_parishes
        WHERE helper_id = (SELECT auth.uid())
      )
  ),
  -- Evaluated once per call, not once per row: neither value depends on j.
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           -- Same once-per-call contract as the two above. Six EXISTS
           -- subqueries live inside this, so it must never become per-row.
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
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED — 10% / 5% of the recency span above, so
        -- it is strictly smaller than every other term here and cannot
        -- outrank boost, parish, urgency or a real age gap (20260901031421).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    -- Poster's membership row. LEFT so a job whose poster has no profile row
    -- still ranks (it simply earns no placement points).
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      -- Ownership. A job whose poster deleted their account keeps `status =
      -- 'open'` and its funded escrow, but nobody remains to answer a question,
      -- accept an application or release the money — so it must not be offered
      -- as work. Mirrors open_jobs_browse (20260902152714).
      AND j.customer_id IS NOT NULL
    -- NEW: never show a person their OWN post on a surface whose purpose is
    -- finding work to take. The dashboard list has always filtered these
    -- client-side; the map and /jobs never did, so a poster saw their own
    -- listing with an apply affordance and got "You can't apply to your own
    -- post." on tap. BrowseMap.tsx even documented the workaround: the RPC
    -- deliberately withholds customer_id (PII), so the client could not
    -- filter and leaned on the error toast instead. Filtering HERE needs no
    -- new column exposed — the predicate reads customer_id without
    -- returning it.
    -- auth.uid() IS NULL for a guest, and `x <> NULL` is NULL, not TRUE —
    -- without the null arm every row would drop for logged-out visitors.
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Credentials. Same rule and same fail-closed default as the other three
      -- discovery surfaces: a helper is not shown work they cannot be awarded.
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      -- Fixture rows. The SERVER decides. `p_include_seed` may only NARROW —
      -- a caller can still ask not to be sent fixtures, and can no longer ask
      -- to be sent them once the operator flag is on.
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      -- Early Access (20260901022522). auth.uid() IS NULL for a guest, which
      -- lands on the free 20-minute delay — the free experience, by design.
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

-- ── 3. get_open_jobs_for_map ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
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
    -- 2 decimal places ≈ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep, and can't be
    -- reverse-engineered to the source coords.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    -- City, State only — same masker the public /jobs board uses. The popup
    -- prints the city and falls back to the parish when this is empty.
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE j.status = 'open'
    -- Ownership. Redundant today only because anonymisation also nulls the
    -- coordinates the filter below requires; stated explicitly so the map does
    -- not depend on that coincidence. See the header.
    AND j.customer_id IS NOT NULL
    -- NEW: never show a person their OWN post on a surface whose purpose is
    -- finding work to take. See get_ranked_open_jobs for the full note.
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    -- Credentials, on the same shared rule — the map must not pin a job the
    -- list now hides.
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Hide jobs whose needed date has already passed — matches the
    -- client-side filter in useDashboardFilters.ts and the SQL filter in
    -- get_ranked_open_jobs, so list + map + /jobs page all agree on
    -- which posts are "still open for browse."
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- The paid perk, on the shared authority.
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    -- Fixture rows, on the shared authority. The map could not exclude them
    -- at all before today — the RPC takes no arguments.
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- ── 4. get_public_open_jobs (landing page teaser) ───────────────────────────
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
  WHERE j.status = 'open'
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    -- Funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map. An unfunded job is not workable, so advertising
    -- it on the public page promises something the app will not honour.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0, so the
    -- landing page teaser shows only open-to-anyone work — which is also the
    -- honest thing to advertise to someone who has not verified anything yet.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use, so the
    -- landing page goes quiet with them when the flag is flipped at launch.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed >= CURRENT_DATE
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- NEW (BD-002): Early Access, on the SAME shared authority the other
    -- three discovery surfaces use. Without this the ORDER BY below handed an
    -- anonymous caller the newest six jobs — which is the perk, exactly.
    -- auth.uid() IS NULL for a guest, so early_access_cutoff() returns the
    -- free 20-minute delay; a signed-in subscriber calling this gets their own
    -- shorter delay, same as everywhere else.
    --
    -- There is deliberately NO `offered_to_helper_id = auth.uid()` escape
    -- hatch here, unlike the other three: the line above already withholds
    -- every job under a live direct offer from this surface, so the targeted
    -- helper has nothing to be let back in to.
    AND j.created_at <= public.early_access_cutoff()
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;
