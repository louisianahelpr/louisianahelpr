-- SHIPPING: the seller's label screen (docs/specs/shipping-draft.md section 6; Q2259; B131).
-- After a shipped sale the label is already bought (S3 worker) and the buyer's hold captured. The seller needs the
-- label to print, the tracking number, and a "Ship by" deadline (spec 6: 3 business days; missing it = the seller
-- backs out, S4/S6). shipments is service-role only (S1), so the seller reads their own order's label through:
--   1. declutter_ship_by(paid_at): the end (11:59:59 PM Louisiana time) of the 3rd business day (Mon-Fri) after the
--      day the order was paid. Holidays are not counted (spec 6 says business days; USPS holidays are a later step).
--   2. declutter_my_ship_label(order): the order's SELLER only (anyone else, a non-ship order or no order: the same
--      'order_not_found', so nothing tells an outsider an order exists), switch declutter_shipping on. The label URL
--      and tracking number only once the label is bought AND the hold captured (the buyer has paid): before that,
--      and after a void, no label to print. Never the buyer's address (it is printed on the label).
--   3. shipments.packed_at + declutter_mark_packed(order): the seller's own "Packed" step (idempotent: the first
--      time is kept). Same seller / bought / captured rule. "Shipped" is the carrier's acceptance scan (S4), never
--      a seller tap. No ban gate: a restricted seller must still be able to ship an order the buyer already paid for.
-- All three SECURITY DEFINER with a pinned search_path; revoked from PUBLIC and anon; the two seller RPCs granted to
-- authenticated (they check auth.uid() themselves); declutter_ship_by is a pure date rule, granted to authenticated.
-- Replay-safe: CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS packed_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_ship_by(p_paid timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d date;
  n integer := 0;
BEGIN
  IF p_paid IS NULL THEN
    RETURN NULL;
  END IF;
  d := (p_paid AT TIME ZONE 'America/Chicago')::date;
  WHILE n < 3 LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN ((d + 1)::timestamp AT TIME ZONE 'America/Chicago') - interval '1 second';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_by(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ship_by(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_ship_label(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  s record;
  v_ready boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.seller_id, d.handover, d.status, d.paid_at, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT sh.label_state, sh.label_path, sh.tracking_code, sh.tracking_status, sh.service, sh.accepted_at,
         sh.delivered_at, sh.packed_at INTO s
    FROM public.shipments sh WHERE sh.declutter_order_id = o.id;
  v_ready := FOUND AND s.label_state = 'bought' AND o.ship_capture = 'captured';
  RETURN jsonb_build_object(
    'order_status', o.status,
    'label_state', s.label_state,
    'label_url', CASE WHEN v_ready THEN s.label_path END,
    'tracking_code', CASE WHEN v_ready THEN s.tracking_code END,
    'tracking_status', s.tracking_status,
    'service', s.service,
    'ship_by', CASE WHEN v_ready THEN public.declutter_ship_by(o.paid_at) END,
    'packed_at', s.packed_at,
    'accepted_at', s.accepted_at,
    'delivered_at', s.delivered_at);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_ship_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_ship_label(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_packed(p_order_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Q281 ban gate (train 1 fix, lead 11-02): a write; a banned caller is refused, as the porch photo and the other
  -- handover writes are (declutter_porch_photo, declutter_set_porch_time).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.seller_id, d.handover, d.status, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.ship_capture IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'label_not_ready' USING ERRCODE = '55000', HINT = 'The label is not ready yet.';
  END IF;
  UPDATE public.shipments SET packed_at = COALESCE(packed_at, now())
   WHERE declutter_order_id = o.id AND label_state = 'bought'
   RETURNING packed_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'label_not_ready' USING ERRCODE = '55000', HINT = 'The label is not ready yet.';
  END IF;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_packed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_packed(uuid) TO authenticated, service_role;
