-- "Need a hand?" knows what was bought (lead 2026-10-28, Confusing #27). The buyer's panel offered "Put it
-- together / Hang it on the wall / Set it up" on a mug because declutter_setup_helpr returned only the items'
-- titles. It now also returns item_details: [{title, category, delivery_size}] per item, in the same order as
-- items, so the client can offer only the set-up kinds that fit.
--
-- Additive only: every existing key ('order_id', 'status', 'handover', 'items' (the titles, unchanged),
-- 'pickup_at', 'jobs') is returned exactly as before, so installed app builds read it unchanged. Same gates
-- (require_feature 'declutter' and 'declutter_add_helpr', the order's buyer only, paid or handed over in the last
-- 30 days, not a seller who is out). Body restated from 20261017073146 (its newest definition) with one key
-- added. CREATE OR REPLACE keeps its grants.
-- Proof: src/test/pglite/declutterSetupHelprItemDetails.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_setup_helpr(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders
   WHERE id = p_order_id AND buyer_id = v_uid;
  -- A seller who can no longer sell (banned, suspended, 3 strikes, ...:
  -- declutter_seller_out) leaves an order that is about to be refunded:
  -- nothing is offered on it (lh-money-escrow review of 4f45a073f #2).
  IF NOT FOUND OR o.status NOT IN ('paid', 'handed_over')
     OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) < now() - interval '30 days')
     OR public.declutter_seller_out(o.seller_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'handover', o.handover,
    'items', COALESCE((
      SELECT jsonb_agg(i.title ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    -- 20261028201659: what each item is, same order as 'items' (#27: no "Hang it on the wall" for a mug).
    'item_details', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('title', i.title, 'category', i.category, 'delivery_size', i.delivery_size)
                       ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    'pickup_at', (SELECT b.slot_start FROM public.declutter_bookings b WHERE b.order_id = o.id),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'job_id', j.id, 'title', j.title, 'category', j.category::text,
               'status', j.status, 'payment_status', j.payment_status)
             ORDER BY l.created_at, j.id)
        FROM public.declutter_order_jobs l
        JOIN public.jobs j ON j.id = l.job_id
       WHERE l.order_id = o.id AND j.customer_id = v_uid), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_setup_helpr(uuid) TO authenticated, service_role;
