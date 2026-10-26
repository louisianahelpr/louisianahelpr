-- The one-time account setup fee is charged ONCE per account, and a member's
-- first Declutter purchase is one of the places it is charged (Q2352; owner
-- 2026-10-22, Declutter terms answer #9: "$2 setup fee charged ONCE per
-- account, whichever comes first (first Jobs payout, or first Declutter
-- buy/listing)"; the published Terms already say so).
--
-- Before: Jobs collected it through one flag, profiles.onboarding_fee_paid
-- (create-payment's first-post line, release-payout / process-scheduled-payouts
-- from a Helpr's first payout, pay-onboarding-fee on its own), and Declutter
-- charged no setup fee anywhere (grep of supabase/functions/declutter-* and
-- every declutter_* function, 2026-10-23).
--
-- Now, for a PURCHASE (and, section 8, the first LISTING: owner 2026-10-23, #3557):
--   1. declutter_orders.setup_fee_cents: declutter_start_checkout freezes
--      platform_settings.onboarding_fee_cents on the order when the buyer's
--      onboarding_fee_paid is not true (else 0). It sits OUTSIDE total_cents:
--      total_cents stays the sale (items + buyer's fee + tax + delivery +
--      shipping, its CHECK unchanged), and every refund of the sale is computed
--      from total_cents, so a sale refunded later keeps the setup fee, as a
--      Jobs refund keeps a first job's setup fee. An open order whose fee no
--      longer matches (paid in Jobs since) is replaced, like a changed cart.
--   2. declutter-checkout adds a "One-time account setup fee" line, so the
--      page charges total_cents + setup_fee_cents, and
--      declutter_mark_order_paid checks the payment against exactly that. A
--      payment answered with a refund (late, superseded, unpayable, party
--      gone) is refunded whole by the existing paths, setup fee included, and
--      claims nothing.
--   3. Only a sale that stands claims the fee: declutter_claim_setup_fee, in
--      both 'paid' answers, flips onboarding_fee_paid with the same one-winner
--      conditional UPDATE the Jobs paths use. When another path won first
--      (Jobs first post, a Helpr payout, the standalone fee page, another
--      Declutter order), the order is marked refund_due and the stripe-webhook
--      sends exactly the setup fee back (declutter_setup_fee_refunded records
--      it); never charged twice.
--   4. declutter_order_refunds_recorded_cents counts a setup fee sent back, so
--      declutter-money's "is the charge whole" check still pays the seller.
--
-- Bodies restated from the NEWEST definitions (src/test/helpers/
-- effectiveFunctionDefs.ts), each matching prod's prosrc md5 on 2026-10-23:
-- declutter_start_checkout (20261017055505), declutter_mark_order_paid
-- (20261020064354), declutter_order_refunds_recorded_cents (20261017055505),
-- declutter_orders_fee_rule_frozen (20261020024605). Only the lines marked
-- Q2352 change.
--
-- Re-cut 2026-10-26 from 20261026154738 (built 2026-10-23, never on main) to
-- sit after main's newest migration; no migration between then and this one
-- redefines any of the four restated functions (grep of 20261023*..20261026*).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints added in guarded DO
-- blocks, CREATE OR REPLACE with unchanged signatures, grants restated.
-- Proof: src/test/pglite/declutterSetupFeeOnce.pglite.mjs (RED before, green
-- applied 3x). Guard: src/test/declutterSetupFeeOnce.test.ts.

-- ---------------------------------------------------------------------------
-- 1. The order carries the setup fee it charged, and what became of it.

ALTER TABLE public.declutter_orders
  ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_fee_state text,
  ADD COLUMN IF NOT EXISTS setup_fee_refund_id text;

COMMENT ON COLUMN public.declutter_orders.setup_fee_cents IS
  'Q2352: the one-time account setup fee charged on this order''s page, outside total_cents (0 when the buyer had paid it). Frozen.';
COMMENT ON COLUMN public.declutter_orders.setup_fee_state IS
  'Q2352: NULL until the sale stands; claimed (this order paid the account''s fee), refund_due (another path paid it first: send it back), refunded, not_charged (the page did not carry it).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_orders_setup_fee'
                   AND conrelid = 'public.declutter_orders'::regclass) THEN
    ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_setup_fee
      CHECK (setup_fee_cents >= 0 AND setup_fee_cents <= 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_orders_setup_fee_state'
                   AND conrelid = 'public.declutter_orders'::regclass) THEN
    ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_setup_fee_state
      CHECK ((setup_fee_state IS NULL OR (setup_fee_cents > 0 AND setup_fee_state IN ('claimed', 'refund_due', 'refunded', 'not_charged')))
             AND (setup_fee_refund_id IS NULL OR setup_fee_state = 'refunded'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The helpers.

-- The setup fee a member's next payment would carry: the platform's live
-- amount while the account has not paid it, else 0. Internal (definer
-- callers only); a member reads their own flag through their profile.
CREATE OR REPLACE FUNCTION public.declutter_setup_fee_due_cents(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_user IS NULL THEN 0
    WHEN COALESCE((SELECT p.onboarding_fee_paid FROM public.profiles p WHERE p.user_id = p_user), false) THEN 0
    ELSE greatest(0, least(10000, COALESCE((SELECT s.onboarding_fee_cents FROM public.platform_settings s LIMIT 1), 0)))
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_due_cents(uuid) FROM PUBLIC, anon, authenticated;

-- A sale that stands claims the account's setup fee, once. The same one-winner
-- conditional UPDATE as the Jobs paths (settleOnboardingFee, release-payout,
-- process-scheduled-payouts, pay-onboarding-fee): exactly one writer flips the
-- flag. A loser's order is marked refund_due; the stripe-webhook sends the fee
-- back. Runs inside declutter_mark_order_paid (service_role, so
-- prevent_self_escalation lets the flag through: is_server_context()).
CREATE OR REPLACE FUNCTION public.declutter_claim_setup_fee(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_won boolean;
BEGIN
  SELECT d.id, d.buyer_id, d.setup_fee_cents, d.setup_fee_state INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.setup_fee_cents <= 0 THEN
    RETURN 'none';
  END IF;
  IF o.setup_fee_state IS NOT NULL THEN
    RETURN o.setup_fee_state;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  UPDATE public.declutter_orders
     SET setup_fee_state = CASE WHEN v_won IS TRUE THEN 'claimed' ELSE 'refund_due' END
   WHERE id = o.id;
  RETURN CASE WHEN v_won IS TRUE THEN 'claimed' ELSE 'refund_due' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_claim_setup_fee(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Every amount the buyer was shown stays frozen, the setup fee included.

CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.fee_rule IS DISTINCT FROM OLD.fee_rule OR NEW.premium_cents IS DISTINCT FROM OLD.premium_cents
     OR NEW.items_cents IS DISTINCT FROM OLD.items_cents OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     -- tax_cents too (money review 1.1): the total CHECK already ties it to the three frozen
     -- amounts, but the freeze names every amount the buyer was shown, so no later CHECK
     -- change can make the tax line the one number a writer may move.
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     -- Slice 5: the delivery fee the buyer was shown.
     OR NEW.delivery_cents IS DISTINCT FROM OLD.delivery_cents
     -- Shipping S1: the shipping the buyer was shown.
     OR NEW.shipping_cents IS DISTINCT FROM OLD.shipping_cents
     -- Q2352: the one-time account setup fee the buyer was shown.
     OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents THEN
    RAISE EXCEPTION 'order_amounts_frozen' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the only handover change ever allowed is the no-Helpr fallback
  -- (row 40), delivery -> pickup at the seller's home, on a paid order.
  IF NEW.handover IS DISTINCT FROM OLD.handover
     AND NOT (OLD.handover = 'delivery' AND NEW.handover = 'pickup_home' AND OLD.status = 'paid') THEN
    RAISE EXCEPTION 'order_handover_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_frozen() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Checkout freezes the setup fee on the order (outside total_cents).

CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
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
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, or Helpr delivery.';
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
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
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off).
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup THEN
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The delivery fee is not part of the item total (row 29 prices it alone).
  v_premium := public.declutter_buyer_fee_cents(v_items);
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. A paid sale: the page's amount is total + setup fee, and the fee is claimed.

CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_honour boolean := false;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_sale_ok boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.status IN ('paid', 'refunded') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  -- Q2352: the page charged the sale plus the one-time setup fee frozen on the order, or the sale alone: a page
  -- opened by a declutter-checkout that did not know the fee yet (the migration deploys before the edge,
  -- functions-deploy.yml waits for db-deploy; lh-money-escrow review of the Q2352 branch #1). Then the fee was
  -- not charged: it is marked so, nothing is claimed, and the account pays it at its next first-time step.
  IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes; the sale stands if
      -- every item is still unsold and the seller can still sell to them.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      v_sale_ok := v_items_ok
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      v_honour := v_sale_ok AND NOT v_cant;
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
        -- thing that stops the sale, the seller (not us) owes the card fee; the
        -- buyer still gets every cent. An item that went elsewhere is ours.
        -- As in path (c): a seller who is out wins over a BUYER who blocked
        -- them; a seller who blocked the buyer is left as before (filed in docs/OPEN.md).
        v_reason := CASE WHEN v_items_ok AND v_cant
                               AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                                                WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                         THEN 'seller_out' ELSE 'sold_elsewhere' END;
        v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
        IF v_reason = 'seller_out' THEN
          PERFORM public.declutter_seller_out_fee_notice(v_refund);
        END IF;
        RETURN public.declutter_refund_answer(v_refund);
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status IN ('live', 'paused');
        FOR v_void IN
          UPDATE public.declutter_offers SET status = 'voided', closed_at = now(), updated_at = now()
           WHERE item_id = r.item_id AND status = 'open'
          RETURNING id, buyer_id
        LOOP
          INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (v_void.id, 'system', 'void');
          PERFORM public.declutter_notify(v_void.buyer_id, 'new_offers', 'Item no longer available',
            format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', r.title),
            '/declutter/item/' || r.item_id::text, o.seller_id);
        END LOOP;
      END LOOP;
      UPDATE public.declutter_cart_items SET status = 'paid', closed_at = now()
       WHERE order_id = p_order_id AND status = 'missed';
      UPDATE public.declutter_orders
         SET status = 'paid', close_reason = NULL, closed_at = NULL, paid_at = now(), stripe_paid_at = p_paid_at,
             stripe_payment_intent_id = p_payment_intent_id,
             card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
       WHERE id = p_order_id AND status = 'expired';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
        format('You paid $%s in time, so the sale stands and there is no strike. Next: pick up your items at the time you chose.',
               to_char(p_amount_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for $%s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               to_char(o.items_cents / 100.0, 'FM999990.00')),
        '/declutter?view=offers', o.buyer_id);
      PERFORM public.declutter_claim_setup_fee(p_order_id);
      RETURN jsonb_build_object('result', 'paid');
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid $%s. Next: pick up your items at the time you chose.', to_char(p_amount_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for $%s of your items. You get paid when the buyer has them.', to_char(o.items_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. A setup fee sent back counts as a known refund on the order's charge.

CREATE OR REPLACE FUNCTION public.declutter_order_refunds_recorded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (COALESCE((SELECT sum(r.refund_cents) FROM public.declutter_refunds r
                     WHERE r.order_id = o.id AND r.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND r.status = 'succeeded'), 0)
        + COALESCE((SELECT sum(d.refund_cents) FROM public.declutter_delivery_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND d.status = 'succeeded'), 0)
        -- Q2352: a setup fee sent back because the account had paid it elsewhere.
        + CASE WHEN o.setup_fee_state = 'refunded' THEN o.setup_fee_cents ELSE 0 END)::integer
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. A setup fee sent back (the account had paid it elsewhere first): the
--    stripe-webhook records the Stripe refund here, once, and the buyer is told.

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_refunded(p_order_id uuid, p_stripe_refund_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
BEGIN
  IF p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^re_' THEN
    RAISE EXCEPTION 'invalid_refund' USING ERRCODE = '22023';
  END IF;
  SELECT d.id, d.buyer_id, d.seller_id, d.setup_fee_cents, d.setup_fee_state, d.setup_fee_refund_id INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.setup_fee_state = 'refunded' THEN
    RETURN CASE WHEN o.setup_fee_refund_id = p_stripe_refund_id THEN 'already' ELSE 'other_refund' END;
  END IF;
  IF o.setup_fee_state IS DISTINCT FROM 'refund_due' THEN
    RETURN 'not_due';
  END IF;
  UPDATE public.declutter_orders
     SET setup_fee_state = 'refunded', setup_fee_refund_id = p_stripe_refund_id
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Setup fee coming back',
    format('You had already paid the one-time account setup fee, so the $%s charged with this order is coming back to your card.',
           to_char(o.setup_fee_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  RETURN 'recorded';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_refunded(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_setup_fee_refunded(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The first LISTING (owner 2026-10-23, issue #3557 answer 1): a member who
--    already paid the setup fee (for Jobs or a Declutter purchase) never pays
--    it again; one who has not pays it BY CARD at their first listing, right
--    after the ID check. A listing going up (draft or paused -> pending review
--    or live, or an INSERT straight in) by its own seller is refused with
--    setup_fee_required_to_list until the account's flag is set; the app then
--    opens the existing one-time fee page (pay-onboarding-fee), whose payment
--    the stripe-webhook claims with the same one-winner write
--    (settleOnboardingFee). The same carve-outs as the ID gate
--    (20261021202226): server writes, another member's row, admins and
--    enrolled test accounts are never asked; the ID switch (identity_check,
--    20261023213857) does NOT waive the fee. The trigger's name sorts after
--    trg_declutter_items_identity_before_list, so the ID check comes first.

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_before_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN
    IF public.is_server_context() OR auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    -- Admins and enrolled test accounts (is_seed AND a test_accounts row) are
    -- never asked. Spelled out here, NOT identity_check_exempt(): since
    -- 20261023213857 that is also true for every member while the ID switch is
    -- off, which would skip the setup fee at every first listing (PGlite step 10).
    IF public.has_role(auth.uid(), 'admin') OR COALESCE((
         SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
           FROM public.profiles p WHERE p.user_id = auth.uid()
       ), false) THEN
      RETURN NEW;
    END IF;
    IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN
      RAISE EXCEPTION 'setup_fee_required_to_list' USING ERRCODE = '42501',
        HINT = 'Your first listing needs the one-time account setup fee. It is charged once per account, and never again if you already paid it for Jobs.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_before_list() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_setup_fee_before_list ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_setup_fee_before_list
  BEFORE INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_setup_fee_before_list();

-- ---------------------------------------------------------------------------
-- 9. A setup-fee refund Stripe failed after taking it (charge.refund.updated):
--    the order owes the fee again (refund_due), so it no longer counts as a
--    known refund, and ops are paged to send it (lh-money-escrow review #2).

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_refund_reversed(p_order_id uuid, p_stripe_refund_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.declutter_orders
     SET setup_fee_state = 'refund_due', setup_fee_refund_id = NULL
   WHERE id = p_order_id AND setup_fee_state = 'refunded' AND setup_fee_refund_id = p_stripe_refund_id;
  RETURN CASE WHEN FOUND THEN 'reopened' ELSE 'not_this' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_refund_reversed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_setup_fee_refund_reversed(uuid, text) TO service_role;
