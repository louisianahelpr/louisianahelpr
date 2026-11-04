-- Q1930 (WIP, Builder 102 11-04): declutter_road_miles reads a ROUTED distance when one is stored for that exact
-- origin/destination pair, and keeps the straight line x 1.3 estimate as the fallback (the item's done-when).
--
-- WHAT:
--   declutter_route_miles (new): routed road miles (and drive minutes) per (origin, destination) point pair, written
--     ONLY by the service role (the edge path that geocodes a drop-off asks Apple Maps /v1/etas through
--     _shared/appleRoutes.ts: NOT wired yet). Nobody else reads or writes it: destination points are buyers' geocoded
--     drop-off addresses. A routed value older than 180 days is ignored (roads change; the estimate answers).
--   declutter_road_miles: restated from 20261017055505 (prosrc md5 17f0386c49fc9b4e0a3c0b47ee234b0e = prod, read
--     2026-11-04 by Builder 102; IMMUTABLE, INVOKER, EXECUTE authenticated + service_role). Now STABLE (it reads a
--     table) and SECURITY DEFINER (members may not read the table; it answers one whole number for the pair it is
--     given, exactly what it answers today). Not used in any index, generated column or CHECK (grep of every
--     migration), so the volatility change is safe. Same signature, same NULL rule, same 1-mile floor.
-- MONEY: the delivery price and the Helpr's delivery pay are measured in these miles. A routed value is used as
--   greatest(ceil(straight), least(routed, ceil(straight x 4))), at least 1. With no routed row (every pair
--   today) the answer is byte-for-byte the old one. A routed row can only come from the service role.
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, grants by role name. PROOF: src/test/pglite/declutterRoadMilesRouted.pglite.mjs.
-- For verdict: lh-money-escrow + lh-authz-rls.

CREATE TABLE IF NOT EXISTS public.declutter_route_miles (
  o_lat numeric NOT NULL CHECK (o_lat BETWEEN -90 AND 90),
  o_lng numeric NOT NULL CHECK (o_lng BETWEEN -180 AND 180),
  d_lat numeric NOT NULL CHECK (d_lat BETWEEN -90 AND 90),
  d_lng numeric NOT NULL CHECK (d_lng BETWEEN -180 AND 180),
  miles integer NOT NULL CHECK (miles BETWEEN 1 AND 2000),
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 0 AND 6000),
  source text NOT NULL DEFAULT 'apple' CHECK (source IN ('apple')),
  routed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (o_lat, o_lng, d_lat, d_lng)
);
ALTER TABLE public.declutter_route_miles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_route_miles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_route_miles TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_road_miles(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) IS NULL THEN NULL
    ELSE coalesce(
      -- A routed answer is held between the straight line (no road is shorter) and 4x it (lead review 11-04: a
      -- wrong match or a detour never prices a delivery past that), rounded up, at least 1.
      (SELECT greatest(1, ceil(public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) / 1609.344),
                       least(r.miles, ceil(public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) / 1609.344 * 4)))::integer
         FROM public.declutter_route_miles r
        WHERE r.o_lat = p_lat1 AND r.o_lng = p_lng1 AND r.d_lat = p_lat2 AND r.d_lng = p_lng2
          AND r.routed_at > now() - interval '180 days'),
      greatest(1, ceil(public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) / 1609.344 * 1.3))::integer) END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_road_miles(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_road_miles(numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- Q807: refuse writes from an unconfirmed email on the new table(s) (standard guarded attach).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;
