-- The landing page's "coming soon" marks (owner, 2026-10-19): a signed-out
-- visitor sees a section as "coming soon" until its switch is open to
-- everyone. feature_enabled_for() is signed-in only (it reads auth.uid()), so
-- the public page could not tell; this answers the one public fact — which
-- switch keys are at audience 'everyone' — and nothing about testers, admins
-- or who is in which audience, and only for the three section keys the page
-- names. Read-only, no arguments, no row data beyond those key names, which
-- already ship in the client bundle (src/config/featureSwitches.ts).
CREATE OR REPLACE FUNCTION public.features_open_to_everyone()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- ONLY the three section switches the landing names (src/components/sections/sectionsConfig.ts,
  -- SECTIONS[].feature): any other switch's rollout stays private (lead review, 2026-10-19).
  SELECT coalesce(array_agg(key ORDER BY key), ARRAY[]::text[])
  FROM public.feature_switches
  WHERE audience = 'everyone'
    AND key = ANY (ARRAY['declutter', 'shops', 'rentals']);
$function$;

COMMENT ON FUNCTION public.features_open_to_everyone() IS
  'Which of the section switches (declutter, shops, rentals) are open to everyone, for the public landing page. Reveals nothing about other switches, testers or admins.';

REVOKE ALL ON FUNCTION public.features_open_to_everyone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.features_open_to_everyone() TO anon, authenticated, service_role;
