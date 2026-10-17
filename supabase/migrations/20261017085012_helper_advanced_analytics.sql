-- Advanced Analytics is a paid perk, and every paid perk is off while the
-- memberships switch is off for that member (roadmap F4/F4a, owner
-- 2026-10-15). Q1844: the Analytics page was hidden by the switch on the client
-- only, while get_helper_analytics still answered `entitled: true` from the
-- tier alone, so a direct RPC call by a tier holder got the paid dashboard.
--
-- The gate now also asks public.feature_enabled_for_user('memberships', ...),
-- the same decision the app and the edge functions ask (create-boost-payment,
-- instant-payout). Prod 2026-10-17: 0 of 97 profiles hold a tier, and the
-- switch's audience is 'testers', so nobody's answer changes today.
--
-- Body is the live definition (pg_get_functiondef, 2026-10-17, identical to
-- 20260905215616) verbatim, with one AND added. The tier list stays in this
-- file so src/test/advancedAnalyticsTierParity.test.ts keeps reading it.
-- Grants restated: service_role only, as 20260901011102 set them.

CREATE OR REPLACE FUNCTION public.helper_has_advanced_analytics(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- SELF-ONLY. This is SECURITY DEFINER and takes a caller-supplied id, which
  -- is the precise shape 20260825170000_guard_monthly_profile_view_count had to
  -- fix: definer + caller id + no self-check let anyone read anyone's row. The
  -- soft form (false, not RAISE) is used for the same reason that migration
  -- gives — the caller renders a not-entitled surface either way.
  --
  -- Without this guard the function is an oracle over subscription LIVENESS for
  -- any guessed uuid: get_safe_profiles publishes `subscription_tier` for
  -- approved, non-banned profiles, but nothing public exposes whether a
  -- membership is still in date, and nothing exposes the tier of a banned or
  -- unapproved profile at all.
  --
  -- get_helper_analytics calls this with auth.uid(), so the guard is a no-op on
  -- the only path that exists.
  SELECT COALESCE(
    (
      SELECT p.subscription_tier IN ('pro', 'plus', 'elite')  -- advancedAnalytics tiers
         AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now())
         -- Q1844: no paid perk while memberships are off for this member.
         AND public.feature_enabled_for_user('memberships', p_user_id)
      FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND auth.uid() IS NOT NULL
        AND auth.uid() = p_user_id
      LIMIT 1
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.helper_has_advanced_analytics(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_has_advanced_analytics(uuid) TO service_role;
