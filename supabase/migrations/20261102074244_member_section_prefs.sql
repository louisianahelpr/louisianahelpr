-- Q2199: Customize ("Your sections") follows the ACCOUNT, not the device.
--
-- A member can hide sections and reorder them (owner, 2026-10-19: Customize). The choice lived only in device
-- storage (helpr_section_prefs:<uid>, src/components/sections/useSectionPrefs.ts), so a member who hid a section saw
-- it again on a second device or after a reinstall.
--
-- public.member_section_prefs: ONE row per member (user_id is the key), the member's own row only.
--   * section_order / sections_hidden: the section keys of src/components/sections/sectionsConfig.ts. CHECKs hold
--     them to those four keys, no key twice, and never all four hidden (the client refuses hiding the last one too).
--   * public.section_keys_ok(keys, max_len): the CHECKs' shape rule (IMMUTABLE, SECURITY INVOKER, reads no table).
--   * RLS: the member reads, inserts and updates their OWN row (user_id = auth.uid()); no DELETE (deleting the
--     account removes the row: ON DELETE CASCADE). anon and PUBLIC hold nothing (REVOKE by name, house rule).
--   * Download My Data exports the row (20261102074248, the same train).
-- The client keeps its device copy as the offline fallback and as the copy shown before the row is read.
-- Replay-safe: IF NOT EXISTS table, constraints added only when absent, policies dropped and re-created by name,
-- idempotent GRANT/REVOKE.

CREATE TABLE IF NOT EXISTS public.member_section_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  section_order text[] NOT NULL DEFAULT '{}'::text[],
  sections_hidden text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The shape rule, said once: only the four section keys, no key twice, no NULL, at most max_len entries. A CHECK
-- may not hold a subquery, so the duplicate test lives here. SECURITY INVOKER (a CHECK runs it as the writing role),
-- IMMUTABLE, reads no table.
CREATE OR REPLACE FUNCTION public.section_keys_ok(keys text[], max_len integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT keys IS NOT NULL
     AND keys <@ ARRAY['jobs', 'declutter', 'shops', 'homes']::text[]
     AND array_position(keys, NULL) IS NULL
     AND cardinality(keys) <= max_len
     AND cardinality(keys) = (SELECT count(DISTINCT k) FROM unnest(keys) AS k);
$fn$;
REVOKE ALL ON FUNCTION public.section_keys_ok(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.section_keys_ok(text[], integer) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_section_prefs_order_keys'
                   AND conrelid = 'public.member_section_prefs'::regclass) THEN
    ALTER TABLE public.member_section_prefs ADD CONSTRAINT member_section_prefs_order_keys
      CHECK (public.section_keys_ok(section_order, 4));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_section_prefs_hidden_keys'
                   AND conrelid = 'public.member_section_prefs'::regclass) THEN
    -- Never all four hidden: at least one section stays shown.
    ALTER TABLE public.member_section_prefs ADD CONSTRAINT member_section_prefs_hidden_keys
      CHECK (public.section_keys_ok(sections_hidden, 3));
  END IF;
END
$$;

COMMENT ON TABLE public.member_section_prefs IS
  'Customize (Q2199): the member''s section order and hidden sections (keys from sectionsConfig.ts), one row per member, own row only. The client keeps a device copy as the offline fallback.';

ALTER TABLE public.member_section_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_section_prefs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.member_section_prefs TO authenticated;
GRANT UPDATE (section_order, sections_hidden, updated_at) ON TABLE public.member_section_prefs TO authenticated;
GRANT ALL ON TABLE public.member_section_prefs TO service_role;

DROP POLICY IF EXISTS "member section prefs: read own" ON public.member_section_prefs;
CREATE POLICY "member section prefs: read own" ON public.member_section_prefs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "member section prefs: add own" ON public.member_section_prefs;
CREATE POLICY "member section prefs: add own" ON public.member_section_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "member section prefs: change own" ON public.member_section_prefs;
CREATE POLICY "member section prefs: change own" ON public.member_section_prefs
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
