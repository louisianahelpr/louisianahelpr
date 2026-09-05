-- Early access: admit the restored Plus tier.
--
-- Plus is back (2026-09-05) and its ONE distinct perk over Pro is a 15-minute
-- early-access step — Pro 10 → Plus 15 → Elite 20. `early_access_cutoff()` is
-- THE server-side enforcement for that perk on all three job surfaces
-- (get_ranked_open_jobs, open_jobs_browse, get_open_jobs_for_map), and it had
-- no `plus` branch, so a Plus member fell to `ELSE 0`.
--
-- That is the whole tier not working: $15/mo for a rung whose only advertised
-- benefit the server declines to grant, while the client's earlyAccessDelayMs()
-- promises 15 minutes. Client says early, server says wait — and the server
-- wins, silently.
--
-- WHY THE PARITY TEST DIDN'T CATCH IT. earlyAccess.parity.test.ts exists
-- precisely to keep these two in lock-step, and it stayed green through this,
-- twice over: it read a HARDCODED migration path (20260901022522) so it could
-- never see a newer definition, and it looped a hardcoded
-- ["elite","pro","basic"] so it could never check a tier it had not been told
-- about. Both are fixed in the same commit — the file is now found by content
-- and the tiers are derived from TIER_PERKS.
--
-- Body is the live definition (pg_get_functiondef) verbatim, plus the one
-- WHEN branch.

CREATE OR REPLACE FUNCTION public.early_access_cutoff()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Mirror of earlyAccessDelayMs() + resolveEarlyAccessTier() in
  -- src/lib/earlyAccess.ts: a 20-minute base, minus the minutes the caller's
  -- ACTIVE tier has earned. Rows created after the returned instant are the
  -- perk; rows at or before it are the free feed.
  --
  -- `business` is deliberately absent — the tier was retired on 2026-09-01
  -- (see 20260901010104 and subscriptionTiers.ts) and a stray string must fall
  -- to ELSE 0, losing a perk rather than being handed one.
  SELECT now() - make_interval(mins => 20 - COALESCE((
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
    WHERE p.user_id = (SELECT auth.uid())
  ), 0));
$function$;
