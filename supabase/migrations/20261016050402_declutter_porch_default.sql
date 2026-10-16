-- Declutter: porch pickup is the default (owner, 2026-10-16, spec row 101:
-- "I'd rather porch pick up and not having to meet someone for a code or qr code").
--
-- 1. declutter_items.porch_ok: the seller's per-item switch, ON by default.
--    The seller turns it off for an item too valuable or too big to leave
--    out; buyers then meet at the seller's home (the code/QR handover).
--    Set only by declutter_set_porch_ok, on the seller's own DRAFT, so it is
--    frozen once the item is listed (nothing moves an item back to draft)
--    and an order can never be paid under a choice that changed after it.
-- 2. declutter_start_checkout refuses handover = 'porch' when any of the
--    cart lines it groups is an item with porch_ok = false (porch_unavailable).
--    Restated from its NEWEST definition, 20261015023613, with only that check
--    added. The app pre-selects porch only when every line allows it; this is
--    the protection, the app is not.
-- 3. declutter_my_cart returns porch_ok per line so the cart can offer porch
--    first, or only pickup at the seller's home. Restated from its NEWEST
--    definition, 20261014224914, with one output column appended (a changed
--    return type needs DROP + CREATE; nothing else calls it in SQL).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF
-- EXISTS before the one CREATE whose return type changes. Applied 3x in PGlite
-- (src/test/pglite/declutterPorchDefault.pglite.mjs).

-- 1. The column ------------------------------------------------------------
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS porch_ok boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.declutter_items.porch_ok IS
  'Porch pickup allowed for this item (spec row 101: porch is the default). FALSE = meet at the seller''s home only. '
  'Set by declutter_set_porch_ok on a draft; declutter_start_checkout refuses porch when any line has it FALSE.';

-- 1b. The seller's switch, on their own draft only ---------------------------
CREATE OR REPLACE FUNCTION public.declutter_set_porch_ok(p_item_id uuid, p_porch_ok boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  IF p_porch_ok IS NULL THEN
    RAISE EXCEPTION 'invalid_porch_choice' USING ERRCODE = '22023';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET porch_ok = p_porch_ok, updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  RETURN p_porch_ok;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_porch_ok(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_ok(uuid, boolean) TO authenticated, service_role;

-- 2. Checkout, restated from 20261015023613 with the porch check added -------
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    -- Row 24's third option, Helpr delivery, is slice 5 (row 63).
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose pickup at the seller''s home or porch pickup. Helpr delivery is coming later.';
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines THEN
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  v_premium := public.declutter_buyer_fee_cents(v_items);
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_items + v_premium)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium, v_old_session, NULL::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text) TO authenticated, service_role;

-- 3. The cart, restated from 20261014224914 with porch_ok appended ----------
DROP FUNCTION IF EXISTS public.declutter_my_cart();
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer,
               porch_ok boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, i.title,
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         c.seller_id, c.price_cents, c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         i.porch_ok
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;
