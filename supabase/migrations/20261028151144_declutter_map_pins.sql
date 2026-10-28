-- DECLUTTER BROWSE MAP PINS: A ROUGH AREA, NEVER THE SELLER'S HOUSE (owner 2026-10-28, via the lead's pop-up:
-- "Declutter map pins are a ROUGH AREA: each item's pin is moved to a spot within about half a mile (like Facebook
-- Marketplace); the seller's house is never shown; the exact spot is shared only after a sale, exactly as today").
--
-- What a member could read before this: declutter_items' area_label and area_lat/area_lng, the pickup point rounded
-- to 2 decimals (a cell about 1.1 x 1.0 km, 20261014200728). The exact pickup point lives only in
-- declutter_item_private, which no client role can read; declutter_item_address hands it out after a sale (unchanged).
--
-- declutter_map_pins() returns, for each item a member's Browse lists, ONE pin: the item's PUBLIC area point moved by a
-- secret, stable offset. It never reads the exact pickup point at all, so the pin cannot carry any more about where the
-- seller lives than the area cell every member can already read:
--   * anchored on area_lat/area_lng, not the pickup point. lh-authz-rls review of the first draft (anchored on the
--     exact point, ring 250-797 m): the public cell intersected with that ring cut the house down to ~106-190 m for
--     1-5% of items, and one address geocoded two ways (or two sellers at one address) gave independent pins whose
--     average walks back to the house. With the public anchor, subtracting or averaging pins only ever recovers the
--     public area point.
--   * moved uniformly within 300 m of that point, by an angle and radius drawn from sha256(secret salt | seller | area
--     cell). Measured (Monte Carlo, house uniform in its cell at 30.45N): house to pin median 0.27 mi, 95% within
--     0.47 mi, never over 0.63 mi: the owner's "within about half a mile". Pins in one cell spread out instead of
--     stacking on the grid point.
--   * keyed on seller + cell: a seller's listings from one place share one pin (one spot on the map), stable on every
--     read, so a reload never moves it.
--   * the salt is random, made once by this migration (gen_random_uuid, a strong random source) and kept in
--     declutter_pin_secret, which no client role can read (defence in depth: the offset is not recomputable from the
--     public repo).
--   * rounded to 4 decimals (~11 m) on the way out.
-- The item set is Browse's, restated from the items read policy's member branch (20261021142959, the newest):
-- live or reserved, seller not hidden, test listings hidden from real members (seed_hidden_in_discovery), minus the
-- caller's own listings (Browse never lists your own). SECURITY DEFINER (it reads the salt), so the policy does not
-- apply and is restated; it starts with require_feature('declutter') like every Declutter RPC.
--
-- Additive only (a new table nobody could read and a new function): no client privilege narrows, so no
-- client_compat_floor() change (schemaBreakBumpsClientFloor). Replay-safe: CREATE TABLE IF NOT EXISTS, the salt row
-- ON CONFLICT DO NOTHING (a replay never changes the salt, so pins never move), CREATE OR REPLACE FUNCTION, grants
-- restated. Proof: src/test/pglite/declutterMapPins.pglite.mjs (applied 3x). Guard: src/test/declutterMapPinsFuzzed.test.ts.

CREATE TABLE IF NOT EXISTS public.declutter_pin_secret (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  salt text NOT NULL CHECK (char_length(salt) >= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_pin_secret ENABLE ROW LEVEL SECURITY;
-- No policy and no client privilege, on purpose (the declutter_item_private pattern).
REVOKE ALL ON TABLE public.declutter_pin_secret FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_pin_secret TO service_role;
COMMENT ON TABLE public.declutter_pin_secret IS
  'Declutter: the secret salt that moves each Browse map pin off its public area point (declutter_map_pins). '
  'No client privilege. Never rotate it casually: every pin would move.';
-- Q807: every new public table gets the unconfirmed-email write gate (no client can write here anyway).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

INSERT INTO public.declutter_pin_secret (id, salt)
VALUES (1, encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.declutter_map_pins()
RETURNS TABLE(item_id uuid, pin_lat numeric, pin_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_salt text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT s.salt INTO v_salt FROM public.declutter_pin_secret s WHERE s.id = 1;
  IF v_salt IS NULL THEN
    -- No salt, no pins: never fall back to an unsalted offset.
    RAISE EXCEPTION 'declutter_pin_secret_missing' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    WITH visible AS (
      SELECT i.id, i.seller_id, i.area_lat, i.area_lng
        FROM public.declutter_items i
       WHERE i.status IN ('live', 'reserved')
         AND NOT i.seller_hidden
         AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())
         AND i.seller_id <> v_uid
       ORDER BY i.live_at DESC NULLS LAST
       LIMIT 500
    ), seeded AS (
      SELECT v.id, v.area_lat, v.area_lng,
             sha256(convert_to(v_salt || '|' || v.seller_id::text || '|' || v.area_lat::text || '|' || v.area_lng::text, 'UTF8')) AS d
        FROM visible v
    ), drawn AS (
      SELECT s.id, s.area_lat, s.area_lng,
             -- Two independent uniforms in [0, 1) from the first 8 bytes of the hash.
             ((get_byte(s.d, 0)::bigint << 24) | (get_byte(s.d, 1)::bigint << 16) | (get_byte(s.d, 2)::bigint << 8) | get_byte(s.d, 3)::bigint)::double precision / 4294967296.0 AS u_angle,
             ((get_byte(s.d, 4)::bigint << 24) | (get_byte(s.d, 5)::bigint << 16) | (get_byte(s.d, 6)::bigint << 8) | get_byte(s.d, 7)::bigint)::double precision / 4294967296.0 AS u_radius
        FROM seeded s
    ), moved AS (
      SELECT d.id, d.area_lat, d.area_lng,
             2 * pi() * d.u_angle AS theta,
             -- Uniform over the disc of 300 m around the public area point.
             300.0 * sqrt(d.u_radius) AS r_m
        FROM drawn d
    )
    SELECT m.id,
           round((m.area_lat::double precision + m.r_m * cos(m.theta) / 111320.0)::numeric, 4),
           round((m.area_lng::double precision + m.r_m * sin(m.theta) / (111320.0 * cos(radians(m.area_lat::double precision))))::numeric, 4)
      FROM moved m;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_map_pins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_map_pins() TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_map_pins() IS
  'Declutter Browse map: one pin per listed item, its public area point (2-decimal cell) moved up to 300 m by a salted, '
  'stable offset (owner 2026-10-28). Never reads or returns the exact pickup point.';
