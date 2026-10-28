-- Declutter notices name the item (Declutter audit 2, SH2-1 / A2-1, 2026-10-28; lead's design (B)).
--
-- WHAT WAS WRONG: suppress_exact_duplicate_notification (20260912045624) drops a notice whose user, type,
-- title, message and link match one sent in the last 10 minutes. 81 of the 117 Declutter notices that open a
-- Declutter screen (counted on main's migrations, 2026-10-28) do not name the item, so a second order's
-- "You missed your pickup", "It's yours", "Free item claimed", "Pickup booked" or "Enjoy your item" was the
-- same text as the first and was dropped: 5 rows in notification_dedupe_suppressions in the audit run, the
-- buyer never told about the basket's missed pickup.
--
-- WHAT THIS DOES (one writer, no RPC restated but the lock):
--   1. declutter_notice_about(order): records, for this TRANSACTION only (set_config(..., true)), which order
--      the notices being written are about. PostgREST runs each request in its own transaction and exposes no
--      way for a member to call set_config, so the value is only ever ours and never outlives the transaction.
--   2. declutter_lock_order (restated from 20261015042253, its newest definition) calls it: every RPC and
--      sweep step that locks an order before acting names that order. A sweep locks each order in turn, so
--      each order's notices name their own item.
--   3. declutter_notice_names_item(user, other, link, message): the message with the item's name in front
--      ("Lamp: ..." / "Lamp and 2 more: ...") ONLY when the recorded order's buyer and seller are exactly the
--      notice's user and its counterpart, the link is a Declutter screen and the message does not already
--      name it. Otherwise (no order recorded, an admin or a Helpr notice, a notice with no counterpart, a
--      different pair, a deleted item) the message is returned unchanged: never a wrong item, at worst today's
--      text.
--   4. declutter_notify_strict (restated from 20261028171944, its newest definition): the message passes
--      through (3) before the price rule. Everything else (seed rule, kind routing, the INSERT) is verbatim.
--   5. trg_declutter_orders_a_notice_about: inserting or updating an order records it as (1) does, for the
--      paths that write the order without locking it (paid, free checkout, the delivery triggers).
-- Notices only; no money path changes.
-- Proof: src/test/pglite/declutterNoticesNameTheItem.pglite.mjs (applied 3x; red without this migration).
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; every object exists on prod and in every earlier world.

-- 1. Which order this transaction's notices are about.
CREATE OR REPLACE FUNCTION public.declutter_notice_about(p_order_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT set_config('declutter.notice_order', COALESCE(p_order_id::text, ''), true);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_about(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_about(uuid) TO service_role;

-- 2. Restated from 20261015042253. One change: it records the order for this transaction's notices.
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The notices this transaction writes next are about this order (20261028191646).
  PERFORM public.declutter_notice_about(o.id);
  RETURN o;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_lock_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_order(uuid) TO service_role;

-- 3. The message, with the item named when (and only when) the recorded order is between these two people.
CREATE OR REPLACE FUNCTION public.declutter_notice_names_item(p_user uuid, p_other uuid, p_link text, p_message text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref text := NULLIF(current_setting('declutter.notice_order', true), '');
  v_order uuid;
  v_first text;
  v_n integer;
  v_words text;
BEGIN
  IF v_ref IS NULL OR p_user IS NULL OR p_other IS NULL OR p_link IS NULL OR p_link NOT LIKE '/declutter%'
     OR v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN p_message;
  END IF;
  SELECT o.id INTO v_order
    FROM public.declutter_orders o
   WHERE o.id = v_ref::uuid
     AND ((o.buyer_id = p_user AND o.seller_id = p_other) OR (o.seller_id = p_user AND o.buyer_id = p_other));
  IF v_order IS NULL THEN
    RETURN p_message;
  END IF;
  SELECT count(*)::integer, (array_agg(btrim(i.title) ORDER BY c.created_at, c.id))[1]
    INTO v_n, v_first
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = v_order AND NULLIF(btrim(i.title), '') IS NOT NULL;
  IF v_first IS NULL OR position(v_first IN COALESCE(p_message, '')) > 0 THEN
    RETURN p_message;
  END IF;
  v_words := left(v_first, 80) || CASE WHEN v_n > 1 THEN format(' and %s more', v_n - 1) ELSE '' END;
  RETURN CASE WHEN NULLIF(btrim(p_message), '') IS NULL THEN v_words ELSE v_words || ': ' || p_message END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_names_item(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_names_item(uuid, uuid, text, text) TO service_role;

-- 4. Restated from 20261028171944. One change: the message names the item (3) before the price rule.
CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Q137: a seed (test) counterpart never notifies a real member.
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  -- Prices read the way the app shows them (src/lib/declutter/distance.ts
  -- formatPrice): whole dollars drop ".00", so "$30.00" is "$30" and "$30.50"
  -- stays. Every Declutter notice passes here, so callers that still format
  -- with to_char(..., 'FM999990.00') read right without being restated.
  -- The item is named first (20261028191646), so two orders' notices differ.
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, p_link), p_title,
          public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, p_link, p_message)), p_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;

-- 5. A write to an order records it too (lead 2026-10-28, follow-up): the paths that notify without locking
--    the order (declutter_mark_order_paid's "Buyer paid" / "Payment received", declutter_checkout_free's "It's
--    yours" / "Free item claimed", and the seller-delivery and Helpr-delivery triggers that fire on the order's
--    status) update or insert the order row first. AFTER row triggers fire in name order, so this one ("a_")
--    runs before trg_declutter_orders_delivery_task and trg_declutter_orders_seller_delivery. The party check
--    in (3) still decides whether the item is named.
CREATE OR REPLACE FUNCTION public.declutter_orders_notice_about()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Definer: a write by any role records the order; it never fails the write for lack of a grant.
  PERFORM public.declutter_notice_about(NEW.id);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_notice_about() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_a_notice_about ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_a_notice_about
  AFTER INSERT OR UPDATE ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_notice_about();
