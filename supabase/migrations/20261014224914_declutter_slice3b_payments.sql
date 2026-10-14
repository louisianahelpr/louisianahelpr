-- DECLUTTER, SLICE 3b (server half): paying. Card on file, the order's
-- Stripe Checkout Session, the webhook's mark-paid with refund REASONS, the
-- seller card-fee debt ledger, late-but-in-time payments, price drops that stop
-- above the floor, the switch turned off mid-sale, and withdraw voiding offers.
-- Owner rows "row N" and build decisions "B<n>" from
-- docs/specs/declutter-auctions.md (this slice adds B39-B47).
--
-- NOTHING HERE CHARGES A CARD (rows 6/36/59). The buyer pays on Stripe's page;
-- the declutter-checkout edge function creates that page for exactly
-- total_cents and the stripe-webhook branch calls declutter_mark_order_paid.
-- The money stays on the platform (separate charges and transfers) until
-- slice 4's handover pays items_cents to the seller.
--
-- REFUNDS HAVE A REASON (B40). Every refund is a declutter_refunds row with a
-- reason and the fee policy that reason carries, decided HERE (a table CHECK
-- ties policy to reason and amount to policy), never by the caller:
--   OUR MISTAKE -> 'full_platform_absorbs' (owner 10-14 ~3:25 AM: our-mistake
--     refunds stay FULL): superseded, order_closed, amount_mismatch,
--     duplicate_payment, order_missing, sold_elsewhere.
--   SELLER BACKED OUT AFTER THE BUYER PAID (row 60) -> 'full_seller_pays_fee':
--     the buyer gets every cent back and the card fee Stripe kept becomes a
--     declutter_seller_fee_debts row, taken from the seller's future Declutter
--     payouts by declutter_consume_fee_debt (slice 4).
--   ANY OTHER BUYER-CAUSED REFUND -> 'keep_card_fee' (owner: never absorb a
--     fee): the refund is the payment minus the card fee.
-- The webhook executes a refund row with Stripe (idempotency key = the row id)
-- and records the outcome with declutter_refund_executed.
--
-- LATE RECORD, IN-TIME PAYMENT (B41). A payment's own Stripe time (the event's
-- `created`, signed by Stripe) decides, not when the webhook arrived. Paid by
-- the deadline + the 1 h grace -> honoured: the missed-checkout strike is
-- removed and, if every item is still unsold, the order is paid; if another
-- buyer took an item meanwhile, the buyer is refunded in full (our mistake).
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Grants by role
-- name, REVOKE ... FROM PUBLIC, anon. Applied 3x by the PGlite proof
-- (src/test/pglite/declutterSlice3b.pglite.mjs).

-- ---------------------------------------------------------------------------
-- 0. Columns.
ALTER TABLE public.declutter_buyer_cards
  ADD COLUMN IF NOT EXISTS card_mode text NOT NULL DEFAULT 'live';
DO $do$
BEGIN
  ALTER TABLE public.declutter_buyer_cards DROP CONSTRAINT IF EXISTS declutter_buyer_cards_mode;
  ALTER TABLE public.declutter_buyer_cards ADD CONSTRAINT declutter_buyer_cards_mode CHECK (card_mode IN ('live', 'test'));
END
$do$;

ALTER TABLE public.declutter_orders
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS card_fee_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_paid_at timestamptz;
DO $do$
BEGIN
  -- 'refunded': a PAID order whose money went back (row 60 / slice 4).
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_status_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_status_check
    CHECK (status IN ('awaiting_payment', 'paid', 'superseded', 'expired', 'refunded'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_close_reason;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_close_reason
    CHECK (close_reason IS NULL OR close_reason IN (
      'superseded',       -- the buyer restarted checkout
      'session_expired',  -- the Stripe page timed out; checkout made a new order
      'missed_checkout',  -- the deadline sweep (rows 7, 59)
      'seller_cancelled', -- declutter_seller_cancel_sale (row 19)
      'seller_blocked',   -- the seller blocked the buyer (sweep)
      'seller_out',       -- the seller can no longer sell (sweep)
      'not_payable',      -- a payment found the order no longer payable
      'refunded'));       -- a paid order refunded (row 60 / slice 4)
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_fee_sane;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_fee_sane
    CHECK (card_fee_cents IS NULL OR (card_fee_cents >= 0 AND card_fee_cents <= total_cents));
END
$do$;

-- B42 (row 61): where the evening drops stop, chosen once per item, 2-8% above
-- the hidden floor. Private like the floor (this table has no client privilege).
ALTER TABLE public.declutter_item_private
  ADD COLUMN IF NOT EXISTS drop_stop_cents integer;
DO $do$
BEGIN
  ALTER TABLE public.declutter_item_private DROP CONSTRAINT IF EXISTS declutter_item_private_stop_above_floor;
  ALTER TABLE public.declutter_item_private ADD CONSTRAINT declutter_item_private_stop_above_floor
    CHECK (drop_stop_cents IS NULL OR drop_stop_cents > floor_price_cents);
END
$do$;

-- Which cart line a strike was for (so an in-time payment can remove it, B41).
ALTER TABLE public.declutter_strikes
  ADD COLUMN IF NOT EXISTS cart_line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS declutter_strikes_line_idx ON public.declutter_strikes (cart_line_id) WHERE cart_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Refunds (B40) and the seller fee debt ledger (row 60, B43).
CREATE TABLE IF NOT EXISTS public.declutter_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  -- One refund per payment: a replayed webhook finds the same row.
  stripe_payment_intent_id text NOT NULL UNIQUE CHECK (stripe_payment_intent_id ~ '^pi_'),
  reason text NOT NULL CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out',
    'buyer_cancelled', 'buyer_restarted_checkout')),
  fee_policy text NOT NULL CHECK (fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee')),
  paid_cents integer NOT NULL CHECK (paid_cents > 0),
  card_fee_cents integer NOT NULL CHECK (card_fee_cents >= 0),
  refund_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  stripe_refund_ref text UNIQUE,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT declutter_refunds_amount CHECK (
    refund_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents ELSE paid_cents END
    AND refund_cents > 0),
  CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason = 'seller_backed_out' THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout') THEN 'keep_card_fee'
                      ELSE 'full_platform_absorbs' END)
);
CREATE INDEX IF NOT EXISTS declutter_refunds_order_idx ON public.declutter_refunds (order_id);
CREATE INDEX IF NOT EXISTS declutter_refunds_pending_idx ON public.declutter_refunds (created_at) WHERE status <> 'succeeded';
ALTER TABLE public.declutter_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_refunds FROM PUBLIC, anon, authenticated;
-- The two sides of the order read its refund (not the Stripe ids).
GRANT SELECT (id, order_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents, status, created_at, executed_at)
  ON TABLE public.declutter_refunds TO authenticated;
GRANT ALL ON TABLE public.declutter_refunds TO service_role;
DROP POLICY IF EXISTS "declutter refunds: the two sides read" ON public.declutter_refunds;
CREATE POLICY "declutter refunds: the two sides read" ON public.declutter_refunds
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = declutter_refunds.order_id
                    AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));

CREATE TABLE IF NOT EXISTS public.declutter_seller_fee_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- One debt per refund: a replay can never charge the seller twice.
  refund_id uuid NOT NULL UNIQUE REFERENCES public.declutter_refunds(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  -- What is still owed. Never negative, never more than the debt.
  remaining_cents integer NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_fee_debt_remaining CHECK (remaining_cents BETWEEN 0 AND amount_cents)
);
CREATE INDEX IF NOT EXISTS declutter_fee_debts_seller_idx ON public.declutter_seller_fee_debts (seller_id, created_at);
ALTER TABLE public.declutter_seller_fee_debts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_seller_fee_debts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, seller_id, amount_cents, remaining_cents, created_at) ON TABLE public.declutter_seller_fee_debts TO authenticated;
GRANT ALL ON TABLE public.declutter_seller_fee_debts TO service_role;
DROP POLICY IF EXISTS "declutter fee debts: seller reads own" ON public.declutter_seller_fee_debts;
CREATE POLICY "declutter fee debts: seller reads own" ON public.declutter_seller_fee_debts
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.declutter_fee_debt_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.declutter_seller_fee_debts(id) ON DELETE CASCADE,
  -- The payout this came out of (slice 4: its transfer group / order id).
  payout_ref text NOT NULL CHECK (char_length(payout_ref) BETWEEN 1 AND 200),
  deducted_cents integer NOT NULL CHECK (deducted_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One payout takes from one debt at most once.
  CONSTRAINT declutter_fee_deduction_once UNIQUE (payout_ref, debt_id)
);
CREATE INDEX IF NOT EXISTS declutter_fee_deductions_debt_idx ON public.declutter_fee_debt_deductions (debt_id);
ALTER TABLE public.declutter_fee_debt_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_fee_debt_deductions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_fee_debt_deductions TO service_role;

-- is_seed at birth (B16's rule) for the two new money tables.
CREATE OR REPLACE FUNCTION public.declutter_money_rows_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'declutter_refunds' THEN
    NEW.is_seed := COALESCE((SELECT o.is_seed FROM public.declutter_orders o WHERE o.id = NEW.order_id), false);
  ELSE
    NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.seller_id), false);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_money_rows_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_refunds_seed ON public.declutter_refunds;
CREATE TRIGGER trg_declutter_refunds_seed BEFORE INSERT ON public.declutter_refunds
  FOR EACH ROW EXECUTE FUNCTION public.declutter_money_rows_seed();
DROP TRIGGER IF EXISTS trg_declutter_fee_debts_seed ON public.declutter_seller_fee_debts;
CREATE TRIGGER trg_declutter_fee_debts_seed BEFORE INSERT ON public.declutter_seller_fee_debts
  FOR EACH ROW EXECUTE FUNCTION public.declutter_money_rows_seed();

-- Q807: every table created after it carries the unconfirmed-email write gate
-- (no client writes these tables at all; the gate is the house rule).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 2. Helpers.

-- Stripe's US card price (2.9% + 30c), used only when the webhook could not
-- read the fee Stripe actually kept from the charge's balance transaction.
CREATE OR REPLACE FUNCTION public.declutter_card_fee_estimate(p_amount_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT least(greatest(p_amount_cents, 0), round(greatest(p_amount_cents, 0) * 0.029)::integer + 30);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_card_fee_estimate(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_card_fee_estimate(integer) TO service_role;

-- A strike now records its cart line (B41). Same behaviour as slice 3.
DROP FUNCTION IF EXISTS public.declutter_give_strike(uuid, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text,
  p_line uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.declutter_strikes (user_id, offender_side, reason, item_id, given_at, expires_at, cart_line_id)
  VALUES (p_user, p_side, p_reason, p_item, now(), now() + interval '1 year', p_line);
  v_n := public.declutter_active_strike_count(p_user);
  PERFORM public.declutter_notify(p_user, 'warning', 'You got a Declutter strike',
    format('%s You have %s of 3 strikes. Each strike goes away 1 year after you got it. At 3 strikes you cannot buy or sell on Declutter until one goes away.',
           p_why, least(v_n, 3)),
    '/declutter?view=offers');
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_give_strike(uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_give_strike(uuid, text, text, uuid, text, uuid) TO service_role;

-- Record a refund (B40). The reason decides the fee policy and the amount; a
-- seller_backed_out refund also books the card fee as the seller's debt (row
-- 60). Idempotent per PaymentIntent: the same payment returns its first row.
CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_seller uuid;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason = 'seller_backed_out' THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout') THEN 'keep_card_fee'
                   ELSE 'full_platform_absorbs' END;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;

-- The answer the webhook acts on. VOLATILE on purpose: it reads the row
-- declutter_record_refund just wrote in the same expression, and a STABLE
-- function would read the snapshot from before that insert (NULL answer).
CREATE OR REPLACE FUNCTION public.declutter_refund_answer(p_refund_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('result', 'refund', 'refund_id', r.id, 'reason', r.reason, 'fee_policy', r.fee_policy,
                            'refund_cents', r.refund_cents, 'refund_status', r.status)
    FROM public.declutter_refunds r WHERE r.id = p_refund_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_answer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_answer(uuid) TO service_role;

-- The webhook reports what Stripe did with a refund row. A succeeded row is
-- final (a late failure report cannot undo it).
CREATE OR REPLACE FUNCTION public.declutter_refund_executed(p_refund_id uuid, p_stripe_refund_id text, p_succeeded boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  UPDATE public.declutter_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_ref = COALESCE(p_stripe_refund_id, stripe_refund_ref),
         executed_at = now()
   WHERE id = p_refund_id AND status <> 'succeeded'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Card on file (row 36, B39): written only by the webhook after the buyer
--    saved a card on Stripe's setup page. Replaces any earlier card.
CREATE OR REPLACE FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text,
  p_brand text, p_last4 text, p_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, brand, last4, card_mode, saved_at)
  VALUES (p_user, p_customer, p_payment_method, left(p_brand, 20),
          CASE WHEN p_last4 ~ '^[0-9]{4}$' THEN p_last4 END, p_mode, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stripe_customer_id = EXCLUDED.stripe_customer_id, payment_method_id = EXCLUDED.payment_method_id,
        brand = EXCLUDED.brand, last4 = EXCLUDED.last4, card_mode = EXCLUDED.card_mode, saved_at = now();
  PERFORM public.declutter_notify(p_user, 'payment', 'Card saved',
    'Your card is saved for Declutter. It is never charged until you check out and pay.', '/declutter');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Price drops stop above the floor (row 61, B42).
CREATE OR REPLACE FUNCTION public.declutter_pick_drop_stop(p_floor integer)
RETURNS integer
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- 2% to 8% above the floor, at least 1 cent above it.
  SELECT p_floor + greatest(1, round(p_floor * (0.02 + random() * 0.06))::integer);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pick_drop_stop(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pick_drop_stop(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_item_private_drop_stop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Chosen once per item; chosen again only when the seller changes the floor.
  IF TG_OP = 'INSERT' OR NEW.floor_price_cents IS DISTINCT FROM OLD.floor_price_cents OR NEW.drop_stop_cents IS NULL THEN
    NEW.drop_stop_cents := public.declutter_pick_drop_stop(NEW.floor_price_cents);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_private_drop_stop() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_item_private_drop_stop ON public.declutter_item_private;
CREATE TRIGGER trg_declutter_item_private_drop_stop BEFORE INSERT OR UPDATE ON public.declutter_item_private
  FOR EACH ROW EXECUTE FUNCTION public.declutter_item_private_drop_stop();
-- Existing items get theirs (the trigger fills a NULL on any update).
UPDATE public.declutter_item_private SET drop_stop_cents = NULL WHERE drop_stop_cents IS NULL;

CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_n integer := 0;
  r record;
BEGIN
  FOR r IN
    UPDATE public.declutter_items i
       -- Never below the stop point, which is always above the floor (B42).
       SET current_price_cents = greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents),
                                          floor(i.current_price_cents * 0.95)::integer),
           last_price_drop_on = v_today,
           price_dropped_at = now(),
           updated_at = now()
      FROM public.declutter_item_private p
     WHERE p.item_id = i.id
       AND i.status = 'live'
       AND i.sale_mode = 'offers'
       AND i.live_at IS NOT NULL AND i.live_at <= now() - interval '12 hours'
       AND i.current_price_cents > greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents))
       AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)
    RETURNING i.id, i.title, i.current_price_cents, i.is_seed
  LOOP
    v_n := v_n + 1;
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT w.user_id, 'info', 'Price dropped',
           format('"%s" is now $%s.', r.title, to_char(r.current_price_cents / 100.0, 'FM999990.00')),
           '/declutter/item/' || r.id::text
      FROM public.declutter_watchlist w
      LEFT JOIN public.profiles wp ON wp.user_id = w.user_id
     WHERE w.item_id = r.id
       -- Q137: a seed (test) listing never alerts a real watcher.
       AND (NOT r.is_seed OR COALESCE(wp.is_seed, false));
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Checkout (B30 restated). Row 62 (B44): an AGREED sale can check out with
--    the switch off; the cart line is the proof of agreement, and an empty
--    cart says nothing. Otherwise verbatim from 20261014210518 + close_reason.
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

  v_premium := greatest(round(v_items * 0.15)::integer, 100);
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

-- Record the Stripe Checkout Session the edge function created (service only).
-- Idempotent for the SAME session (two concurrent calls share one Stripe
-- idempotency key, so they hold the same session id); never replaces another.
CREATE OR REPLACE FUNCTION public.declutter_attach_checkout_session(p_order_id uuid, p_session_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_(test|live)_' THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_orders SET stripe_checkout_session_id = p_session_id
   WHERE id = p_order_id AND status = 'awaiting_payment'
     AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = p_session_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '55000';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_attach_checkout_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_attach_checkout_session(uuid, text) TO service_role;

-- The order's Stripe page timed out unpaid (Stripe said so): retire the order
-- so the next declutter_start_checkout makes a fresh one with a fresh page.
-- Only the buyer's own awaiting order holding exactly that session.
CREATE OR REPLACE FUNCTION public.declutter_retire_order(p_order_id uuid, p_buyer uuid, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.declutter_orders
     SET status = 'superseded', close_reason = 'session_expired', closed_at = now()
   WHERE id = p_order_id AND buyer_id = p_buyer AND status = 'awaiting_payment'
     AND stripe_checkout_session_id = p_session_id;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_retire_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_retire_order(uuid, uuid, text) TO service_role;

-- The Stripe page of the order a seller just cancelled out of (B45), for the
-- edge function to expire so the dead order cannot be paid. Seller-scoped.
CREATE OR REPLACE FUNCTION public.declutter_cancelled_sale_session(p_item_id uuid, p_seller uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.stripe_checkout_session_id
    FROM public.declutter_cart_items c
    JOIN public.declutter_orders o ON o.id = c.order_id
   WHERE c.item_id = p_item_id AND c.seller_id = p_seller AND c.status = 'cancelled_by_seller'
     AND o.close_reason = 'seller_cancelled' AND o.stripe_checkout_session_id IS NOT NULL
   ORDER BY o.closed_at DESC NULLS LAST
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_cancelled_sale_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_cancelled_sale_session(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The webhook's call (B40, B41). Returns jsonb:
--   {result:'paid'} | {result:'already_paid'} |
--   {result:'refund', refund_id, reason, fee_policy, refund_cents, refund_status}
-- p_paid_at = the payment's own Stripe time (event.created); p_card_fee_cents
-- = the fee Stripe kept (balance transaction), NULL when unknown (estimated).
DROP FUNCTION IF EXISTS public.declutter_mark_order_paid(uuid, text, integer);
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
  IF p_amount_cents IS DISTINCT FROM o.total_cents THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;

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
      v_honour := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status <> 'live')
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'))
        AND NOT public.declutter_seller_out(o.seller_id)
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        RETURN public.declutter_refund_answer(
          public.declutter_record_refund(o.id, p_payment_intent_id, 'sold_elsewhere', p_amount_cents, p_card_fee_cents));
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'live';
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
               to_char(o.total_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for $%s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               to_char(o.items_cents / 100.0, 'FM999990.00')),
        '/declutter?view=offers', o.buyer_id);
      RETURN jsonb_build_object('result', 'paid');
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      RETURN public.declutter_refund_answer(
        public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents));
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
  IF v_lines = 0 OR v_live <> v_lines
     OR EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                 WHERE c.order_id = p_order_id AND i.status <> 'reserved')
     OR public.declutter_seller_out(o.seller_id)
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
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents));
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
    format('You paid $%s. Next: pick up your items at the time you chose.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for $%s of your items. You get paid when the buyer has them.', to_char(o.items_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', o.buyer_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

-- Slice 4's entry for refunding a PAID order (B40): 'seller_backed_out' (row
-- 60: everything back, card fee booked to the seller, seller strike) or
-- 'buyer_cancelled' (the card fee is kept). Records the refund and closes the
-- sale; the caller executes the Stripe refund with the returned row
-- (idempotency key = its id) and reports it with declutter_refund_executed.
CREATE OR REPLACE FUNCTION public.declutter_refund_paid_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_refund uuid;
  r record;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('seller_backed_out', 'buyer_cancelled') THEN
    RAISE EXCEPTION 'invalid_refund_reason' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'refunded' THEN
    SELECT rf.id INTO v_refund FROM public.declutter_refunds rf WHERE rf.stripe_payment_intent_id = o.stripe_payment_intent_id;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  IF o.status <> 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN p_reason = 'seller_backed_out' THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN p_reason = 'seller_backed_out' THEN 'withdrawn' ELSE 'live' END,
           updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    IF p_reason = 'seller_backed_out' THEN
      PERFORM public.declutter_give_strike(o.seller_id, 'seller', 'item_gone_after_sale', r.item_id,
        'You backed out of a sale after the buyer paid. The card fee for that payment comes out of your next Declutter payout.', r.id);
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN p_reason = 'seller_backed_out'
         THEN format('The seller backed out, so all $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way. The card fee is not refunded.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_paid_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_paid_order(uuid, text) TO service_role;

-- Take a seller's card-fee debt out of one payout (row 60, B43; slice 4 calls
-- it). Returns the cents to keep back from that payout: never more than the
-- payout, never more than is owed (remaining_cents CHECK >= 0), and the same
-- payout_ref twice returns the first answer without deducting again.
-- Serialized per seller (advisory lock, then row locks).
CREATE OR REPLACE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_payout_ref text, p_max_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_left integer := greatest(COALESCE(p_max_cents, 0), 0);
  v_took integer := 0;
  v_take integer;
  d record;
BEGIN
  IF p_seller IS NULL OR p_payout_ref IS NULL OR btrim(p_payout_ref) = '' THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || p_seller::text, 0));
  IF EXISTS (SELECT 1 FROM public.declutter_fee_debt_deductions x
               JOIN public.declutter_seller_fee_debts dd ON dd.id = x.debt_id
              WHERE x.payout_ref = p_payout_ref AND dd.seller_id = p_seller) THEN
    SELECT COALESCE(sum(x.deducted_cents), 0)::integer INTO v_took
      FROM public.declutter_fee_debt_deductions x
      JOIN public.declutter_seller_fee_debts dd ON dd.id = x.debt_id
     WHERE x.payout_ref = p_payout_ref AND dd.seller_id = p_seller;
    RETURN v_took;
  END IF;
  FOR d IN
    SELECT id, remaining_cents FROM public.declutter_seller_fee_debts
     WHERE seller_id = p_seller AND remaining_cents > 0
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, d.remaining_cents);
    UPDATE public.declutter_seller_fee_debts SET remaining_cents = remaining_cents - v_take WHERE id = d.id;
    INSERT INTO public.declutter_fee_debt_deductions (debt_id, payout_ref, deducted_cents) VALUES (d.id, p_payout_ref, v_take);
    v_left := v_left - v_take;
    v_took := v_took + v_take;
  END LOOP;
  RETURN v_took;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_consume_fee_debt(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_consume_fee_debt(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Seller backs out of an accepted, UNPAID sale (row 19). Restated from
--    20261014210518 with close_reason (B41/B45), the strike's cart line, and
--    no require_feature (row 62: an agreed sale can still be ended).
CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_sale(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_line record;
BEGIN
  -- Not strike/age/switch-gated: anyone may back out (and takes the strike).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Ownership before any lock (lh-authz-rls review 3b #4): with no switch gate,
  -- a stranger must not be able to lock someone else's items, even briefly.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = p_item_id
      OR i.id IN (SELECT c2.item_id FROM public.declutter_cart_items c2
                   WHERE c2.order_id = (SELECT c.order_id FROM public.declutter_cart_items c
                                         WHERE c.item_id = p_item_id AND c.status = 'in_cart'))
   ORDER BY i.id FOR UPDATE;
  SELECT i.id, i.status, i.title INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.* INTO v_line FROM public.declutter_cart_items c
   WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_sale_to_cancel' USING ERRCODE = '55000';
  END IF;
  IF v_line.status = 'paid' THEN
    RAISE EXCEPTION 'sale_already_paid' USING ERRCODE = '55000',
      HINT = 'The buyer already paid. Contact support to cancel.';
  END IF;
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_cancelled', closed_at = now()
     WHERE id = v_line.order_id AND status = 'awaiting_payment';
  END IF;
  UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
   WHERE id = v_line.id AND status = 'in_cart';
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = v_line.order_id AND status = 'in_cart';
  END IF;
  UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
   WHERE id = p_item_id AND status = 'reserved';
  PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
    format('The seller cancelled the sale of "%s". If you already paid, every cent comes back to your card.', v_item.title), '/declutter?view=cart', v_uid);
  RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,
    format('You cancelled the sale of "%s" after accepting it.', v_item.title), v_line.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_cancel_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_sale(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The deadline sweep, restated from 20261014210518 with close_reason, the
--    strike's cart line (B41) and row 62 (B44): a buyer the switch is OFF for
--    when the deadline passes gets no strike (the switch interrupted the sale).
CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  v_unstruck integer := 0;
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
           ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
           ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END,
      '/declutter?view=offers', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
    RETURNING c.buyer_id
  LOOP
    v_r24 := v_r24 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
      'You have an item waiting in your cart. Check out within 24 hours or you get a strike.', '/declutter?view=cart');
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
    RETURNING c.buyer_id
  LOOP
    v_r2 := v_r2 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
      'Check out in the next 2 hours or you get a strike and the item goes back up for sale.', '/declutter?view=cart');
  END LOOP;

  -- Missed checkouts. Lock order items -> orders -> lines, one line at a time.
  FOR r IN
    SELECT c.id, c.item_id
      FROM public.declutter_cart_items c
     WHERE c.status = 'in_cart' AND c.checkout_by <= now()
     ORDER BY c.item_id
  LOOP
    PERFORM 1 FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
    SELECT c.*, i.title INTO v_line
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = r.id;
    IF v_line.status <> 'in_cart' THEN CONTINUE; END IF;
    -- Grace: a payable order gets 1 h past the deadline (its Stripe page lives
    -- at most 30 min, so by then it can no longer be paid; B45).
    IF v_line.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                      AND v_line.checkout_by > now() - interval '1 hour') THEN
      CONTINUE;
    END IF;
    BEGIN
      -- Who stopped this checkout? A seller who blocked the buyer backed out
      -- (row 19: seller strike); a seller who can no longer sell ends it with
      -- no strike for the buyer; otherwise the buyer missed it (rows 7, 59).
      -- user_blocks is read directly: are_users_blocked() answers only for
      -- parties or server context.
      IF EXISTS (SELECT 1 FROM public.user_blocks b
                  WHERE b.blocker_id = v_line.seller_id AND b.blocked_id = v_line.buyer_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_blocked', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
          format('The seller cancelled the sale of "%s". You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart', v_line.seller_id);
        PERFORM public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers', v_line.item_id,
          format('You blocked the buyer of "%s" after the sale, which cancels it.', v_line.title), v_line.id);
      ELSIF public.declutter_seller_out(v_line.seller_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_out', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'ended', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'This sale was cancelled',
          format('"%s" can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart');
      ELSE
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_missed := v_missed + 1;
          -- Back on sale (rows 13/59).
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          IF public.feature_enabled_for_user('declutter', v_line.buyer_id) THEN
            PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
              format('You did not check out "%s" within 48 hours.', v_line.title), v_line.id);
          ELSE
            -- Row 62: the switch was turned off for this buyer mid-sale.
            v_unstruck := v_unstruck + 1;
            PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
              format('Checkout for "%s" closed. You were not charged and you get no strike.', v_line.title),
              '/declutter?view=cart', v_line.seller_id);
          END IF;
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?view=offers', v_line.buyer_id);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad line never stops every other missed checkout; it is retried
      -- on the next run (the line is still in_cart) and filed where ops reads it.
      PERFORM public.log_cron_defect('declutter_deadline_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('offers_expired', v_expired, 'reminded_24h', v_r24,
                            'reminded_2h', v_r2, 'checkouts_missed', v_missed, 'missed_without_strike', v_unstruck);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Readers (B37) without the switch (row 62, B44): a member reads only
--    their own offers and cart, so with the switch off they can still finish
--    an agreed sale; with nothing agreed they read nothing.
CREATE OR REPLACE FUNCTION public.declutter_my_offers()
RETURNS TABLE (offer_id uuid, item_id uuid, item_title text, my_side text, amount_cents integer,
               awaiting text, status text, respond_by timestamptz, counter_count integer,
               current_price_cents integer, floor_price_cents integer, updated_at timestamptz)
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
  SELECT o.id, o.item_id, i.title,
         CASE WHEN o.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         o.amount_cents, o.awaiting, o.status, o.respond_by, o.counter_count,
         i.current_price_cents,
         CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END,
         o.updated_at
    FROM public.declutter_offers o
    JOIN public.declutter_items i ON i.id = o.item_id
    LEFT JOIN public.declutter_item_private p ON p.item_id = o.item_id
   WHERE (o.buyer_id = v_uid OR o.seller_id = v_uid)
     AND (o.status = 'open' OR o.updated_at > now() - interval '30 days')
   ORDER BY (o.status = 'open') DESC, o.updated_at DESC
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer)
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
         o.status, o.handover, o.premium_cents, o.total_cents
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

-- Does the caller have a sale in flight (row 62)? The app opens the Declutter
-- cart / sales screens for such a member even while the switch is off.
CREATE OR REPLACE FUNCTION public.declutter_has_agreed_sales()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                  WHERE (c.buyer_id = (SELECT auth.uid()) OR c.seller_id = (SELECT auth.uid()))
                    AND c.status IN ('in_cart', 'paid'));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_has_agreed_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_has_agreed_sales() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Withdraw voids the listing's open offers (slice 3 leftover, B46).
--     Restated from 20261014200728 verbatim plus the void + notices.
CREATE OR REPLACE FUNCTION public.declutter_withdraw_item(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_paths text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose: an under-18 or struck member may still
  -- take their own listing down.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- rejected / removed / ended: off sale already, but their photos were
  -- still attached and public by URL (lh-authz-rls review should-fix 2), so
  -- they may be detached too. Reserved / sold / completed are not the
  -- seller's to pull (later slices).
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'rejected', 'removed', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- B46: the listing's open offers close now (buyers told, nothing charged)
  -- instead of later reading "the seller did not answer".
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item taken down',
      format('The seller took "%s" down, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?view=offers', v_uid);
  END LOOP;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;

  IF v_item.status = 'draft' THEN
    DELETE FROM public.declutter_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
    DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
    UPDATE public.declutter_items
       SET status = CASE WHEN v_item.status IN ('pending_review', 'live') THEN 'withdrawn' ELSE v_item.status END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_item(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. "Download My Data" (B9): export_my_data restated from 20261014210518
--     verbatim, plus the slice 3b section (a seller's card-fee debts). The
--     no-argument door stays dropped (Q408).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
