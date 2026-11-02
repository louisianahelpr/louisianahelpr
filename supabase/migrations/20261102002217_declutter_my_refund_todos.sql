-- A3-81 (audit 11-01, High): Home's Next up, To do and the nav badges never named a Declutter refund request that
-- waits on the member. A seller with an open request has 24 hours to answer (answer_by; after that it goes to
-- Louisiana Helpr), and Home said "You're all caught up". The only read of a request was
-- declutter_refund_request_view, one order at a time, and the table itself is not readable by members.
--
-- This adds one member-wide READ (no write, no money): declutter_my_refund_todos() returns the refund requests that
-- wait on the caller right now, each with its deadline:
--   * the SELLER, for a request still 'open' (answer by answer_by);
--   * the BUYER, for a part offer still 'offered' (answer by offer_answer_by).
-- A request past its deadline is left out (the refund sweep moves it on). The item's title comes from the order's
-- cart lines (first by created_at) with the order's line count. Behind the same switch as every refund RPC
-- ('declutter_refund_requests'), but a Home read must not throw: with the switch off for the caller it returns no
-- rows instead of raising. SECURITY DEFINER because members cannot read declutter_refund_requests; each row is
-- limited to an order where the caller is the buyer or the seller.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a new function; the grants are restated after it.

CREATE OR REPLACE FUNCTION public.declutter_my_refund_todos()
 RETURNS TABLE(request_id uuid, order_id uuid, my_side text, status text, due_at timestamp with time zone,
               title text, item_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.feature_enabled_for('declutter_refund_requests') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT r.id, o.id,
         CASE WHEN o.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         r.status,
         CASE WHEN r.status = 'open' THEN r.answer_by ELSE r.offer_answer_by END,
         (SELECT COALESCE(i.title, c.item_title, 'An item')
            FROM public.declutter_cart_items c
            LEFT JOIN public.declutter_items i ON i.id = c.item_id
           WHERE c.order_id = o.id
           ORDER BY c.created_at, c.id
           LIMIT 1),
         (SELECT count(*)::integer FROM public.declutter_cart_items c WHERE c.order_id = o.id)
    FROM public.declutter_refund_requests r
    JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE (r.status = 'open' AND o.seller_id = v_uid AND r.answer_by > now())
      OR (r.status = 'offered' AND o.buyer_id = v_uid AND r.offer_answer_by > now())
   ORDER BY 5
   LIMIT 50;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_my_refund_todos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_refund_todos() TO authenticated, service_role;
