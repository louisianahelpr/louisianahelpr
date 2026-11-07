-- Shops Helpr delivery: the shop sees the booked Helpr's pickup time (Builder 5, 11-07; lead: "show the booked Helpr
-- slot on the shop screens and hide the no-show button until the slot has started").
--
-- shops_order_helpr_task(order) returns the order's helpr_tasks id (source_kind 'shop_delivery'), or NULL while there
-- is none, to the order's shop owner or buyer only (anyone else: order_not_found). The card then reads the task through
-- helpr_task_view, which already answers the task's customer (the buyer) and pickup contact (the shop owner, set by
-- shop_delivery_open_task, 20261106194913) with the booked slot, the Helpr's first name, the status, the handover and
-- whether a problem holds the order. This returns an id only: no address, amount or other column.
-- Replay-safe: CREATE OR REPLACE; grants restated.
CREATE OR REPLACE FUNCTION public.shops_order_helpr_task(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('shops');
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR (o.seller_id IS DISTINCT FROM v_uid AND o.buyer_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.fulfillment IS DISTINCT FROM 'helpr_delivers' THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT t.id FROM public.helpr_tasks t WHERE t.source_kind = 'shop_delivery' AND t.source_id = o.id LIMIT 1);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_helpr_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_helpr_task(uuid) TO authenticated, service_role;
