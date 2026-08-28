-- Plus tier (2026-08-27, owner): a fourth paid membership between Pro and
-- Elite — $15/mo, 9% platform fee.
--
-- The ONLY thing in the database that knows about membership tiers by name is
-- the early-access CASE inside get_open_jobs_for_map. (Verified against prod:
-- profiles.subscription_tier is a bare `text` column with NO check constraint,
-- no enum, and no trigger validating it, and this is the only routine whose
-- body branches on the tier ids. `apply_job_denial_consequence` also names
-- 'elite', but that is the Reliability Shield, which stays Elite-only.)
--
-- Plus earns 15 of the 20 minutes, sitting between Pro's 10 and Elite's 20.
-- This body is otherwise a byte-for-byte re-emission of the function as
-- 20260831010000 left it — only the new WHEN line is added, so nothing about
-- the funded/expiry/direct-offer gates changes.
--
-- Replay-safe: CREATE OR REPLACE on a function whose dependencies
-- (public.jobs, public.profiles, public.mask_job_location) are all created by
-- earlier migrations, and the signature is unchanged so no grant is dropped.

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
        WHEN tier IN ('elite', 'business') THEN 20
        WHEN tier = 'plus' THEN 15
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
