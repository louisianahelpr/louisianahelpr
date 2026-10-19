-- Q2199: Customize ("Your sections") follows the ACCOUNT, not the device.
--
-- A member can hide sections and reorder them (owner, 2026-10-19: Customize).
-- The choice lived only in device storage (helpr_section_prefs:<uid>), so a
-- member who hid a section saw it again on a second device or after a
-- reinstall. It is a fact about the account, so it goes on the account's
-- profile row, the same shape and the same reasoning as
-- 20260909175426_account_scoped_onboarding_tour_completion.sql (one row per
-- account, read on every mount with the profile, never queried on its own; a
-- side table would add a join and a second RLS surface to keep in sync).
--
-- Two nullable text[] columns. NULL = never chosen (the client falls back to
-- its device copy, then to the default order). The CHECKs hold the values to
-- the four section keys (src/components/sections/sectionsConfig.ts), no key
-- twice, so a client can never store anything else here, and at least one
-- section stays shown (the client refuses hiding the last one; so does the server).
--
-- AUTHZ: `authenticated` holds COLUMN-level privileges on profiles (see the
-- 20260909175426 note), and useCurrentUser reads `select("*")`, which fails
-- for every user on a column it cannot read. So SELECT is granted on the two
-- new columns here and UPDATE by sync_profiles_update_grants(); RLS ("Users can view/update
-- their own ...") still decides WHICH row. Revoked from PUBLIC and anon by
-- name (house rule). Nothing else reads or writes them; no trigger, and the one
-- function is the IMMUTABLE shape check below. Download My Data exports the whole profiles row, deletion removes
-- it with the profile.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraints added only when absent,
-- idempotent GRANT/REVOKE. Applied 3x in PGlite on a prod-shaped profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS section_order text[],
  ADD COLUMN IF NOT EXISTS sections_hidden text[];

-- The shape rule, in one function so both CHECKs say it once: only the four
-- section keys, no key twice, at most `max_len` entries. A CHECK may not hold a
-- subquery, so the duplicate test lives here. SECURITY INVOKER (a CHECK runs
-- its function as the writing role), IMMUTABLE, touches no table.
CREATE OR REPLACE FUNCTION public.section_keys_ok(keys text[], max_len integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT keys IS NULL
      OR (keys <@ ARRAY['jobs', 'declutter', 'shops', 'homes']::text[]
          AND cardinality(keys) <= max_len
          AND cardinality(keys) = (SELECT count(DISTINCT k) FROM unnest(keys) AS k));
$fn$;

REVOKE ALL ON FUNCTION public.section_keys_ok(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.section_keys_ok(text[], integer) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_section_order_keys' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_section_order_keys CHECK (public.section_keys_ok(section_order, 4));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_sections_hidden_keys' AND conrelid = 'public.profiles'::regclass) THEN
    -- Never all four hidden: at least one section stays shown.
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_sections_hidden_keys CHECK (public.section_keys_ok(sections_hidden, 3));
  END IF;
END
$$;

COMMENT ON COLUMN public.profiles.section_order IS
  'Customize: the member''s section order (keys from sectionsConfig.ts). NULL = never chosen. Account-scoped (Q2199); the client keeps a device copy as the offline fallback.';
COMMENT ON COLUMN public.profiles.sections_hidden IS
  'Customize: the sections the member hid (never all four). NULL = never chosen. Account-scoped (Q2199).';

GRANT SELECT (section_order, sections_hidden) ON public.profiles TO authenticated;
GRANT SELECT (section_order, sections_hidden) ON public.profiles TO service_role;

-- UPDATE comes from the one place that owns profiles' column grants (every
-- non-locked column writable by authenticated; code-review 2026-10-19), never a hand GRANT.
DO $$
BEGIN
  IF to_regprocedure('public.sync_profiles_update_grants()') IS NOT NULL THEN
    PERFORM public.sync_profiles_update_grants();
  END IF;
END
$$;

REVOKE ALL (section_order, sections_hidden) ON public.profiles FROM PUBLIC;
REVOKE ALL (section_order, sections_hidden) ON public.profiles FROM anon;
