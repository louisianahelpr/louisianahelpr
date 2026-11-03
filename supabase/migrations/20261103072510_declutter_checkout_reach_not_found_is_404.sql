-- Q2390 packet 17 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for the four functions the declutter-checkout edge function reaches
-- that still raised P0002:
--   declutter_delivery_quote        (called directly by declutter-checkout; STABLE read)
--   declutter_set_delivery_dropoff  (called directly by declutter-checkout as service role)
--   declutter_lock_order            (order row lock helper; 40 SQL callers, reached by the
--                                    edge function through declutter_delivery_raise_start)
--   helpr_task_lock                 (task row lock helper; 18 SQL callers, the same path)
-- The edge function's rpcRefusal map answers 404 for P0002 AND PT404 in the
-- same change (supabase/functions/declutter-checkout/index.ts), so its answer
-- for these refusals stays 404. Each raise fires before its function or its
-- callers write. None creates an order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_delivery_quote               20261021142959 3d7ad4b0446759bd02cf5d3d8c71085d
--   declutter_set_delivery_dropoff         20261017055505 3aaa456a993bd5ae5eebfd9799f6399a
--   declutter_lock_order                   20261028191646 e1b96edd8f5d8646d79847163a64cc3a
--   helpr_task_lock                        20261102045504 3c8a1221cb848328065ab61b7ba2f57d
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_delivery_quote(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  q record;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                  WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id
                    AND c.status = 'in_cart' AND c.checkout_by > now()) THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, NULL);
  RETURN jsonb_build_object('road_miles', q.road_miles, 'size', q.size, 'delivery_cents', q.delivery_cents,
    'base_cents', q.base_cents, 'per_mile_cents', q.per_mile_cents, 'size_cents', q.size_cents,
    'dropoff_area', q.dropoff_area);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delivery_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_quote(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_delivery_dropoff(p_buyer uuid, p_seller uuid, p_address text,
  p_area_label text, p_lat numeric, p_lng numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_buyer IS NULL OR p_seller IS NULL OR p_buyer = p_seller THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 5 AND 300
     OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, address, area_label, lat, lng, geocoded_at)
  VALUES (p_buyer, p_seller, btrim(p_address), left(COALESCE(NULLIF(btrim(p_area_label), ''), 'Drop-off area'), 120),
          round(p_lat, 6), round(p_lng, 6), now())
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET address = EXCLUDED.address, area_label = EXCLUDED.area_label,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, geocoded_at = now();
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_delivery_dropoff(uuid, uuid, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_set_delivery_dropoff(uuid, uuid, text, text, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_lock_order(p_order_id uuid)
RETURNS public.declutter_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
BEGIN
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The notices this transaction writes next are about this order (20261028191646).
  PERFORM public.declutter_notice_about(o.id);
  RETURN o;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_lock_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_lock(p_task uuid)
RETURNS public.helpr_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Q1945: a member who is no party to a task that is not open takes no lock. is_server_context(), not
  -- v_uid IS NOT NULL: anon has a NULL uid too (20260915101102); only the service role skips the check.
  IF NOT public.is_server_context() AND t.status IS DISTINCT FROM 'open'
     AND v_uid IS DISTINCT FROM t.helpr_id AND v_uid IS DISTINCT FROM t.customer_id
     AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.source_kind = 'declutter_delivery' THEN
    PERFORM public.declutter_lock_order(t.source_id);
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task FOR UPDATE;
  RETURN t;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_lock(uuid) TO service_role;

