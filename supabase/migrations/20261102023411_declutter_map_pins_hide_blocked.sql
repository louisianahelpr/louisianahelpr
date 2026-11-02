-- Q1888 follow-up (lead verdict on 20261102022901, 11-01): the map's pins come from a SECURITY DEFINER read, which the
-- items read policy does not reach, so a blocked partner's live items still showed as pins.
-- declutter_map_pins restated from 20261028151144_declutter_map_pins.sql (the newest; equal to the live
-- pg_get_functiondef read 2026-11-01 ~8:35 PM CST) with ONE added condition in `visible`, before the 500 cap:
-- NOT (i.seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'::uuid[]))), the same filter as the
-- items read policy (20261102022901). Grants restated unchanged.
-- Other definer reads that list live items to a member already filter blocks (live read 2026-11-01): saved_search_new_counts,
-- declutter_dropped_into_budget, declutter_my_wanted, declutter_seller_moving_sale, deliver_saved_search_item_alerts.
-- Proof: src/test/pglite/declutterItemsHiddenFromBlocked.pglite.mjs (section E; applied 3x).
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION, same signature and return type.

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
         AND NOT (i.seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))
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
