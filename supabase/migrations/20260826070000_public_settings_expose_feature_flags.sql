-- get_public_platform_settings: also return feature_flags.
--
-- The five toggles on Admin -> Settings write to
-- platform_settings.feature_flags and nothing has ever read them back, so the
-- switches persist and change nothing (found by the 2026-08-25 admin audit).
-- The reason no consumer could be written is structural rather than an
-- oversight: platform_settings is admin-only under RLS ("Admins can read
-- platform settings"), so an ordinary signed-in user cannot see the column at
-- all. This SECURITY DEFINER RPC is the sanctioned public read path for that
-- table, so the flags have to travel through here.
--
-- Only the flag map is exposed -- not the whole row -- because everything else
-- on platform_settings (fee percents already returned, updated_by,
-- social_webhook_url) is either public already or has no business being.
--
-- This migration is READ-PLUMBING ONLY. It deliberately does not change any
-- stored flag value and no shipped code reads the new column yet, so it is
-- behaviourally inert on deploy. The stored values are all `false` today while
-- all five features are live, so a consumer must not be pointed at them until
-- that mismatch is reconciled -- see the note in AdminSettings.tsx.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a column changes the
-- RETURNS TABLE shape, which Postgres will not let a replace do. EXECUTE is
-- re-granted afterwards, and callers select by name so the extra column cannot
-- break the existing consumer (useDashboardData).
--
-- Replay-safe: DROP IF EXISTS, and the grants are re-asserted rather than
-- assumed to have survived.

DROP FUNCTION IF EXISTS public.get_public_platform_settings();

CREATE FUNCTION public.get_public_platform_settings()
RETURNS TABLE(
  id uuid,
  platform_fee_percent numeric,
  customer_fee_percent numeric,
  helper_fee_percent numeric,
  hybrid_idv_enabled boolean,
  idv_auto_approve_threshold numeric,
  onboarding_fee_cents integer,
  feature_flags jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    id,
    platform_fee_percent,
    customer_fee_percent,
    helper_fee_percent,
    hybrid_idv_enabled,
    idv_auto_approve_threshold,
    onboarding_fee_cents,
    COALESCE(feature_flags, '{}'::jsonb)
  FROM public.platform_settings
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated;
