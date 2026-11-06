-- Shops custom orders, slice 2a: the 50% deposit plan's split, gates and payout (Builder 4, 11-06; plan
-- ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 ~3:40 PM balance-failure rule; LEAD 11-06 lapse-tax rule).
-- Stacked on slice 1b (20261106205852). The balance charge itself (an off-session PaymentIntent on the saved card,
-- the pay-the-rest Checkout page, and the 7-days-after-the-ready-date lapse) is slice 2b. Until 2b lands,
-- shops_order_custom_quote still refuses a deposit price (deposit_not_ready), so nothing here is reachable by a member
-- and nothing is ever taken on a deposit promise.
--
-- The money of a deposit order (payment_plan 'deposit_50'):
--   * The buyer's Checkout hold is for the whole order, as today. When it lands (status -> 'held'), the order freezes
--     balance_cents = half (rounded down) of each part of the sale: items, the buyer fee, the shop's delivery fee and
--     the tax. deposit_cents = what the accept captures = the rest of the sale plus the one-time setup fee if that
--     hold claimed it. Each part is split on its own, so the shop's half and the tax's half are exact amounts.
--   * At accept, shop-checkout / declutter-money capture deposit_cents only (amount_to_capture; _shared/shopHolds.ts):
--     Stripe captures a manual hold once and releases the rest.
--   * The rest (balance_cents) is a second payment (slice 2b) recorded in balance_payment_intent_id and
--     balance_captured_at. One charge key per order and that time: it is never charged twice.
--   * Nothing is handed over while the rest is unpaid: the shop's "Handed over" tap, the left-out ready photo, the
--     buyer's "I got it" and every path to status 'handed_over' are refused (balance_not_paid), by trigger, so every
--     writer (shops_mark_handed_over, shops_confirm_pickup, shop_complete_handover, admins) is covered.
--   * An order that ends with the rest unpaid pays the shop its half only: items - floor(items/2) plus
--     delivery - floor(delivery/2) (shop_order_shop_cents, read by shop_owe_shop), and a refund gives back at most what
--     the deposit took (shop_refund_amounts). On a lapse (2b) the order's Stripe Tax transaction is reversed in full and
--     the deposit's tax is refunded (LEAD 11-06: no item changes hands, so no taxable sale, La. R.S. 47:301(12)).
-- A full-payment order (payment_plan 'full_hold', the default and every order that is not a custom deposit) is
-- unchanged: every helper below answers exactly what the old bodies did.
-- Also (review follow-ups on 9abcc8018a): a declined or withdrawn price closes the buyer's unpaid order for it (a);
--   shops_order_custom_quote refuses a shop whose custom orders are off (b); the deposit_not_ready hint says to send a
--   new request (c).
-- MONEY: yes (lh-money-escrow): the split, the payout and refund amounts, the handover gate. AUTHZ: two restated member
--   RPCs, three triggers, two helpers (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraints added only when missing, DROP TRIGGER IF EXISTS, CREATE OR REPLACE
--   with unchanged signatures, grants restated.
-- Restated from their NEWEST CREATE: shops_decline_custom_request and shops_order_custom_quote (20261106205852),
--   shop_owe_shop (20261106180902), shop_refund_amounts (20261019071055).
-- Proof: src/test/pglite/shopsCustomDeposit.pglite.mjs (applied 3x; DEPOSIT_MIGRATION=skip is red).

-- 1. Columns.
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS payment_plan text NOT NULL DEFAULT 'full_hold',
  ADD COLUMN IF NOT EXISTS deposit_cents integer,
  ADD COLUMN IF NOT EXISTS balance_cents integer,
  ADD COLUMN IF NOT EXISTS balance_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS balance_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_card_fee_cents integer,
  ADD COLUMN IF NOT EXISTS balance_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_last_error text,
  ADD COLUMN IF NOT EXISTS balance_checkout_session_id text;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_payment_plan' AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_payment_plan CHECK (payment_plan IN ('full_hold', 'deposit_50'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_deposit_split' AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_deposit_split CHECK (
      CASE WHEN payment_plan = 'full_hold'
        THEN deposit_cents IS NULL AND balance_cents IS NULL AND balance_payment_intent_id IS NULL
             AND balance_captured_at IS NULL AND balance_checkout_session_id IS NULL
        ELSE (deposit_cents IS NULL) = (balance_cents IS NULL)
             AND (balance_cents IS NULL OR (balance_cents >= 0 AND deposit_cents > 0))
             AND (balance_captured_at IS NULL OR balance_payment_intent_id IS NOT NULL)
      END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_balance_pi' AND conrelid = 'public.shop_orders'::regclass) THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_balance_pi
      CHECK (balance_payment_intent_id IS NULL OR balance_payment_intent_id ~ '^pi_');
  END IF;
END;
$do$;
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_balance_pi_once ON public.shop_orders (balance_payment_intent_id)
  WHERE balance_payment_intent_id IS NOT NULL;
COMMENT ON COLUMN public.shop_orders.payment_plan IS
  'Custom orders slice 2: full_hold (the whole order captured at accept; every ordinary order) or deposit_50 (copied from the custom request: half at accept, the rest before handover).';
COMMENT ON COLUMN public.shop_orders.deposit_cents IS
  'deposit_50: what the accept captures (the sale less balance_cents, plus a claimed setup fee). Frozen when the hold lands.';
COMMENT ON COLUMN public.shop_orders.balance_cents IS
  'deposit_50: the rest, half (rounded down) of each of items, buyer fee, delivery and tax. Frozen when the hold lands.';
COMMENT ON COLUMN public.shop_orders.balance_captured_at IS
  'deposit_50: when the rest was paid (one per order; with balance_payment_intent_id it is never charged twice).';

-- 2. Helpers (service and trigger use; no member grant).
CREATE OR REPLACE FUNCTION public.shop_order_balance_open(o public.shop_orders)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.payment_plan = 'deposit_50' AND o.balance_captured_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_balance_open(public.shop_orders) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_balance_open(public.shop_orders) TO service_role;

-- What the shop is owed for an order that is paid out (handover, late cancel, no-show): its items and its delivery
-- fee; for a deposit order whose rest was never paid, its half of each (the half the deposit took).
CREATE OR REPLACE FUNCTION public.shop_order_shop_cents(o public.shop_orders)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN public.shop_order_balance_open(o)
              THEN (o.items_cents - o.items_cents / 2) + (o.delivery_cents - o.delivery_cents / 2)
              ELSE o.items_cents + o.delivery_cents END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_shop_cents(public.shop_orders) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_shop_cents(public.shop_orders) TO service_role;

-- 3. The split, frozen when the hold lands; the plan never changes after the order is written.
CREATE OR REPLACE FUNCTION public.shop_orders_deposit_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.payment_plan IS DISTINCT FROM OLD.payment_plan THEN
    RAISE EXCEPTION 'payment_plan_frozen' USING ERRCODE = '55000';
  END IF;
  IF NEW.payment_plan <> 'deposit_50' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_hold' AND NEW.status = 'held' THEN
    NEW.balance_cents := NEW.items_cents / 2 + NEW.premium_cents / 2 + NEW.delivery_cents / 2 + NEW.tax_cents / 2;
    NEW.deposit_cents := NEW.total_cents - NEW.balance_cents
      + CASE WHEN NEW.setup_fee_state = 'claimed' THEN NEW.setup_fee_cents ELSE 0 END;
  ELSIF NEW.deposit_cents IS DISTINCT FROM OLD.deposit_cents OR NEW.balance_cents IS DISTINCT FROM OLD.balance_cents THEN
    -- Frozen at the hold: no later write moves the split.
    RAISE EXCEPTION 'deposit_split_frozen' USING ERRCODE = '55000';
  END IF;
  -- Nothing reaches handed_over while the rest is unpaid.
  IF NEW.status = 'handed_over' AND OLD.status IS DISTINCT FROM 'handed_over' AND public.shop_order_balance_open(NEW) THEN
    RAISE EXCEPTION 'balance_not_paid' USING ERRCODE = '55000',
      HINT = 'The rest of this order is not paid yet, so it cannot be handed over. We have asked the buyer to pay it.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_deposit_split() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_deposit_split ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_deposit_split BEFORE UPDATE ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_deposit_split();

-- A new order is always written without a split; the plan comes only from a custom request (shops_order_custom_quote).
CREATE OR REPLACE FUNCTION public.shop_orders_deposit_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.deposit_cents IS NOT NULL OR NEW.balance_cents IS NOT NULL OR NEW.balance_payment_intent_id IS NOT NULL
     OR NEW.balance_captured_at IS NOT NULL OR NEW.balance_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'deposit_split_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_deposit_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_deposit_insert ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_deposit_insert BEFORE INSERT ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_deposit_insert();

-- 4. The handover gate on shop_handovers: the shop's "Handed over", the left-out ready photo and the buyer's or the
--    clock's confirmation all wait for the rest to be paid. "It's ready" (ready_at alone) is still allowed.
CREATE OR REPLACE FUNCTION public.shop_handovers_balance_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF (NEW.shop_confirmed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.shop_confirmed_at IS NULL))
     OR (NEW.ready_photo_path IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.ready_photo_path IS NULL))
     OR (NEW.confirmed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.confirmed_at IS NULL)) THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = NEW.order_id;
    IF FOUND AND public.shop_order_balance_open(o) THEN
      RAISE EXCEPTION 'balance_not_paid' USING ERRCODE = '55000',
        HINT = 'The rest of this order is not paid yet, so it cannot be handed over. We have asked the buyer to pay it.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handovers_balance_gate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_handovers_balance_gate ON public.shop_handovers;
CREATE TRIGGER trg_shop_handovers_balance_gate BEFORE INSERT OR UPDATE ON public.shop_handovers
  FOR EACH ROW EXECUTE FUNCTION public.shop_handovers_balance_gate();

-- 6. RESTATED from 20261106205852_shops_custom_order_accept.sql (review follow-up a): a declined or withdrawn price closes the buyer's unpaid order for it.
CREATE OR REPLACE FUNCTION public.shops_decline_custom_request(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  r public.shop_custom_requests%ROWTYPE;
  s public.shops%ROWTYPE;
  v_status text;
  v_blocked boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
  IF r.id IS NULL OR v_uid NOT IN (r.buyer_id, s.owner_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status NOT IN ('requested', 'quoted') OR (r.status = 'quoted' AND r.expires_at <= now()) THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  v_status := CASE WHEN v_uid = r.buyer_id THEN 'withdrawn' ELSE 'declined' END;
  UPDATE public.shop_custom_requests SET status = v_status, closed_at = now(), updated_at = now() WHERE id = r.id;
  -- Slice 2 (review follow-up a on 9abcc8018a): the buyer's unpaid order for this price closes with it, so a page
  -- still open cannot become a hold on a closed request (shop_mark_order_held answers cancel_hold for a superseded
  -- order, and shop_holds_to_release cancels a hold that lands on one). shop-checkout expires the page itself.
  UPDATE public.shop_orders o SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE o.status = 'awaiting_hold' AND o.buyer_id = r.buyer_id
     AND EXISTS (SELECT 1 FROM public.shop_order_lines ol WHERE ol.order_id = o.id AND ol.custom_request_id = r.id);
  -- A blocked pair still closes it (closing is harmless), but neither side is sent a notice by the other.
  v_blocked := public.are_users_blocked(r.buyer_id, s.owner_id);
  IF v_status = 'declined' AND NOT v_blocked THEN
    PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order declined',
      format('%s cannot take your custom order. Nothing was charged.', s.name), '/shops/orders', v_uid);
  ELSIF v_status = 'withdrawn' AND NOT v_blocked THEN
    PERFORM public.declutter_notify(s.owner_id, 'info', 'Custom order request withdrawn',
      'The buyer withdrew their custom order request. There is nothing to do.', '/shops/dashboard', v_uid);
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_decline_custom_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_decline_custom_request(uuid) TO authenticated, service_role;

-- 7. RESTATED from 20261106205852_shops_custom_order_accept.sql (review follow-ups b and c; the order carries the request's plan).
CREATE OR REPLACE FUNCTION public.shops_order_custom_quote(p_request_id uuid, p_shop_id uuid, p_ready_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  r public.shop_custom_requests%ROWTYPE;
  s public.shops;
  v_kind text;
  v_today date := public.shop_local_today();
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_items integer;
  v_order uuid;
  v_old_session text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 Shops strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;
  -- The same budget as shops_request_order: each call writes an order row.
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;

  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  -- p_shop_id is the shop shop-checkout read the terms, the Stripe mode and the tax address from: it must be this
  -- request's shop.
  IF r.id IS NULL OR r.buyer_id IS DISTINCT FROM v_uid OR r.shop_id IS DISTINCT FROM p_shop_id THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status <> 'quoted' OR r.expires_at <= now() THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;
  SELECT st.kind INTO v_kind FROM public.shop_item_subtypes st WHERE st.slug = r.subtype;
  IF v_kind IS NULL OR v_kind NOT IN ('made', 'home_food', 'farm', 'service') THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;
  -- The shop's statements for this kind, as a listed item needs them at publish (lead decision 11-06).
  IF r.statements IS DISTINCT FROM (SELECT array_agg(DISTINCT y ORDER BY y)
                                      FROM unnest(public.shop_item_required_statements(v_kind, r.subtype)) y) THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;

  -- The shop: locked so a pause or a close cannot slip between the checks and the insert.
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(s.id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  -- Slice 2 (review follow-up b on 9abcc8018a): the shop must still take custom orders when the buyer pays.
  IF s.custom_orders = 'off' THEN
    RAISE EXCEPTION 'custom_orders_off' USING ERRCODE = '55000', HINT = 'This shop is not taking custom orders right now.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;
  -- Slice 2a: the deposit split, gates and payout are built; the balance charge (2b) is not, so a deposit price is
  -- still refused and nothing is ever taken on a deposit promise. The plan is frozen on the request when it is
  -- sent, so only a new request can change it (review follow-up c on 9abcc8018a).
  IF r.payment_plan <> 'full_hold' THEN
    RAISE EXCEPTION 'deposit_not_ready' USING ERRCODE = '55000',
      HINT = 'Paying a deposit opens soon. Send the shop a new request after it opens.';
  END IF;

  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  -- The ready date (L21, D4): from tomorrow, at most 90 days out, on an open day, not on a full day.
  IF p_ready_date IS NULL OR p_ready_date < v_today + 1 THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = format('The earliest date for this order is %s.', to_char(v_today + 1, 'FMMonth FMDD'));
  END IF;
  IF p_ready_date > v_today + 90 THEN
    RAISE EXCEPTION 'ready_date_too_far' USING ERRCODE = '22023', HINT = 'Pick a date in the next 90 days.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = s.id AND h.weekday = extract(dow FROM p_ready_date)::smallint) THEN
    RAISE EXCEPTION 'shop_closed_that_day' USING ERRCODE = '22023', HINT = 'The shop does not fill orders on that day.';
  END IF;
  IF s.daily_order_cap IS NOT NULL
     AND public.shop_day_count(s.owner_id, p_ready_date, ARRAY['held', 'accepted', 'handed_over']) >= s.daily_order_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'That day is full. Pick another day.';
  END IF;
  IF v_kind = 'home_food' AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  v_items := r.quote_cents;
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents, payment_plan)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items),
          r.payment_plan)
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, variant_id, variant_label, title, kind, unit_cents,
                                       quantity, line_cents, custom_request_id, is_seed)
  VALUES (v_order, NULL, NULL, NULL, left('Custom order: ' || r.description, 120), v_kind, v_items,
          1, v_items, r.id, (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order));
  UPDATE public.shop_custom_requests SET order_id = v_order, updated_at = now() WHERE id = r.id;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_custom_quote(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_custom_quote(uuid, uuid, date, text) TO authenticated, service_role;

-- 8. RESTATED from 20261106180902_shops_delivery.sql (newest CREATE): the shop's amount reads shop_order_shop_cents.
CREATE OR REPLACE FUNCTION public.shop_owe_shop(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_due integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  -- Slice 2a: a deposit order whose rest was never paid pays the shop its half only (shop_order_shop_cents).
  v_due := public.shop_order_shop_cents(o);
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text,
                                              v_due);
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, v_due, v_debt,
          v_due - v_debt,
          CASE WHEN v_due - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END, now())
  ON CONFLICT (order_id) DO NOTHING;
  RETURN v_due - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owe_shop(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owe_shop(uuid) TO service_role;

-- 9. RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (newest CREATE): a refund never gives back more
--    than the payment took.
CREATE OR REPLACE FUNCTION public.shop_refund_amounts(p_order_id uuid, p_reason text)
RETURNS TABLE (fee_policy text, paid_cents integer, tax_cents integer, card_fee_cents integer,
               kept_cents integer, tax_kept_cents integer, refund_cents integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH o AS (
    -- Slice 2a: what the order's payment really took. A deposit order with its rest unpaid took the deposit only
    -- (its share of the tax is the tax less the balance's half); otherwise the whole sale, as before.
    SELECT p.total_cents, p.tax_cents,
           least(p.total_cents, COALESCE(p.card_fee_cents, public.declutter_card_fee_estimate(p.total_cents))) AS fee,
           public.shop_refund_fee_policy(p_reason) AS policy
      FROM (SELECT CASE WHEN public.shop_order_balance_open(so) THEN so.total_cents - so.balance_cents ELSE so.total_cents END AS total_cents,
                   CASE WHEN public.shop_order_balance_open(so) THEN so.tax_cents - so.tax_cents / 2 ELSE so.tax_cents END AS tax_cents,
                   so.card_fee_cents
              FROM public.shop_orders so WHERE so.id = p_order_id) p
  ), k AS (
    SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept FROM o
  )
  SELECT k.policy, k.total_cents, k.tax_cents, k.fee, k.kept,
         public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents),
         k.total_cents - k.kept - public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents)
    FROM k;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_amounts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_amounts(uuid, text) TO service_role;
