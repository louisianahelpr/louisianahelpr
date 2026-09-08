-- Advanced Analytics: admit the restored Plus tier.
--
-- TIER_PERKS.plus carries `advancedAnalytics: true` — Plus sits above Pro and
-- the ladder's rule is that a higher tier can never grant fewer perks than a
-- lower one. This SQL gate hard-codes its own tier list, so without this a Plus
-- member would pay $15/mo for a tier whose analytics page told them to upgrade.
--
-- src/test/advancedAnalyticsTierParity.test.ts is what caught it: it derives
-- the expected set from TIER_PERKS and diffs it against the list in this
-- migration, so the two cannot drift. It failed the moment Plus was added,
-- which is exactly what a guard derived from the world rather than from itself
-- is supposed to do.
--
-- Body is the live definition (pg_get_functiondef) verbatim, including the
-- self-only guard, with 'plus' added to the one IN list.

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
      FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND auth.uid() IS NOT NULL
        AND auth.uid() = p_user_id
      LIMIT 1
    ),
    false
  );
$function$;
