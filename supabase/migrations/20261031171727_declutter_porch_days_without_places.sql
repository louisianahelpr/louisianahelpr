-- LEAD-PLACE-TIMES, lh-money-escrow review of a112245718 (2026-10-31), point 2: since a new porch pickup books a TIME
-- through declutter_book_pickup (20261031163021 and the client), nothing checked the seller's porch DAYS for a seller
-- with no saved places: a Saturday-only porch seller could be booked on a Tuesday (declutter_book_porch_day, the old
-- day path, checked declutter_order_is_porch_day; declutter_book_pickup never did).
--
-- The fix, only when the order has NO frozen place (a frozen place's hours already carry its days) and only for a
-- porch order: both the times the buyer is shown and the time the server accepts keep to the porch days
-- (declutter_order_is_porch_day, 20261030164712: the seller's porch days, else the days with pickup times).
--   declutter_order_pickup_windows   restated from its newest CREATE, 20261031145652; the usual-times read filtered.
--   declutter_order_slot_in_windows  restated from its newest CREATE, 20261031145652; a porch day check first.
-- declutter_book_pickup calls declutter_order_slot_in_windows for the buyer, so it is not restated. The Helpr delivery
-- path (declutter_delivery_slot_ok) calls it for 'delivery' orders only: unchanged.
-- Newest CREATEs measured 2026-10-31 with git grep over origin/main and every origin wip/ and ready/ branch.
-- MONEY: no amount changes. REPLAY-SAFE: CREATE OR REPLACE; grants restated by role name.
-- Proof: src/test/pglite/declutterDoorPickupUsesPlaces.pglite.mjs (section 6; applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_order_pickup_windows(p_order_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_hours jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL
     OR NOT (
          (o.buyer_id = v_uid AND o.status = 'paid')
       OR o.seller_id = v_uid
       OR EXISTS (SELECT 1 FROM public.helpr_tasks t
                   WHERE t.source_kind = 'declutter_delivery' AND t.source_id = o.id AND t.helpr_id = v_uid
                     AND t.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT op.windows INTO v_hours FROM public.declutter_order_porch_places op WHERE op.order_id = o.id;
  IF v_hours IS NOT NULL THEN
    RETURN QUERY
      SELECT (e ->> 'weekday')::smallint, (e ->> 'starts')::time, (e ->> 'ends')::time, o.paid_at + interval '7 days'
        FROM jsonb_array_elements(v_hours) e
       ORDER BY 1, 2;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, o.paid_at + interval '7 days'
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
       -- Review 2026-10-31 #2: a porch order with no frozen place keeps to the seller's porch days.
       AND (o.handover IS DISTINCT FROM 'porch' OR public.declutter_order_is_porch_day(o.id, w.weekday))
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_pickup_windows(uuid) TO authenticated, service_role;

-- A time inside the order's hours: the frozen place's, else declutter_slot_in_windows (the seller's usual times).
CREATE OR REPLACE FUNCTION public.declutter_order_slot_in_windows(p_order_id uuid, p_seller uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hours jsonb;
  v_local timestamp := p_start AT TIME ZONE 'America/Chicago';
BEGIN
  -- Q140: a NULL argument never says yes (a NULL order would fall through to the seller's usual times).
  IF p_order_id IS NULL OR p_seller IS NULL OR p_start IS NULL THEN
    RETURN false;
  END IF;
  SELECT op.windows INTO v_hours FROM public.declutter_order_porch_places op WHERE op.order_id = p_order_id;
  IF v_hours IS NULL THEN
    -- Review 2026-10-31 #2: a porch order with no frozen place keeps to the seller's porch days.
    IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = p_order_id AND o.handover = 'porch')
       AND NOT public.declutter_order_is_porch_day(p_order_id, extract(dow FROM v_local)::smallint) THEN
      RETURN false;
    END IF;
    RETURN public.declutter_slot_in_windows(p_seller, p_start);
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hours) e
     WHERE (e ->> 'weekday')::int = extract(dow FROM v_local)::int
       AND v_local::time >= (e ->> 'starts')::time
       AND (e ->> 'ends')::time >= (e ->> 'starts')::time + interval '30 minutes'
       AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_slot_in_windows(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_slot_in_windows(uuid, uuid, timestamptz) TO service_role;
