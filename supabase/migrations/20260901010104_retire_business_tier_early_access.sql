-- Retire the `business` tier from the server-side early-access gate.
--
-- There is no business tier. `create-pro-checkout`'s ALLOWED_TIERS is
-- ["basic","pro","elite"] and throws on anything else (verified live against
-- test-mode Stripe on 2026-09-01: a `business` checkout errors, basic/pro/elite
-- return a session); `ProTierKey` is "basic"|"pro"|"elite"; no Stripe Price
-- maps to it; there is no seat-checkout function; and the business backend
-- (`businesses`, `business_members`, the seat ladder) was dropped by migrations
-- 20260828004538 / 20260828011811. `profiles.subscription_tier` is the only
-- column in the schema that stores a tier, and a prod census run immediately
-- before this migration was written found ZERO rows holding 'business'. So the
-- `tier IN ('elite', 'business')` branch below has been dead since the backend
-- was dropped, and nobody's perk changes here.
--
-- Removed in the same commit as the `business` rung in
-- `supabase/functions/_shared/helperFees.ts`, the `business` row in
-- `src/lib/subscriptionTiers.ts` TIER_PERKS, the `business` entry in
-- `_shared/tierNames.ts`, and the `business` branch in
-- `src/lib/earlyAccess.ts` — the parity tests pin those key sets together, so
-- removing it from one side alone reds the build.
--
-- With the branch gone, a legacy 'business' string falls to `ELSE 0` and waits
-- the full 20 minutes. That is the safe direction and it matches
-- `earlyAccessDelayMs()` exactly: an unrecognised tier loses a perk rather than
-- being handed one. `src/lib/earlyAccess.parity.test.ts` grades this file.
--
-- CREATE OR REPLACE with the full body: 20260831010000 was the live definition
-- and everything else in it (the F-1 funded gate, the coarsened coords, the
-- masked location, the pending-direct-offer rule) carries over byte-identical.
-- The ONLY change is the CASE's first WHEN. Replay-safe: CREATE OR REPLACE is
-- idempotent, the signature is unchanged, and no dependent object is dropped.

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer AS (
    SELECT
      CASE
        WHEN p.subscription_expires_at IS NULL OR p.subscription_expires_at <= now()
          THEN NULL
        ELSE p.subscription_tier
      END AS tier
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ),
  delay AS (
    -- Mirror of earlyAccessDelayMs(): (20 - earned) minutes.
    SELECT make_interval(mins => 20 - COALESCE((
      SELECT CASE
        WHEN tier = 'elite' THEN 20
        WHEN tier = 'pro' THEN 10
        WHEN tier = 'basic' THEN 5
        ELSE 0
      END FROM viewer
    ), 0)) AS d
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
  CROSS JOIN delay
  WHERE j.status = 'open'
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
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
    -- The paid perk, enforced here rather than trusted to the client.
    AND j.created_at <= now() - delay.d
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;
