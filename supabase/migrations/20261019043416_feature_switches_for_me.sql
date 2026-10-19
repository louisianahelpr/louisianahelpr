-- Batched hidden-feature-switch read (nightly-red #2601, loading-states-refresh).
--
-- useFeature() asked public.feature_enabled_for(key) once PER SWITCH on every
-- cold load: run 39158661660 (2026-10-18) metered 480 of those calls over 118
-- signed-in boots (3-6 per boot), 15% of the run's 3140 requests.
--
-- public.feature_switches_for_me(p_keys text[]) answers several switches in ONE
-- call, as a jsonb object {key: boolean}. Its per-key answer IS
-- public.feature_enabled_for(key): it calls that function for each distinct
-- non-null key, so the decision (audience, admin role, test_accounts, signed
-- out -> false, missing key -> false) is defined in exactly one place and a
-- later redefinition of feature_enabled_for flows through unchanged.
--
-- SECURITY INVOKER on purpose: it adds no privilege of its own. The caller
-- needs EXECUTE on feature_enabled_for. Granted to authenticated only (the one caller is useFeature in the signed-in app; anon has
-- neither. A null array answers {}; a null key is skipped (the client reads a
-- key that is absent from the answer as off). More than 64 keys is refused
-- (22023), so the call cannot be used to make one request do unbounded work;
-- the registry (src/config/featureSwitches.ts) holds 14.
--
-- Replay-safe: CREATE OR REPLACE; grants restated by role name.

CREATE OR REPLACE FUNCTION public.feature_switches_for_me(p_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF COALESCE(cardinality(p_keys), 0) > 64 THEN
    RAISE EXCEPTION 'too_many_keys'
      USING ERRCODE = '22023',
            DETAIL = format('feature_switches_for_me answers at most 64 keys, got %s', cardinality(p_keys));
  END IF;
  SELECT COALESCE(jsonb_object_agg(k.key, public.feature_enabled_for(k.key)), '{}'::jsonb)
    INTO v_out
    FROM (SELECT DISTINCT u.key FROM unnest(p_keys) AS u(key) WHERE u.key IS NOT NULL) AS k;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.feature_switches_for_me(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_switches_for_me(text[]) TO authenticated;

COMMENT ON FUNCTION public.feature_switches_for_me(text[]) IS
  'Hidden feature switches for the calling user, several in one call: {key: feature_enabled_for(key)} '
  'for each distinct non-null key (at most 64). Null array -> {}. SECURITY INVOKER. Client hook: useFeature().';
