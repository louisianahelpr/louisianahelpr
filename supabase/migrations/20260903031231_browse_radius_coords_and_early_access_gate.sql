-- Two discovery defects, both found by measuring prod on 2026-09-02.
--
-- BD-001 — the "Nearby" radius filter was a TOTAL NO-OP for logged-out
-- visitors and a crude city-name substring match for everyone else.
--
--   `open_jobs_browse` is the view BOTH browse feeds read (the guest
--   /browse feed in DashboardGuest.tsx and the signed-in dashboard in
--   useDashboardData.ts). It exposed no coordinates at all, so the
--   haversine branch in useDashboardFilters.ts could never be taken and the
--   code fell through to comparing the viewer's saved `profiles.location`
--   string against the job's. A GUEST has no profile, so that fallback
--   compared nothing and every job survived the filter — while the toolbar
--   went on printing the heading "Filtered Results".
--
--   Measured before this migration: viewer pinned at Baton Rouge
--   (30.4515, -91.1871), `?loc=nearby:1` on /browse returned all 10 open
--   jobs, including one 72.7 miles away (public.miles_between). The result
--   set was byte-identical at 1, 50, 60 and 100 miles and with no radius
--   set at all.
--
--   The fix is to give the view the same masked coordinates the public map
--   RPC has always returned. This exposes NOTHING new: `get_open_jobs_for_map`
--   is EXECUTE-granted to `anon` and already returns ROUND(latitude, 2) /
--   ROUND(longitude, 2) for the same set of jobs. Two decimal places is
--   ~1.1km at Louisiana latitudes — the right neighbourhood, never the
--   doorstep, and not reversible to the source coordinates. The exact
--   location stays behind `mask_job_location` exactly as before.
--
-- BD-002 — the paid Early Access perk leaked through `get_public_open_jobs`.
--
--   Early Access withholds a new job from free and logged-out viewers for
--   20 minutes (`public.early_access_cutoff()`, tapering to 0 for Elite).
--   Three of the four discovery surfaces enforce it: `get_ranked_open_jobs`
--   and `get_open_jobs_for_map` both carry `j.created_at <= cutoff.ts`, and
--   the `open_jobs_browse` view carries the same predicate inline.
--
--   `get_public_open_jobs` had NO `created_at` predicate whatsoever, and
--   orders `boosted DESC, created_at DESC LIMIT 6` — so it returned
--   PRECISELY the newest rows, which is exactly the set the perk exists to
--   withhold. It is EXECUTE-granted to `anon`, so the publishable key that
--   ships in the client bundle was the entire exploit: one unauthenticated
--   POST to /rest/v1/rpc/get_public_open_jobs bought Elite-tier early
--   access for nothing, from a logged-out browser.
--
--   This is the same class of hole that was closed on 2026-09-01 when the
--   guest feed's `earlyAccessExempt: true` was removed: a perk anyone can
--   have by signing out is not a perk.

-- ---------------------------------------------------------------------------
-- BD-001: masked coordinates on the browse view.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE VIEW may only APPEND columns, so latitude/longitude go on
-- the end; every existing column keeps its name, type and position. Replacing
-- (rather than dropping) preserves the SELECT grants to anon/authenticated.
-- `security_invoker = false` is restated because CREATE OR REPLACE VIEW resets
-- unspecified reloptions, and this view is deliberately definer-rights: it is
-- the public feed, readable by anon, and must not run under the caller's RLS.
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false) AS
  SELECT
    id,
    title,
    description,
    category,
    budget,
    date_needed,
    CASE
      WHEN offered_to_helper_id = auth.uid() THEN location
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
    ((SELECT count(*) FROM applications a WHERE a.job_id = jobs.id))::integer AS applicant_count,
    pricing_mode,
    -- NEW (BD-001). Same masking precision, and the same rationale, as
    -- get_open_jobs_for_map: 2dp ≈ 1.1km, enough to compute an honest
    -- radius, not enough to find a front door. NULL for a job whose geocode
    -- failed or is still pending, and for a job whose poster deleted their
    -- account (deletion nulls the coordinates) — the client must treat NULL
    -- as "distance unknown", never as "distance zero".
    ROUND(latitude, 2)  AS latitude,
    ROUND(longitude, 2) AS longitude
  FROM jobs
  WHERE status = 'open'::job_status
    AND customer_id IS NOT NULL
    AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (
      offered_to_helper_id IS NULL
      OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text]))
      OR offered_to_helper_id = auth.uid()
    )
    AND (
      created_at <= early_access_cutoff()
      OR customer_id = auth.uid()
      OR offered_to_helper_id = auth.uid()
    )
    AND (NOT is_seed OR NOT seed_jobs_hidden_publicly());

COMMENT ON VIEW public.open_jobs_browse IS
  'Public browse feed. Location is masked to "City, State"; latitude/longitude are rounded to 2dp (~1.1km), matching get_open_jobs_for_map. Both browse feeds read this view, so the client radius filter and the map agree.';

-- ---------------------------------------------------------------------------
-- BD-002: the Early Access gate on the anon landing/teaser RPC.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION replaces the function's properties wholesale, so
-- `search_path` and the `TimeZone` setting are RESTATED here rather than
-- assumed to survive. The timezone is load-bearing and was set deliberately
-- an hour before this migration (V-002): CURRENT_DATE must be the Louisiana
-- date, not the UTC one, or a job needed today drops out of the teaser at
-- 7pm Central.
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
RETURNS TABLE(
  id uuid,
  title text,
  category text,
  location text,
  budget numeric,
  date_needed date,
  is_urgent boolean,
  is_boosted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- Restated for replay-safety: CREATE OR REPLACE on an EXISTING function keeps
-- its ACL, but on a fresh database (CI replay, PGlite, a rebuild from
-- migrations) this statement creates the function for the first time and it
-- would otherwise be unreachable by the anonymous landing page.
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated;
