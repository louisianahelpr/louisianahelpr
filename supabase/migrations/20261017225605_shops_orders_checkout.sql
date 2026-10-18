-- Shops M1: orders and the card-hold checkout (docs/specs/local-shops-prep.md
-- L17-L22, L37/F1, L41 + O2, L82, L84, L91; plan ~/.lh-wt/handoffs-1017/shops-s3-plan.md).
--
-- The flow (owner L17/L18):
--   1. shops_request_order (AS THE BUYER) freezes ONE order: items from one shop,
--      a ready date on an open day after every item's lead time, the shop's
--      daily cap and the home-food yearly limit checked. Nothing is charged.
--   2. shop-checkout opens a Stripe Checkout page with capture_method=manual
--      (a card HOLD, Stripe docs "Place a hold on a payment method"), records it
--      with shop_attach_checkout_session; the webhook calls shop_mark_order_held
--      when the buyer finishes. The maker then has 24 hours (accept_by).
--   3. shops_accept_order (AS THE MAKER, row-locked, stock and the daily cap
--      re-checked under the lock, stock taken) -> shop-checkout captures the hold
--      -> shop_order_captured (card fee recorded, the home-food sale counted in
--      shop_cottage_sales). A capture that cannot happen ends the order
--      (shop_order_capture_failed: stock given back, both told).
--   4. Decline, buyer cancel before acceptance, 24 h without an answer
--      (shop_order_sweep) or an unpaid page: the hold is CANCELLED, which costs
--      nothing (Stripe docs "Refund and cancel payments": "You can cancel a
--      payment before it's completed at no cost"), so nothing is kept from the
--      buyer and nobody absorbs a fee. declutter-money's shop step cancels the
--      holds (shop_holds_to_release) and retries captures (shop_captures_due).
--
-- Money rules: the buyer's fee is Declutter's F1 exactly (owner 2026-10-18:
-- 5% of the items + $0.70, the card cost inside it, the shop keeps 100% of its
-- prices), frozen per order by the same declutter_buyer_fee_cents and held by
-- a table CHECK. Sales tax (O1) is Stripe Tax's, read off the completed page;
-- total = items + fee + tax, a table CHECK. Every unit price comes from ONE
-- function, shop_line_unit_cents (SH11 adds variants, sale prices, add-ons).
-- Refunds after capture, handover and payout are M2/M3: nothing here pays a
-- shop or refunds a captured charge.
--
-- L91 (switch off mid-order): asking for an order and accepting one need the
-- 'shops' switch; declining, a buyer cancel, the sweep and the money steps do
-- not (they only let a buyer's money go).
--
-- Account deletion: buyer_id / seller_id / shop_id are SET NULL on delete, but
-- an OPEN order (awaiting_hold, held, accepted) must keep all three (CHECK), so
-- deleting a party or closing a shop while money is held fails closed; a
-- closed order stays as an anonymised money record.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS; constraint swaps
-- in DO blocks. Grants by role name; REVOKE ... FROM PUBLIC, anon (and
-- authenticated for the service-only steps). Applied 3x by the PGlite proof
-- src/test/pglite/shopsOrders.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The shop's cancel policy (L41, owner O2): one of three presets, shown
--    before ordering. Frozen on each order. M3 applies it to a buyer cancel
--    after acceptance; before acceptance the hold just drops (any preset).
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS cancel_policy text NOT NULL DEFAULT 'until_24h_before_ready';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_cancel_policy_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_cancel_policy_check
      CHECK (cancel_policy IN ('until_24h_before_ready', 'until_accept', 'until_handover'));
  END IF;
END
$do$;
GRANT SELECT (cancel_policy) ON TABLE public.shops TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Orders and their lines.
CREATE TABLE IF NOT EXISTS public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'awaiting_hold' CHECK (status IN (
    'awaiting_hold', -- amounts frozen, the Stripe page not finished yet
    'held',          -- the card is held; the maker has until accept_by
    'accepted',      -- the maker said yes; the hold is captured (captured_at) or being captured
    'declined',      -- the maker said no; the hold drops
    'expired',       -- no answer in 24 h, or the page was never finished
    'cancelled',     -- the buyer withdrew before acceptance, or the hold could not be captured
    'superseded',    -- the buyer asked again before paying; this page is retired
    'handed_over',   -- M2
    'refunded'       -- M3
  )),
  close_reason text CHECK (close_reason IS NULL OR close_reason IN (
    'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost',
    'capture_gave_up', 'order_closed', 'amount_mismatch', 'day_full')),
  ready_date date NOT NULL,
  cancel_policy text NOT NULL CHECK (cancel_policy IN ('until_24h_before_ready', 'until_accept', 'until_handover')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 200),
  items_cents integer NOT NULL CHECK (items_cents >= 100),
  premium_cents integer NOT NULL,
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL,
  stripe_checkout_session_id text UNIQUE CHECK (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id ~ '^cs_'),
  stripe_payment_intent_id text UNIQUE CHECK (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id ~ '^pi_'),
  payment_livemode boolean,
  card_fee_cents integer CHECK (card_fee_cents IS NULL OR card_fee_cents >= 0),
  -- A capture Stripe did not complete is retried (shop_captures_due), every
  -- 10 minutes for the first 12 tries, then hourly, until 6 days after the hold
  -- (an authorization usually lasts 7: Stripe docs "Place a hold"). Each try
  -- carries its own idempotency key, shop-capture-<order>-<attempt>.
  capture_attempts integer NOT NULL DEFAULT 0 CHECK (capture_attempts BETWEEN 0 AND 1000),
  capture_last_error text,
  capture_last_attempt_at timestamptz,
  -- Cancelling a closed order's hold at Stripe that did not work (or found the
  -- payment captured): counted so a stuck row goes to the back of the queue.
  hold_release_attempts integer NOT NULL DEFAULT 0 CHECK (hold_release_attempts >= 0),
  hold_release_last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  held_at timestamptz,
  accept_by timestamptz,
  accepted_at timestamptz,
  captured_at timestamptz,
  hold_released_at timestamptz,
  closed_at timestamptz,
  -- F1 (roadmap; owner 2026-10-18): the buyer's fee, frozen. Same rule as
  -- declutter_buyer_fee_cents (20261015023613); the RPC computes it with that function.
  CONSTRAINT shop_orders_premium_rule CHECK (premium_cents = round(items_cents * 0.05)::integer + 70),
  CONSTRAINT shop_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents),
  -- Stripe's per-charge maximum ($999,999.99).
  CONSTRAINT shop_orders_total_max CHECK (total_cents <= 99999999),
  CONSTRAINT shop_orders_fee_sane CHECK (card_fee_cents IS NULL OR card_fee_cents <= total_cents),
  CONSTRAINT shop_orders_not_own CHECK (buyer_id <> seller_id),
  CONSTRAINT shop_orders_open_has_parties CHECK (
    status NOT IN ('awaiting_hold', 'held', 'accepted')
    OR (buyer_id IS NOT NULL AND seller_id IS NOT NULL AND shop_id IS NOT NULL)),
  CONSTRAINT shop_orders_held_has_payment CHECK (
    status NOT IN ('held', 'accepted', 'handed_over') OR stripe_payment_intent_id IS NOT NULL),
  CONSTRAINT shop_orders_accept_window CHECK ((held_at IS NULL) = (accept_by IS NULL)),
  CONSTRAINT shop_orders_captured_is_accepted CHECK (
    captured_at IS NULL OR status IN ('accepted', 'handed_over', 'refunded'))
);
CREATE INDEX IF NOT EXISTS shop_orders_buyer_idx ON public.shop_orders (buyer_id, status);
CREATE INDEX IF NOT EXISTS shop_orders_seller_idx ON public.shop_orders (seller_id, status);
CREATE INDEX IF NOT EXISTS shop_orders_shop_idx ON public.shop_orders (shop_id);
CREATE INDEX IF NOT EXISTS shop_orders_day_idx ON public.shop_orders (seller_id, ready_date) WHERE status IN ('held', 'accepted', 'handed_over');
CREATE INDEX IF NOT EXISTS shop_orders_held_idx ON public.shop_orders (accept_by) WHERE status = 'held';
-- At most one unpaid page per buyer and shop owner (asking again supersedes it).
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_one_awaiting
  ON public.shop_orders (buyer_id, seller_id) WHERE status = 'awaiting_hold';
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_orders FROM PUBLIC, anon, authenticated;
-- The Stripe ids and the capture bookkeeping are ours, not the members'.
GRANT SELECT (id, buyer_id, seller_id, shop_id, status, close_reason, ready_date, cancel_policy, note, decline_reason,
              items_cents, premium_cents, tax_cents, total_cents, is_seed, created_at, held_at, accept_by,
              accepted_at, captured_at, closed_at)
  ON TABLE public.shop_orders TO authenticated;
GRANT ALL ON TABLE public.shop_orders TO service_role;
DROP POLICY IF EXISTS "shop orders: the two sides read" ON public.shop_orders;
CREATE POLICY "shop orders: the two sides read" ON public.shop_orders
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));
COMMENT ON TABLE public.shop_orders IS
  'Shops M1: one order from one shop (docs/specs/local-shops-prep.md L17-L22). Written only by shops_* / shop_* RPCs.';

CREATE TABLE IF NOT EXISTS public.shop_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.shop_items(id) ON DELETE SET NULL,
  -- SH11 (catalog) adds the variant table and this column's foreign key.
  variant_id uuid,
  -- Snapshots: a later edit of the item never changes an order.
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('made', 'home_food', 'farm')),
  unit_cents integer NOT NULL CHECK (unit_cents BETWEEN 100 AND 100000),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  line_cents integer NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_order_lines_amount CHECK (line_cents = unit_cents * quantity),
  CONSTRAINT shop_order_lines_one_item UNIQUE (order_id, item_id)
);
CREATE INDEX IF NOT EXISTS shop_order_lines_order_idx ON public.shop_order_lines (order_id);
CREATE INDEX IF NOT EXISTS shop_order_lines_item_idx ON public.shop_order_lines (item_id);
ALTER TABLE public.shop_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, order_id, item_id, variant_id, title, kind, unit_cents, quantity, line_cents, is_seed, created_at)
  ON TABLE public.shop_order_lines TO authenticated;
GRANT ALL ON TABLE public.shop_order_lines TO service_role;
DROP POLICY IF EXISTS "shop order lines: the two sides read" ON public.shop_order_lines;
CREATE POLICY "shop order lines: the two sides read" ON public.shop_order_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = shop_order_lines.order_id
                  AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- is_seed from birth: an order with a test account on either side is seed data.
CREATE OR REPLACE FUNCTION public.shop_orders_seed_from_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NOT NEW.is_seed AND EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.user_id IN (NEW.buyer_id, NEW.seller_id) AND p.is_seed
     ) THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_seed_from_parties() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_seed ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_seed BEFORE INSERT ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_seed_from_parties();

-- A shop with an open order cannot be closed or deleted (the hook slice 1 left
-- for "refuse while an order is open"); the CHECK above is the backstop.
CREATE OR REPLACE FUNCTION public.shops_refuse_delete_with_open_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shop_orders o
              WHERE o.shop_id = OLD.id AND o.status IN ('awaiting_hold', 'held', 'accepted')) THEN
    RAISE EXCEPTION 'shop_has_open_orders' USING ERRCODE = '55000',
      HINT = 'Finish or decline your open orders before closing your shop.';
  END IF;
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_refuse_delete_with_open_orders() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shops_refuse_delete_with_open_orders ON public.shops;
CREATE TRIGGER trg_shops_refuse_delete_with_open_orders BEFORE DELETE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.shops_refuse_delete_with_open_orders();

-- ---------------------------------------------------------------------------
-- 2. Prices: the ONE place a checkout reads a unit price (SH11 extends it).
CREATE OR REPLACE FUNCTION public.shop_line_unit_cents(p_item_id uuid, p_variant_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents integer;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    RAISE EXCEPTION 'variant_not_available' USING ERRCODE = '22023';
  END IF;
  SELECT price_cents INTO v_cents FROM public.shop_items WHERE id = p_item_id;
  RETURN v_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_line_unit_cents(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_line_unit_cents(uuid, uuid) TO service_role;

-- Today in Louisiana time (ready dates are local dates).
CREATE OR REPLACE FUNCTION public.shop_local_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (now() AT TIME ZONE 'America/Chicago')::date;
$fn$;
REVOKE ALL ON FUNCTION public.shop_local_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_local_today() TO authenticated, service_role;

-- Orders that take a slot of the shop's day (L22).
CREATE OR REPLACE FUNCTION public.shop_day_count(p_seller uuid, p_day date, p_statuses text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer FROM public.shop_orders
   WHERE seller_id = p_seller AND ready_date = p_day AND status = ANY (p_statuses);
$fn$;
REVOKE ALL ON FUNCTION public.shop_day_count(uuid, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_day_count(uuid, date, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The maker picks a cancel preset (O2).
CREATE OR REPLACE FUNCTION public.shops_set_cancel_policy(p_policy text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_policy IS NULL OR p_policy NOT IN ('until_24h_before_ready', 'until_accept', 'until_handover') THEN
    RAISE EXCEPTION 'invalid_cancel_policy' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET cancel_policy = p_policy, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_policy;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_cancel_policy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_cancel_policy(text) TO authenticated, service_role;

-- What a buyer sees before ordering (L41 policy, L21 open days, L22 full days).
CREATE OR REPLACE FUNCTION public.shops_order_terms(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id;
  -- A member the owner blocked (or who blocked the owner) sees no terms, as
  -- shops_request_order refuses them (lh-authz-rls review, 2026-10-18).
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'cancel_policy', s.cancel_policy,
    'paused', s.paused,
    'open_weekdays', (SELECT COALESCE(jsonb_agg(DISTINCT h.weekday ORDER BY h.weekday), '[]'::jsonb)
                        FROM public.shop_hours h WHERE h.shop_id = s.id),
    'daily_order_cap', s.daily_order_cap,
    'today', v_today,
    'last_day', v_today + 90,
    'full_days', CASE WHEN s.daily_order_cap IS NULL THEN '[]'::jsonb ELSE (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb) FROM (
        SELECT o.ready_date AS d FROM public.shop_orders o
         WHERE o.seller_id = s.owner_id AND o.ready_date BETWEEN v_today AND v_today + 90
           AND o.status IN ('held', 'accepted', 'handed_over')
         GROUP BY o.ready_date HAVING count(*) >= s.daily_order_cap) f) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_terms(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The buyer asks for an order (L17, L20-L22, L8, L82, L84). AS THE BUYER.
--    p_lines: [{"item_id": uuid, "quantity": 1-20}, ...], 1-20 lines, one shop.
CREATE OR REPLACE FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
  v_line jsonb;
  v_item public.shop_items;
  v_qty integer;
  v_unit integer;
  v_items integer := 0;
  v_lead integer := 0;
  v_home_food boolean := false;
  v_order uuid;
  v_old_session text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 marketplace strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;
  -- The RPC is callable straight through the API (past shop-checkout's rate
  -- limit), and each call writes an order row: at most 30 orders asked for in
  -- an hour per member (lh-authz-rls review, 2026-10-18).
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;

  -- The shop: locked so a pause or a close cannot slip between the checks and the insert.
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF s.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023', HINT = 'You cannot order from your own shop.';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'An order has 1 to 20 items.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  -- Every line: a live item of THIS shop, never a rental (S5), in stock.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_qty := (v_line ->> 'quantity')::integer;
      SELECT * INTO v_item FROM public.shop_items WHERE id = (v_line ->> 'item_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023', HINT = 'Order 1 to 20 of each item.';
    END IF;
    IF v_item.id IS NULL OR v_item.shop_id <> s.id OR v_item.status <> 'live' THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'An item in this order is no longer listed.';
    END IF;
    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'Each item once, with a quantity.';
    END IF;
    v_seen := v_seen || v_item.id;
    IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000';
    END IF;
    IF v_item.stock_count IS NOT NULL AND v_item.stock_count < v_qty THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('Only %s of "%s" left.', v_item.stock_count, v_item.title);
    END IF;
    v_unit := public.shop_line_unit_cents(v_item.id, NULL);
    v_items := v_items + v_unit * v_qty;
    v_lead := greatest(v_lead, v_item.lead_time_days);
    v_home_food := v_home_food OR v_item.kind = 'home_food';
  END LOOP;

  -- The ready date (L21, D4): after every item's lead time, at most 90 days out, on an open day.
  IF p_ready_date IS NULL OR p_ready_date < v_today + v_lead THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = format('The earliest date for this order is %s.', to_char(v_today + v_lead, 'FMMonth FMDD'));
  END IF;
  IF p_ready_date > v_today + 90 THEN
    RAISE EXCEPTION 'ready_date_too_far' USING ERRCODE = '22023', HINT = 'Pick a date in the next 90 days.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = s.id AND h.weekday = extract(dow FROM p_ready_date)::smallint) THEN
    RAISE EXCEPTION 'shop_closed_that_day' USING ERRCODE = '22023', HINT = 'The shop does not fill orders on that day.';
  END IF;
  -- L22: a full day greys out (held orders take a slot until they are answered).
  IF s.daily_order_cap IS NOT NULL
     AND public.shop_day_count(s.owner_id, p_ready_date, ARRAY['held', 'accepted', 'handed_over']) >= s.daily_order_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'That day is full. Pick another day.';
  END IF;
  -- L8: no new home-food orders once the yearly limit is reached.
  IF v_home_food AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items))
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents, is_seed)
  SELECT v_order, i.id, i.title, i.kind, public.shop_line_unit_cents(i.id, NULL), (l ->> 'quantity')::smallint,
         public.shop_line_unit_cents(i.id, NULL) * (l ->> 'quantity')::integer,
         (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order)
    FROM jsonb_array_elements(p_lines) l
    JOIN public.shop_items i ON i.id = (l ->> 'item_id')::uuid;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_order(uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_order(uuid, jsonb, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The Stripe page (service only, from shop-checkout and the webhook).
CREATE OR REPLACE FUNCTION public.shop_attach_checkout_session(p_order_id uuid, p_session_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_' THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_orders SET stripe_checkout_session_id = p_session_id
   WHERE id = p_order_id AND status = 'awaiting_hold' AND stripe_checkout_session_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '55000';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_attach_checkout_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_attach_checkout_session(uuid, text) TO service_role;

-- The buyer finished the page: the card is held (PI requires_capture). The
-- answer is 'held', 'already_held', or 'cancel_hold' with a reason (the
-- webhook then cancels the hold at no cost). Idempotent per page.
CREATE OR REPLACE FUNCTION public.shop_mark_order_held(p_session_id text, p_payment_intent_id text,
  p_amount_total integer, p_tax_cents integer, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_cap smallint;
  v_shop_name text;
  v_shop uuid;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  -- Lock order: the SHOP row first, then the order, the same order as
  -- shops_request_order (shop FOR SHARE, then the buyer's unpaid order), so a
  -- buyer asking again while their old page's payment lands cannot deadlock
  -- (lh-money-escrow re-review, 2026-10-18).
  SELECT shop_id INTO v_shop FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id;
  IF v_shop IS NOT NULL THEN
    PERFORM 1 FROM public.shops WHERE id = v_shop FOR UPDATE;
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    -- No row to record the hold on: the webhook cancels it now, and a failure
    -- there throws so Stripe redelivers the event.
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_missing');
  END IF;
  IF o.status IN ('held', 'accepted', 'handed_over', 'refunded') AND o.stripe_payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('result', 'already_held', 'order_id', o.id);
  END IF;
  IF o.status <> 'awaiting_hold' THEN
    -- The order closed while the buyer was on the page (asked again, withdrew,
    -- or the 2-hour unpaid sweep ran before a late webhook). The hold is
    -- recorded on the closed row, so shop_holds_to_release retries the cancel
    -- if the webhook's own cancel fails, and the buyer is told.
    IF o.stripe_payment_intent_id IS NULL AND o.status IN ('declined', 'expired', 'cancelled', 'superseded') THEN
      UPDATE public.shop_orders SET stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order already closed',
        'This order had already closed when your payment went through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
    END IF;
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
  END IF;
  IF p_tax_cents IS NULL OR p_tax_cents < 0 OR p_amount_total IS DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order could not go through',
      'Something did not add up with the payment for this order, so nothing was charged and the hold on your card is released. Please order again.',
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'amount_mismatch', 'order_id', o.id);
  END IF;
  -- The day may have filled while the buyer was on the page. The shop row is
  -- locked so two holds landing at once cannot both take the last slot.
  SELECT daily_order_cap, name INTO v_cap, v_shop_name FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  IF v_cap IS NOT NULL AND public.shop_day_count(o.seller_id, o.ready_date, ARRAY['held', 'accepted', 'handed_over']) >= v_cap THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'day_full', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'That day filled up',
      'Another order took the last spot that day, so nothing was charged and the hold on your card was released. Pick another day.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'day_full', 'order_id', o.id);
  END IF;
  UPDATE public.shop_orders
     SET status = 'held', stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode,
         tax_cents = p_tax_cents, total_cents = p_amount_total, held_at = now(), accept_by = now() + interval '24 hours'
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New order',
    format('A new order for %s is waiting. Accept or decline it within 24 hours, or it drops.', to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order sent',
    format('Your card is held, not charged. %s has 24 hours to accept; you are charged only if they do.', COALESCE(v_shop_name, 'The shop')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'held', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The maker answers. AS THE MAKER.
CREATE OR REPLACE FUNCTION public.shops_accept_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_cap smallint;
  l record;
  v_block text;
  v_home_food bigint;
  v_cottage_cap bigint;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'accepted' THEN
    -- A retry after the capture step failed to answer: the edge function captures again (idempotent).
    RETURN jsonb_build_object('result', 'already_accepted', 'order_id', o.id, 'captured', o.captured_at IS NOT NULL);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  IF now() > o.accept_by THEN
    RAISE EXCEPTION 'order_expired' USING ERRCODE = '55000', HINT = 'The 24 hours to accept have passed.';
  END IF;
  -- The maker must be able to be paid at handover (L3: payout setup) and in good standing.
  v_block := public.shop_owner_sell_block_reason(v_uid);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = '42501';
  END IF;
  -- The buyer must still be able to buy from this maker (a block or a ban
  -- since the order was sent): the maker declines instead, and the hold drops.
  IF o.buyer_id IS NULL OR public.are_users_blocked(v_uid, o.buyer_id) OR EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.user_id = o.buyer_id
          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'buyer_unavailable' USING ERRCODE = '55000',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  -- Every accept of this shop is serialized on the shop row (FOR UPDATE), so
  -- two accepts at once cannot both take the day's last slot (L22) or both
  -- fit under the home-food yearly limit (L8). Only accepted orders count now.
  SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- A shop Louisiana Helpr hid takes no money (lh-authz-rls review, 2026-10-18).
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = o.shop_id AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid your shop, so it cannot accept orders. Decline them so the buyers'' holds are released.';
  END IF;
  IF v_cap IS NOT NULL AND public.shop_day_count(v_uid, o.ready_date, ARRAY['accepted', 'handed_over']) >= v_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'You already accepted your most orders for that day.';
  END IF;
  -- L8 at acceptance: sales already counted + accepted orders not yet charged
  -- + this order's home-food lines must stay within the yearly limit.
  SELECT COALESCE(sum(line_cents), 0) INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    SELECT c.cap_cents INTO v_cottage_cap FROM public.shop_cottage_settings c WHERE c.id;
    IF v_cottage_cap IS NULL OR public.shop_cottage_sales_cents(v_uid)
         + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
              JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
             WHERE x.seller_id = v_uid AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
         + v_home_food > v_cottage_cap THEN
      RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
        HINT = 'Accepting this order would go over your yearly home-food sales limit. Decline it so the buyer''s hold is released.';
    END IF;
  END IF;
  -- L20: stock is taken at acceptance, items locked in id order (no deadlock between two accepts).
  FOR l IN
    SELECT ol.item_id, ol.quantity, i.stock_count, i.title
      FROM public.shop_order_lines ol JOIN public.shop_items i ON i.id = ol.item_id
     WHERE ol.order_id = o.id
     ORDER BY ol.item_id
       FOR UPDATE OF i
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  UPDATE public.shop_items i SET stock_count = i.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.item_id = i.id AND i.stock_count IS NOT NULL;
  UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_accept_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_accept_order(uuid) TO authenticated, service_role;

-- No switch check (L91): declining only lets the buyer's hold go.
CREATE OR REPLACE FUNCTION public.shops_decline_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023', HINT = 'Keep the reason under 200 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_reason);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the reason. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'declined' THEN
    RETURN jsonb_build_object('result', 'already_declined', 'order_id', o.id);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  UPDATE public.shop_orders SET status = 'declined', close_reason = 'declined', decline_reason = v_reason, closed_at = now()
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order declined',
    'The shop could not take this order. Nothing was charged, and the hold on your card is released.'
      || CASE WHEN v_reason IS NOT NULL THEN ' Their note: ' || v_reason ELSE '' END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'declined', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_decline_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_decline_order(uuid, text) TO authenticated, service_role;

-- The buyer withdraws BEFORE the maker accepts: the hold drops, nothing kept
-- (O2: before accept, any preset). After acceptance the shop's policy applies (M3).
CREATE OR REPLACE FUNCTION public.shops_cancel_order_request(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
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
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'already_cancelled', 'order_id', o.id);
  END IF;
  IF o.status IN ('accepted', 'handed_over') THEN
    RAISE EXCEPTION 'order_accepted' USING ERRCODE = '55000',
      HINT = 'The shop already accepted this order; its cancel policy applies.';
  END IF;
  IF o.status NOT IN ('awaiting_hold', 'held') THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled', closed_at = now() WHERE id = o.id;
  IF o.status = 'held' THEN
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Order withdrawn',
      format('The buyer withdrew their order for %s before you answered.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_cancel_order_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_cancel_order_request(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Capture bookkeeping (service only).
CREATE OR REPLACE FUNCTION public.shop_order_captured(p_order_id uuid, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_home_food integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_captured', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_accepted' USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders
     SET captured_at = now(), capture_last_error = NULL,
         card_fee_cents = least(o.total_cents, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents)))
   WHERE id = o.id;
  -- L8: the app counts its own home-food sales (once per order: source_ref UNIQUE).
  SELECT COALESCE(sum(line_cents), 0)::integer INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, is_seed)
    VALUES (o.seller_id, o.id, v_home_food, o.is_seed)
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order accepted',
    format('The shop accepted your order for %s and your card was charged $%s.', to_char(o.ready_date, 'FMMonth FMDD'),
           to_char(o.total_cents / 100.0, 'FM999999990.00')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_captured(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_captured(uuid, integer) TO service_role;

-- A capture Stripe refused. p_final: Stripe says the hold is CANCELED (expired
-- or cancelled there), so the order ends with the hold marked released, stock
-- goes back and both are told. Otherwise the money step retries
-- (shop_captures_due) until 6 days after the hold; then the order ends WITHOUT
-- marking the hold released, so shop_holds_to_release cancels it at Stripe (or
-- pages, if Stripe shows it captured). hold_released_at is only ever set here
-- when Stripe itself said canceled.
CREATE OR REPLACE FUNCTION public.shop_order_capture_failed(p_order_id uuid, p_error text, p_final boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'accepted' OR o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'nothing_to_do');
  END IF;
  IF NOT COALESCE(p_final, false) AND now() < o.held_at + interval '6 days' THEN
    UPDATE public.shop_orders SET capture_attempts = capture_attempts + 1, capture_last_error = left(p_error, 500),
                                  capture_last_attempt_at = now()
     WHERE id = o.id;
    RETURN jsonb_build_object('result', 'will_retry', 'attempts', o.capture_attempts + 1);
  END IF;
  -- Stock back, items locked in id order like shops_accept_order (no deadlock).
  PERFORM 1 FROM public.shop_items i JOIN public.shop_order_lines ol ON ol.item_id = i.id
   WHERE ol.order_id = o.id ORDER BY i.id FOR UPDATE OF i;
  UPDATE public.shop_items i SET stock_count = i.stock_count + ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.item_id = i.id AND i.stock_count IS NOT NULL;
  UPDATE public.shop_orders
     SET status = 'cancelled',
         close_reason = CASE WHEN COALESCE(p_final, false) THEN 'hold_lost' ELSE 'capture_gave_up' END,
         closed_at = now(),
         hold_released_at = CASE WHEN COALESCE(p_final, false) THEN now() ELSE NULL END,
         capture_attempts = capture_attempts + 1, capture_last_error = left(p_error, 500), capture_last_attempt_at = now()
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order could not go through',
    'Your card could not be charged for this order, so it is cancelled. Nothing was charged, and any hold on your card is released.',
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
    format('The buyer''s card could not be charged for the order for %s, so it is cancelled. Do not make it.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_capture_failed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_capture_failed(uuid, text, boolean) TO service_role;

-- Accepted orders whose capture has not landed yet (the money step retries them).
CREATE OR REPLACE FUNCTION public.shop_captures_due(p_limit integer)
RETURNS TABLE (order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, total_cents integer,
               livemode boolean, checkout_session_id text, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.id, o.buyer_id, o.seller_id, o.stripe_payment_intent_id, o.total_cents, o.payment_livemode,
         o.stripe_checkout_session_id, o.capture_attempts
    FROM public.shop_orders o
   WHERE o.status = 'accepted' AND o.captured_at IS NULL
     -- The accepting tap captures at once; the sweep only picks up one that did not answer.
     AND o.accepted_at <= now() - interval '2 minutes'
     -- Every run for the first 12 tries, then hourly (shop_order_capture_failed
     -- ends the order 6 days after the hold).
     AND (o.capture_last_attempt_at IS NULL
          OR o.capture_last_attempt_at <= now() - CASE WHEN o.capture_attempts < 12 THEN interval '5 minutes' ELSE interval '1 hour' END)
   ORDER BY o.capture_attempts, o.accepted_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_captures_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_captures_due(integer) TO service_role;

-- Holds to cancel at Stripe: every closed order that held a card and never captured it.
CREATE OR REPLACE FUNCTION public.shop_holds_to_release(p_limit integer)
RETURNS TABLE (order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, livemode boolean,
               checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.id, o.buyer_id, o.seller_id, o.stripe_payment_intent_id, o.payment_livemode, o.stripe_checkout_session_id
    FROM public.shop_orders o
   WHERE o.status IN ('declined', 'expired', 'cancelled', 'superseded')
     AND o.stripe_payment_intent_id IS NOT NULL AND o.captured_at IS NULL AND o.hold_released_at IS NULL
   -- A row that keeps failing (or whose payment Stripe shows captured, which
   -- pages ops) goes to the back, so it never blocks the others' cancels.
   ORDER BY o.hold_release_attempts, o.closed_at NULLS FIRST
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_holds_to_release(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_holds_to_release(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_hold_release_failed(p_order_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  UPDATE public.shop_orders
     SET hold_release_attempts = hold_release_attempts + 1, hold_release_last_error = left(p_error, 500)
   WHERE id = p_order_id AND hold_released_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.shop_hold_release_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_hold_release_failed(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_hold_released(p_order_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  UPDATE public.shop_orders SET hold_released_at = now()
   WHERE id = p_order_id AND hold_released_at IS NULL AND captured_at IS NULL
     AND status IN ('declined', 'expired', 'cancelled', 'superseded');
$fn$;
REVOKE ALL ON FUNCTION public.shop_hold_released(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_hold_released(uuid) TO service_role;

-- The clock (run by declutter-money every 10 minutes): no answer in 24 h ->
-- expired (L18), a page never finished in 2 h -> expired (Stripe pages live 31 min).
CREATE OR REPLACE FUNCTION public.shop_order_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_no_answer integer := 0;
  v_unpaid integer;
BEGIN
  FOR o IN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'no_answer', closed_at = now()
     WHERE status = 'held' AND accept_by < now()
    RETURNING id, buyer_id, seller_id, ready_date
  LOOP
    v_no_answer := v_no_answer + 1;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order not answered',
      'The shop did not answer in 24 hours, so the order dropped. Nothing was charged, and the hold on your card is released.',
      '/shops/orders', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order dropped',
      format('You did not answer the order for %s in 24 hours, so it dropped.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END LOOP;
  UPDATE public.shop_orders SET status = 'expired', close_reason = 'page_unpaid', closed_at = now()
   WHERE status = 'awaiting_hold' AND created_at < now() - interval '2 hours';
  GET DIAGNOSTICS v_unpaid = ROW_COUNT;
  RETURN jsonb_build_object('no_answer', v_no_answer, 'page_unpaid', v_unpaid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_sweep() TO service_role;
