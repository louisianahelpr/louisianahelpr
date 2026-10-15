-- Early access OFF for everyone while memberships are off (roadmap F4a, owner
-- 2026-10-15: the formerly Pro-only features are off for everyone, "Nobody for
-- now", until memberships return).
--
-- The early-access perk is a head start on brand-new jobs: everyone waits the
-- 20-minute base, and a paid tier shaves minutes off it. "Off for everyone"
-- means nobody gets the head start, plan holders included: every caller waits
-- the base, exactly as a free account does today (measured 2026-10-15: 94
-- profiles, none holds a tier, so nobody's feed changes on deploy).
--
-- ONE new branch, first in the CASE: while the hidden `memberships` switch
-- (20261015033658) is not on for this user, the tier earns 0 minutes. Every
-- other line is the body from 20260925053412 verbatim, so
-- src/lib/earlyAccess.parity.test.ts still grades the same ladder. Both
-- callers (early_access_cutoff() for the three browse surfaces,
-- early_access_visible_at() for the alert/email fan-out) read this one ladder.
-- When the owner turns memberships back on in Admin -> Settings, the ladder
-- returns with no migration.
--
-- feature_enabled_for_user (20261012031120) returns false for a null user, an
-- unknown key or an `off` audience, so an anonymous caller still waits 20.
--
-- REPLAY-SAFE: CREATE OR REPLACE with the same signature; grants restated.

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
  -- Roadmap F4a: while memberships are off for this user, no tier earns
  -- minutes (the first WHEN).
  --
  -- `business` is deliberately absent: the tier was retired on 2026-09-01
  -- (see 20260901010104 and subscriptionTiers.ts) and a stray string must fall
  -- to ELSE 0, losing a perk rather than being handed one.
  SELECT 20 - COALESCE((
    SELECT CASE
             WHEN NOT public.feature_enabled_for_user('memberships', p_user_id) THEN 0
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
  ), 0);
$function$;
REVOKE ALL ON FUNCTION public.early_access_delay_minutes(uuid) FROM PUBLIC, anon, authenticated;
