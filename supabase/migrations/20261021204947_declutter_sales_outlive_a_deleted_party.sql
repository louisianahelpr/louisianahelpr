-- DECLUTTER: A FINISHED SALE OUTLIVES A DELETED ACCOUNT (Q2307; owner 2026-10-22, Declutter terms answer #12:
-- "finished sales stay for the other side as 'Former member'").
--
-- Measured on prod 2026-10-21 (read-only pg_constraint): declutter_orders.buyer_id / seller_id and
-- declutter_cart_items.buyer_id / seller_id are ON DELETE CASCADE to auth.users, while declutter_payouts.order_id and
-- declutter_delivery_refunds.order_id are ON DELETE RESTRICT. So deleting either party of a sale either erased the
-- other side's record of it, or, once a payout or delivery refund row existed, made the account deletion error half
-- way. Money history must survive (the payout and refund rows are what we paid and refunded).
--
-- Now: the party columns of an order and of its cart lines are nullable and ON DELETE SET NULL, so the order, its
-- lines and every money row stay, and the other side reads the gone party as "Former member" (the shared label,
-- src/lib/deletedPerson.ts). A cart line's item_id is SET NULL too: the seller's listings and photos are still
-- erased with the account (declutter_items.seller_id stays CASCADE), and the buyer keeps the line's price.
-- What stays for the other side is money only (owner/lead privacy rule 2026-10-21): declutter_scrub_member, called
-- by the account purge before the auth user goes, clears the deleted member's words, photos and addresses on those
-- orders (lh-authz-rls review 2026-10-21 #1, #2, #5): the porch note on their sales; their problem reports' words and
-- photos (the report keeps its decision and fault, which the money follows); the review comments and tags they wrote
-- (a review they received goes with them, reviewee_id CASCADE); their drop-off address on the order's delivery row; and
-- their home address on finished Helpr delivery tasks (pickup for a seller, drop-off for a buyer). Handover and task
-- photo PATHS stay because CHECKs tie them to the handover times; the files go in the purge's storage step. (Shops'
-- shipments.ship_to is not Declutter; it is filed in docs/OPEN.md with this change.)
-- A sale still in flight blocks the deletion first (accountPurge.ts findDeclutterInFlight), so a party column is NULL
-- only on a settled order: no sweep, payout or notice acts on it (declutter_notify skips a NULL member).
-- Replay-safe: DROP NOT NULL is idempotent; each FK is dropped by name and re-added; CREATE OR REPLACE.

ALTER TABLE public.declutter_orders ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE public.declutter_orders ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_buyer_id_fkey;
ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_seller_id_fkey;
ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.declutter_cart_items ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE public.declutter_cart_items ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.declutter_cart_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_buyer_id_fkey;
ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_seller_id_fkey;
ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_item_id_fkey;
ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.declutter_items(id) ON DELETE SET NULL;

-- The deleted member's own words and photos on the orders that stay. Service role only (the purge calls it).
CREATE OR REPLACE FUNCTION public.declutter_scrub_member(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_handovers integer := 0;
  v_problems integer := 0;
  v_deliveries integer := 0;
  v_tasks integer := 0;
  v_reviews integer := 0;
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;
  -- The porch note is the seller's words; on a sale with someone who is leaving, it goes.
  UPDATE public.declutter_handovers h
     SET set_out_note = NULL
    FROM public.declutter_orders o
   WHERE h.order_id = o.id AND (o.buyer_id = p_user_id OR o.seller_id = p_user_id) AND h.set_out_note IS NOT NULL;
  GET DIAGNOSTICS v_handovers = ROW_COUNT;
  -- Their drop-off address on the delivery row of a sale they bought (NOT NULL columns: placeholders).
  UPDATE public.declutter_order_deliveries d
     SET dropoff_address = 'Removed: account deleted', dropoff_area = 'Removed', dropoff_lat = 0, dropoff_lng = 0
    FROM public.declutter_orders o
   WHERE d.order_id = o.id AND o.buyer_id = p_user_id AND d.dropoff_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;
  -- Their home address on FINISHED Helpr delivery tasks (a task still running blocks the deletion first).
  UPDATE public.helpr_tasks t
     SET pickup_address = 'Removed: account deleted', pickup_area = 'Removed', pickup_lat = 0, pickup_lng = 0
   WHERE t.pickup_contact_id = p_user_id AND t.status IN ('confirmed', 'cancelled', 'failed', 'unfilled')
     AND t.pickup_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;
  UPDATE public.helpr_tasks t
     SET dropoff_address = 'Removed: account deleted', dropoff_area = 'Removed', dropoff_lat = 0, dropoff_lng = 0
   WHERE t.customer_id = p_user_id AND t.status IN ('confirmed', 'cancelled', 'failed', 'unfilled')
     AND t.dropoff_address IS DISTINCT FROM 'Removed: account deleted';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_tasks := v_tasks + v_rows;
  -- The reviews they wrote keep the stars (the other side's rating), not their words or tags.
  UPDATE public.declutter_reviews r
     SET comment = NULL, tags = '{}'
   WHERE r.reviewer_id = p_user_id AND (r.comment IS NOT NULL OR cardinality(r.tags) > 0);
  GET DIAGNOSTICS v_reviews = ROW_COUNT;
  -- Their problem reports keep the decision (money and fault), not their words or photos (note is NOT NULL, 1..1000).
  UPDATE public.declutter_problems p
     SET note = 'Removed: this member deleted their account.', photo_paths = '{}'
   WHERE p.reporter_id = p_user_id
     AND (p.note IS DISTINCT FROM 'Removed: this member deleted their account.' OR cardinality(p.photo_paths) > 0);
  GET DIAGNOSTICS v_problems = ROW_COUNT;
  RETURN jsonb_build_object('handovers_scrubbed', v_handovers, 'problem_reports_scrubbed', v_problems,
    'delivery_addresses_scrubbed', v_deliveries, 'task_addresses_scrubbed', v_tasks, 'reviews_scrubbed', v_reviews);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_scrub_member(uuid) TO service_role;

-- The member's own cart and sales list (what the other side of a kept sale reads): restated from 20261017055505 (its
-- newest definition) with these changes only (title and porch_ok COALESCEd): the item is a LEFT JOIN, so a sale whose seller deleted their account (the
-- listing went with them, the line's item_id is NULL) still shows, as an item from a former member, with its price.
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer,
               porch_ok boolean, delivery_cents integer, delivery_task_id uuid)
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
  SELECT c.id, c.item_id, COALESCE(i.title, 'An item from a former member'),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         c.seller_id, c.price_cents, c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;

-- A payment that lands on an order a party has left (its page was still open when the line expired or the seller
-- cancelled, then the party deleted their account) is refunded automatically, never applied (lh-money-escrow review
-- 2026-10-21 #3). The webhook calls this instead of declutter_mark_order_paid for such an order; the platform carries the
-- card fee ('order_closed'). Replays answer the same refund.
CREATE OR REPLACE FUNCTION public.declutter_refund_party_gone(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF FOUND AND o.buyer_id IS NOT NULL AND o.seller_id IS NOT NULL THEN
    RAISE EXCEPTION 'party_present' USING ERRCODE = '22023', HINT = 'Both parties are still here: declutter_mark_order_paid decides.';
  END IF;
  -- The payment that already paid this order (a replayed event for a settled sale): never refunded here
  -- (lh-money-escrow re-review 2026-10-21 R1).
  IF o.id IS NOT NULL AND o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id
     AND o.status IN ('paid', 'handed_over', 'refunded') THEN
    RETURN jsonb_build_object('result', 'already_paid');
  END IF;
  SELECT r.id INTO v_refund FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  RETURN public.declutter_refund_answer(public.declutter_record_refund(
    o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_party_gone(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_party_gone(uuid, text, integer, integer) TO service_role;

-- Backstop: no path may mark an order paid once a party has left it (review #3: mark_order_paid's "paid in time,
-- recorded late" path would otherwise pass a deleted seller).
CREATE OR REPLACE FUNCTION public.declutter_orders_refuse_paid_without_party()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'paid' AND (NEW.buyer_id IS NULL OR NEW.seller_id IS NULL) THEN
    RAISE EXCEPTION 'order_party_gone' USING ERRCODE = '55000',
      HINT = 'A party of this order deleted their account: refund the payment (declutter_refund_party_gone).';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_refuse_paid_without_party() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_refuse_paid_without_party ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_refuse_paid_without_party
  BEFORE INSERT OR UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_orders_refuse_paid_without_party();

