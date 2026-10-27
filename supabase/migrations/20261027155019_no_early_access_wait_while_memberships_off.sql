-- No early-access wait while memberships are off (owner 2026-10-27, pop-up:
-- "Show jobs right away").
--
-- The 20-minute wait exists only so a paying tier sees new jobs first. With
-- the "memberships" switch off (testers only since roadmap F4a), no tier earns
-- minutes, so EVERY member and guest waited the full 20 minutes before any new
-- job showed in Browse (measured 2026-10-27: a paid job posted 15:32Z was not
-- in open_jobs_browse at 15:48Z; 0 real members hold a tier). Now a viewer for
-- whom memberships are off waits 0 minutes; testers keep the tier ladder.
--
-- Restated from prod's live body (pg_get_functiondef 2026-10-27; newest file
-- 20261015050803_early_access_off_while_memberships_off.sql) with the
-- memberships check moved outside the subtraction. Client mirror:
-- earlyAccessDelayMs(tier, membershipsOn) in src/lib/earlyAccess.ts.
CREATE OR REPLACE FUNCTION public.early_access_delay_minutes(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Mirror of earlyAccessDelayMs() + resolveEarlyAccessTier() in
  -- src/lib/earlyAccess.ts: a 20-minute base, minus the minutes the user's
  -- ACTIVE tier has earned. No profile row (every anonymous caller) is free.
  --
  -- Memberships off for this viewer (anonymous callers included): no wait at
  -- all (owner 2026-10-27). The wait is the other side of a paid perk; with
  -- no perk on sale it only hid every new job for 20 minutes.
  --
  -- `business` is deliberately absent: the tier was retired on 2026-09-01
  -- (see 20260901010104 and subscriptionTiers.ts) and a stray string must fall
  -- to ELSE 0, losing a perk rather than being handed one.
  SELECT CASE
    WHEN NOT public.feature_enabled_for_user('memberships', p_user_id) THEN 0
    ELSE 20 - COALESCE((
      SELECT CASE
               -- Lapsed. Only a STAMPED PAST date lapses: a NULL expiry is an
               -- active grant, matching tierFeePercent / feePercentForTier /
               -- resolveEarlyAccessTier. The cron nulls the TIER on lapse.
               WHEN p.subscription_expires_at IS NOT NULL
                    AND p.subscription_expires_at <= now() THEN 0
               WHEN p.subscription_tier = 'elite' THEN 20
               WHEN p.subscription_tier = 'plus'  THEN 15
               WHEN p.subscription_tier = 'pro'   THEN 10
               WHEN p.subscription_tier = 'basic' THEN 5
               ELSE 0
             END
      FROM public.profiles p
      WHERE p.user_id = p_user_id
    ), 0)
  END;
$function$;
