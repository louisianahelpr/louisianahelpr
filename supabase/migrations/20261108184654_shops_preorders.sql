-- Shops PREORDERS (owner 11-08; Builder 5). A shop sells an item before it is made: the buyer pays in full at order,
-- the shop sets a "ready by" date, and may set a minimum number of orders it needs by a deadline before it makes it.
--
--   1. Columns. shop_items: the preorder settings (ready-by at most 120 days out, an optional goal + goal deadline on
--      or before ready-by, an optional cap on units) and the campaign's state (goal met / missed, the one push of the
--      date, the late warning). shop_orders: which preorder an order is, and whether its date was pushed after it.
--      CARD AGE: Stripe refunds a charge up to about 180 days after it. An order is charged on or after the day the
--      preorder was set (preorder_set_on). Its last automatic refund is at most 7 days after ready-by, and ready-by is
--      at most 120 days after preorder_set_on plus one push of at most 30: 120 + 30 + 7 = 157 days < 180. The CHECK
--      shop_items_preorder_card_age holds ready-by within 150 days of preorder_set_on, so every automatic refund is
--      inside Stripe's window (also asserted in src/test/shopsPreorders.test.ts).
--   2. shop_day_count skips preorders (a preorder never fills a day; its ready-by is not a picked day).
--   3. Refund reasons: preorder_goal_missed, preorder_shop_late and preorder_date_moved: the buyer gets every cent back
--      (items, buyer fee, tax) and the card fee becomes the shop's fee debt (owner 10-14 "we never absorb any fee": only
--      our own mistake is ours; this replaces the lead's 11-08 default of Helpr absorbing it on a missed goal, which the
--      card-fee guard src/test/refundsKeepTheCardFee.test.ts refuses). A buyer's own cancel stays buyer_cancelled
--      (keep_card_fee, as every other Shops buyer cancel).
--   4. The old buyer cancel (free window / late cancel that pays the shop) never applies to a preorder: refused by
--      trigger; a preorder is cancelled through shops_cancel_preorder.
--   5. shops_set_item_preorder / shops_push_preorder_date (the shop), shops_request_preorder / shops_cancel_preorder
--      (the buyer), shops_item_preorders (the product page's read), shop_preorder_sweep (declutter-money, every 10
--      minutes: goal met, goal missed -> every paid preorder refunded, late warning, late -> refunded).
--   6. shop_mark_order_held RESTATED: a preorder's hold is accepted at once (the webhook captures it), the cap and the
--      campaign are re-checked under the item lock; shop_refund_sweep RESTATED: the porch no-photo clock skips
--      preorders (they run on the 7-days-after-ready-by clock).
--   7. Money review 11-08: a preorder's ready tap counts only from 14 days before its ready-by (trigger on
--      shop_handovers: preorder_not_ready_yet), and a preorder item is never on an ordinary order (trigger on
--      shop_order_lines: preorder_use_preorder_checkout). shops_cancel_preorder files a cancel made after the
--      goal-missed stamp or after ready-by + 7 as preorder_goal_missed / preorder_shop_late (the shop pays the fee).
-- Refund rows are sent by declutter-money's shop_refunds_due like every other Shops refund (_shared/shopRefunds.ts:
-- reconcile, then key shop-refund-<row id>); the tax is reversed per PaymentIntent by the existing webhook path.
-- MONEY: yes (lh-money-escrow). AUTHZ: owner/buyer RPCs check auth.uid(); the sweep is service-only.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraints swapped by name, CREATE OR REPLACE, grants restated.

-- 1. Columns.
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_ready_by date;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_set_on date;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_goal smallint;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_goal_by date;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_cap smallint;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_moved_at timestamptz;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_goal_met_at timestamptz;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_goal_missed_at timestamptz;
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS preorder_late_warned_at timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS preorder_item_id uuid REFERENCES public.shop_items(id) ON DELETE RESTRICT;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS preorder_moved_at timestamptz;
CREATE INDEX IF NOT EXISTS shop_orders_preorder_item_idx ON public.shop_orders (preorder_item_id, status)
  WHERE preorder_item_id IS NOT NULL;

ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_preorder_shape;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_preorder_shape CHECK (
  (preorder_ready_by IS NULL AND preorder_set_on IS NULL AND preorder_goal IS NULL AND preorder_goal_by IS NULL AND preorder_cap IS NULL)
  OR (preorder_ready_by IS NOT NULL AND preorder_set_on IS NOT NULL AND preorder_ready_by > preorder_set_on
      AND (preorder_goal IS NULL) = (preorder_goal_by IS NULL)
      AND (preorder_goal IS NULL OR preorder_goal BETWEEN 2 AND 1000)
      AND (preorder_goal_by IS NULL OR (preorder_goal_by >= preorder_set_on AND preorder_goal_by <= preorder_ready_by))
      AND (preorder_cap IS NULL OR preorder_cap BETWEEN 1 AND 1000)
      AND (preorder_cap IS NULL OR preorder_goal IS NULL OR preorder_cap >= preorder_goal)));
-- Card age (see the header): 150 = 120 days at set + one push of 30; + 7 late days = 157 < Stripe's ~180.
ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_preorder_card_age;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_preorder_card_age CHECK (
  preorder_ready_by IS NULL OR preorder_ready_by - preorder_set_on <= 150);
-- A preorder is a made, home-food or farm item with no stock count and no options (v1: digital, service and rental
-- items, and items with options, cannot be preordered).
ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_preorder_kind;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_preorder_kind CHECK (
  preorder_ready_by IS NULL OR (kind IN ('made', 'home_food', 'farm') AND stock_count IS NULL));

GRANT SELECT (preorder_ready_by, preorder_goal, preorder_goal_by, preorder_cap, preorder_moved_at,
              preorder_goal_met_at, preorder_goal_missed_at) ON TABLE public.shop_items TO authenticated;
GRANT SELECT (preorder_item_id, preorder_moved_at) ON TABLE public.shop_orders TO authenticated;

-- 2. RESTATED from 20261018164442_shops_orders_checkout.sql (its only CREATE): preorders never fill a day.
CREATE OR REPLACE FUNCTION public.shop_day_count(p_seller uuid, p_day date, p_statuses text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer FROM public.shop_orders
   WHERE seller_id = p_seller AND ready_date = p_day AND status = ANY (p_statuses) AND preorder_item_id IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.shop_day_count(uuid, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_day_count(uuid, date, text[]) TO service_role;

-- Units a preorder has: paid only (captured: the goal), or every order holding a place (the cap).
CREATE OR REPLACE FUNCTION public.shop_preorder_units(p_item_id uuid, p_paid_only boolean)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(sum(l.quantity), 0)::integer
    FROM public.shop_orders o JOIN public.shop_order_lines l ON l.order_id = o.id
   WHERE o.preorder_item_id = p_item_id
     AND CASE WHEN p_paid_only THEN o.status IN ('accepted', 'handed_over') AND o.captured_at IS NOT NULL
              ELSE o.status IN ('held', 'accepted', 'handed_over') END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_preorder_units(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_preorder_units(uuid, boolean) TO service_role;

-- 3. Reasons. RESTATED from 20261106221300_shops_custom_balance_edge.sql (newest CREATE); only the preorder lines are new.
CREATE OR REPLACE FUNCTION public.shop_refund_fee_policy(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'
    -- unpaid_close_tax: the buyer's own close (late cancel, lapse, no-show). The card fee stays kept: the deposit's
    -- whole card fee was already kept (nothing else of the deposit comes back), so the row keeps 0 more of it.
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault', 'unpaid_close_tax') THEN 'keep_card_fee'
    -- Preorders (20261108184654): the buyer gets every cent back on each automatic preorder refund, and the card fee
    -- is the shop's: its own lateness, its pushed date, or the goal it set and did not reach (owner 10-14 "we never
    -- absorb any fee"; only our own mistake is ours).
    WHEN p_reason IN ('preorder_shop_late', 'preorder_date_moved', 'preorder_goal_missed') THEN 'full_shop_pays_fee'
    WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_fee_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_fee_policy(text) TO service_role;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_refunds_reason_check'
                    AND conrelid = 'public.shop_refunds'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%preorder_goal_missed%') THEN
    ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_reason_check;
    ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_reason_check CHECK (reason IN (
      'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed',
      'problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'unpaid_close_tax',
      'preorder_goal_missed', 'preorder_shop_late', 'preorder_date_moved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_close_reason_check'
                    AND conrelid = 'public.shop_orders'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%preorder_goal_missed%') THEN
    ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_close_reason_check;
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_close_reason_check CHECK (close_reason IS NULL OR close_reason IN (
      'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost',
      'capture_gave_up', 'order_closed', 'amount_mismatch', 'day_full',
      'handed_over',
      'buyer_cancelled_free', 'buyer_cancelled_late', 'buyer_no_show', 'shop_cancelled', 'no_ready_photo',
      'admin_refunded', 'refunded_by_hand',
      'preorder_cancelled', 'preorder_goal_missed', 'preorder_shop_late', 'preorder_date_moved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_refunded_captured'
                    AND conrelid = 'public.shop_orders'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%preorder_goal_missed%') THEN
    ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_refunded_captured;
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_refunded_captured CHECK (
      status <> 'refunded' OR (captured_at IS NOT NULL
        AND close_reason IN ('buyer_cancelled_free', 'shop_cancelled', 'no_ready_photo', 'admin_refunded', 'refunded_by_hand',
                             'preorder_cancelled', 'preorder_goal_missed', 'preorder_shop_late', 'preorder_date_moved')));
  END IF;
END;
$do$;

-- 4. The free-window / late-cancel buyer cancel never closes a preorder (its late branch would pay the shop for an item
--    not made yet). The preorder cancel is shops_cancel_preorder.
CREATE OR REPLACE FUNCTION public.shop_orders_preorder_cancel_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.preorder_item_id IS NOT NULL AND NEW.close_reason IN ('buyer_cancelled_free', 'buyer_cancelled_late')
     AND OLD.close_reason IS DISTINCT FROM NEW.close_reason THEN
    RAISE EXCEPTION 'use_preorder_cancel' USING ERRCODE = '55000',
      HINT = 'This is a preorder. Cancel it from your order to get your money back.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_preorder_cancel_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_preorder_cancel_guard ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_preorder_cancel_guard
  BEFORE UPDATE OF close_reason ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_preorder_cancel_guard();

-- 5a. The shop sets (or turns off) an item's preorder. Only while no preorder of it is open: a running preorder's
--     date moves only through shops_push_preorder_date (once, with the buyers told).
CREATE OR REPLACE FUNCTION public.shops_set_item_preorder(p_item_id uuid, p_ready_by date, p_goal integer,
  p_goal_by date, p_cap integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  i public.shop_items;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.shop_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR i.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.preorder_item_id = i.id
              AND o.status IN ('awaiting_hold', 'held', 'accepted')) THEN
    RAISE EXCEPTION 'preorder_running' USING ERRCODE = '55000',
      HINT = 'This item has open preorders. You can move the ready-by date once, or wait until they are done.';
  END IF;
  IF p_ready_by IS NULL THEN
    UPDATE public.shop_items
       SET preorder_ready_by = NULL, preorder_set_on = NULL, preorder_goal = NULL, preorder_goal_by = NULL,
           preorder_cap = NULL, preorder_moved_at = NULL, preorder_goal_met_at = NULL, preorder_goal_missed_at = NULL,
           preorder_late_warned_at = NULL, updated_at = now()
     WHERE id = i.id;
    RETURN jsonb_build_object('result', 'off', 'item_id', i.id);
  END IF;
  IF i.kind NOT IN ('made', 'home_food', 'farm') THEN
    RAISE EXCEPTION 'preorder_kind' USING ERRCODE = '22023',
      HINT = 'Only made, home-food and farm items can be preordered.';
  END IF;
  IF cardinality(COALESCE(i.option_names, ARRAY[]::text[])) > 0 THEN
    RAISE EXCEPTION 'preorder_options' USING ERRCODE = '22023',
      HINT = 'Items with options (like sizes) cannot be preordered yet.';
  END IF;
  IF i.stock_count IS NOT NULL THEN
    RAISE EXCEPTION 'preorder_stock' USING ERRCODE = '22023',
      HINT = 'Turn off the "ready now" count first. A preorder uses its own limit instead.';
  END IF;
  IF p_ready_by <= v_today OR p_ready_by > v_today + 120 THEN
    RAISE EXCEPTION 'preorder_ready_by' USING ERRCODE = '22023', HINT = 'Pick a ready-by date in the next 120 days.';
  END IF;
  IF (p_goal IS NULL) <> (p_goal_by IS NULL) THEN
    RAISE EXCEPTION 'preorder_goal' USING ERRCODE = '22023', HINT = 'A goal needs both a number of orders and a date.';
  END IF;
  IF p_goal IS NOT NULL AND (p_goal NOT BETWEEN 2 AND 1000) THEN
    RAISE EXCEPTION 'preorder_goal' USING ERRCODE = '22023', HINT = 'The goal is 2 to 1,000 ordered.';
  END IF;
  IF p_goal_by IS NOT NULL AND (p_goal_by < v_today OR p_goal_by > p_ready_by) THEN
    RAISE EXCEPTION 'preorder_goal_by' USING ERRCODE = '22023',
      HINT = 'The goal date is between today and the ready-by date.';
  END IF;
  IF p_cap IS NOT NULL AND (p_cap NOT BETWEEN 1 AND 1000 OR (p_goal IS NOT NULL AND p_cap < p_goal)) THEN
    RAISE EXCEPTION 'preorder_cap' USING ERRCODE = '22023', HINT = 'The limit is 1 to 1,000, and at least the goal.';
  END IF;
  UPDATE public.shop_items
     SET preorder_ready_by = p_ready_by, preorder_set_on = v_today, preorder_goal = p_goal::smallint,
         preorder_goal_by = p_goal_by, preorder_cap = p_cap::smallint, preorder_moved_at = NULL,
         preorder_goal_met_at = NULL, preorder_goal_missed_at = NULL, preorder_late_warned_at = NULL, updated_at = now()
   WHERE id = i.id;
  RETURN jsonb_build_object('result', 'on', 'item_id', i.id, 'ready_by', p_ready_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_preorder(uuid, date, integer, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_preorder(uuid, date, integer, date, integer) TO authenticated, service_role;

-- 5b. The shop pushes ready-by ONCE, by at most 30 days, before the late refunds start. Every open preorder moves with
--     it and its buyer is told they may cancel for a full refund (shops_cancel_preorder: preorder_date_moved).
CREATE OR REPLACE FUNCTION public.shops_push_preorder_date(p_item_id uuid, p_new_ready_by date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  i public.shop_items;
  o record;
  v_n integer := 0;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public.shop_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR i.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF i.preorder_ready_by IS NULL OR i.preorder_goal_missed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_preorder' USING ERRCODE = '55000', HINT = 'This item has no running preorder.';
  END IF;
  IF i.preorder_moved_at IS NOT NULL THEN
    RAISE EXCEPTION 'preorder_already_moved' USING ERRCODE = '55000', HINT = 'The ready-by date can be moved only once.';
  END IF;
  IF ((i.preorder_ready_by + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now() THEN
    RAISE EXCEPTION 'preorder_too_late' USING ERRCODE = '55000', HINT = 'It is too late to move this date.';
  END IF;
  IF p_new_ready_by IS NULL OR p_new_ready_by <= i.preorder_ready_by OR p_new_ready_by > i.preorder_ready_by + 30
     OR p_new_ready_by - i.preorder_set_on > 150 THEN
    RAISE EXCEPTION 'preorder_push_range' USING ERRCODE = '22023', HINT = 'Move it later by at most 30 days.';
  END IF;
  UPDATE public.shop_items SET preorder_ready_by = p_new_ready_by, preorder_moved_at = now(),
                               preorder_late_warned_at = NULL, updated_at = now()
   WHERE id = i.id;
  FOR o IN
    SELECT so.id, so.buyer_id FROM public.shop_orders so
     WHERE so.preorder_item_id = i.id AND so.status IN ('held', 'accepted')
     ORDER BY so.id FOR UPDATE
  LOOP
    UPDATE public.shop_orders SET ready_date = p_new_ready_by, preorder_moved_at = now() WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder date moved',
      format('The shop moved "%s" to ready by %s. If that does not work for you, cancel it from your order for a full refund.',
             i.title, to_char(p_new_ready_by, 'FMMonth FMDD')),
      '/shops/orders', v_uid);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('result', 'moved', 'item_id', i.id, 'ready_by', p_new_ready_by, 'orders', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_push_preorder_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_push_preorder_date(uuid, date) TO authenticated, service_role;

-- 5c. The buyer asks for a preorder: ONE item, its quantity, ready on the preorder's own date. Every gate of
--     shops_request_order (newest: 20261106165310) that is not about picking a day, then the preorder's own: still
--     open, not past its goal date, the cap not reached. shop-checkout then opens the Stripe page as for any order.
CREATE OR REPLACE FUNCTION public.shops_request_preorder(p_shop_id uuid, p_item_id uuid, p_quantity integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  i public.shop_items;
  v_today date := public.shop_local_today();
  v_unit integer;
  v_items integer;
  v_order uuid;
  v_old_session text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
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
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
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
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023', HINT = 'Order 1 to 20 of each item.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO i FROM public.shop_items WHERE id = p_item_id;
  IF i.id IS NULL OR i.shop_id <> s.id OR i.status <> 'live' THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'An item in this order is no longer listed.';
  END IF;
  IF i.preorder_ready_by IS NULL OR i.preorder_goal_missed_at IS NOT NULL OR i.preorder_ready_by <= v_today
     OR (i.preorder_goal_by IS NOT NULL AND i.preorder_goal_by < v_today) THEN
    RAISE EXCEPTION 'preorder_closed' USING ERRCODE = '55000', HINT = 'This preorder is closed.';
  END IF;
  IF i.preorder_cap IS NOT NULL AND public.shop_preorder_units(i.id, false) + p_quantity > i.preorder_cap THEN
    RAISE EXCEPTION 'preorder_full' USING ERRCODE = '55000',
      HINT = format('Only %s left to preorder.', greatest(i.preorder_cap - public.shop_preorder_units(i.id, false), 0));
  END IF;
  IF i.kind = 'home_food' AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;
  v_unit := public.shop_line_unit_cents(i.id, NULL);
  v_items := v_unit * p_quantity;
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents, preorder_item_id)
  VALUES (v_uid, s.owner_id, s.id, i.preorder_ready_by, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items), i.id)
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, variant_id, variant_label, title, kind, unit_cents,
                                       quantity, line_cents, is_seed)
  VALUES (v_order, i.id, NULL, NULL, i.title, i.kind, v_unit, p_quantity::smallint, v_items,
          (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order));
  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', i.preorder_ready_by, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_preorder(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_preorder(uuid, uuid, integer, text) TO authenticated, service_role;

-- 5d. The buyer cancels a paid preorder any time before the shop marks it ready. After the shop pushed the date: a
--     full refund (the shop pays the card fee). Otherwise the buyer's own cancel: everything back but Stripe's card fee
--     and its tax (buyer_cancelled, as every Shops buyer cancel). The goal, once met, stays met.
CREATE OR REPLACE FUNCTION public.shops_cancel_preorder(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- No ban check and no switch check: cancelling only lets the buyer's money go (as shop-checkout's cancel, L91).
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR o.preorder_item_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'preorder_ready' USING ERRCODE = '55000',
      HINT = 'The shop already marked this order ready, so it can no longer be cancelled.';
  END IF;
  -- Money review 11-08: a cancel that lands after the sweep's own trigger is filed as the sweep would file it, so the
  -- shop carries the card fee: the goal-missed stamp is set (the sweep refunds every paid order of the item), or the
  -- late refund time (end of ready-by + 7, Louisiana time) has passed. Then a pushed date; else the buyer's own cancel.
  v_reason := CASE
    WHEN EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = o.preorder_item_id AND i.preorder_goal_missed_at IS NOT NULL)
      THEN 'preorder_goal_missed'
    WHEN ((o.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now() THEN 'preorder_shop_late'
    WHEN o.preorder_moved_at IS NOT NULL THEN 'preorder_date_moved'
    ELSE 'buyer_cancelled' END;
  UPDATE public.shop_orders SET status = 'refunded',
         close_reason = CASE WHEN v_reason = 'buyer_cancelled' THEN 'preorder_cancelled' ELSE v_reason END,
         closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, v_reason, NULL);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Preorder cancelled',
    format('A buyer cancelled their preorder for %s.', to_char(o.ready_date, 'FMMonth FMDD')), '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder cancelled',
    format('$%s is on its way back to your card%s. Card refunds usually show up in 5 to 10 business days.',
           to_char(r.refund_cents / 100.0, 'FM999999990.00'),
           CASE WHEN r.kept_cents > 0 THEN ', less what the card company kept' ELSE '' END
           || CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_cancel_preorder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_cancel_preorder(uuid) TO authenticated, service_role;

-- 5e. The product page's read: each live preorder item of a shop the caller can see, with its paid count.
CREATE OR REPLACE FUNCTION public.shops_item_preorders(p_shop_id uuid)
RETURNS TABLE (item_id uuid, ready_by date, goal integer, goal_by date, cap integer, ordered integer,
               goal_met boolean, goal_missed boolean, moved boolean, open boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT i.id, i.preorder_ready_by, i.preorder_goal::integer, i.preorder_goal_by, i.preorder_cap::integer,
           public.shop_preorder_units(i.id, true),
           i.preorder_goal_met_at IS NOT NULL, i.preorder_goal_missed_at IS NOT NULL, i.preorder_moved_at IS NOT NULL,
           (i.preorder_goal_missed_at IS NULL AND i.preorder_ready_by > v_today
            AND (i.preorder_goal_by IS NULL OR i.preorder_goal_by >= v_today)
            AND (i.preorder_cap IS NULL OR public.shop_preorder_units(i.id, false) < i.preorder_cap))
      FROM public.shop_items i
     WHERE i.shop_id = p_shop_id AND i.preorder_ready_by IS NOT NULL
       AND (i.status = 'live' OR i.owner_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_item_preorders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_item_preorders(uuid) TO authenticated, service_role;

-- 5f. The preorder clock (declutter-money, every 10 minutes, before shop_refunds_due sends what it writes):
--   goal met    -> stamped once; every buyer with a paid preorder and the shop are told. Later cancels never undo it.
--   goal missed -> at the end of the goal date with the goal not met, stamped once; then (this run and every later
--                  run, so an order captured after the stamp is caught too) every paid preorder of the item is
--                  refunded IN FULL (preorder_goal_missed: buyer fee included; the shop carries Stripe's card fee) and
--                  its buyer told; the shop is told once.
--   late warning-> 3 days before the late refunds (ready-by + 4 days) with an open preorder not marked ready: the shop
--                  is told once (again after a push).
--   late        -> 7 days after ready-by (end of day), every paid preorder the shop has not marked ready is refunded in
--                  full (preorder_shop_late: the shop pays the card fee), buyer and shop told.
-- Each order is decided under its own row lock (shop_lock_open_charged_order) and written with shop_write_refund
-- (one refund row per order, ever: the UNIQUE order_id), so a run that repeats never refunds twice. A failure is a
-- cron defect for that order and never stops the others.
CREATE OR REPLACE FUNCTION public.shop_preorder_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  it record;
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  v_now_local date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_met integer := 0;
  v_missed integer := 0;
  v_missed_refunds integer := 0;
  v_warned integer := 0;
  v_late_refunds integer := 0;
BEGIN
  -- Goal met (paid units only).
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_goal, i.preorder_ready_by FROM public.shop_items i
     WHERE i.preorder_goal IS NOT NULL AND i.preorder_goal_met_at IS NULL AND i.preorder_goal_missed_at IS NULL
       AND public.shop_preorder_units(i.id, true) >= i.preorder_goal
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      UPDATE public.shop_items SET preorder_goal_met_at = now()
       WHERE id = it.id AND preorder_goal_met_at IS NULL AND preorder_goal_missed_at IS NULL;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM public.declutter_notify(it.owner_id, 'payment', 'Preorder goal reached',
        format('"%s" reached its goal of %s. Make it by %s.', it.title, it.preorder_goal, to_char(it.preorder_ready_by, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      FOR c IN
        SELECT so.id, so.buyer_id FROM public.shop_orders so
         WHERE so.preorder_item_id = it.id AND so.status = 'accepted' AND so.captured_at IS NOT NULL
      LOOP
        PERFORM public.declutter_notify(c.buyer_id, 'info', 'Your preorder is happening',
          format('"%s" reached its goal, so the shop is making it. It is ready by %s.', it.title, to_char(it.preorder_ready_by, 'FMMonth FMDD')),
          '/shops/orders', it.owner_id);
      END LOOP;
      v_met := v_met + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'goal met: ' || SQLERRM);
    END;
  END LOOP;

  -- Goal missed: the goal date has ended (Louisiana time) and the goal is not met.
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_goal, i.preorder_goal_by FROM public.shop_items i
     WHERE i.preorder_goal IS NOT NULL AND i.preorder_goal_met_at IS NULL AND i.preorder_goal_missed_at IS NULL
       AND i.preorder_goal_by < v_now_local
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      -- One last count under the item lock: a goal reached on its last day is met, not missed.
      PERFORM 1 FROM public.shop_items WHERE id = it.id FOR UPDATE;
      IF public.shop_preorder_units(it.id, true) >= it.preorder_goal THEN
        UPDATE public.shop_items SET preorder_goal_met_at = now() WHERE id = it.id AND preorder_goal_met_at IS NULL;
        CONTINUE;
      END IF;
      UPDATE public.shop_items SET preorder_goal_missed_at = now() WHERE id = it.id AND preorder_goal_missed_at IS NULL;
      PERFORM public.declutter_notify(it.owner_id, 'warning', 'Preorder goal not reached',
        format('"%s" did not reach %s by %s, so every buyer is refunded in full. You do not need to make it.',
               it.title, it.preorder_goal, to_char(it.preorder_goal_by, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      v_missed := v_missed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'goal missed: ' || SQLERRM);
    END;
  END LOOP;
  FOR c IN
    SELECT so.id FROM public.shop_orders so JOIN public.shop_items i ON i.id = so.preorder_item_id
     WHERE i.preorder_goal_missed_at IS NOT NULL AND so.status = 'accepted' AND so.captured_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = so.id AND h.problem_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)
     ORDER BY so.id LIMIT 200
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_goal_missed', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'preorder_goal_missed', NULL);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder refunded',
        format('The preorder did not reach its goal, so all $%s is on its way back to your card. Card refunds usually show up in 5 to 10 business days.',
               to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      v_missed_refunds := v_missed_refunds + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', c.id::text, 'goal missed refund: ' || SQLERRM);
    END;
  END LOOP;

  -- Late warning: ready-by + 4 days has started, an open paid preorder is not marked ready.
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_ready_by FROM public.shop_items i
     WHERE i.preorder_ready_by IS NOT NULL AND i.preorder_late_warned_at IS NULL
       AND ((i.preorder_ready_by + 4)::timestamp AT TIME ZONE 'America/Chicago') <= now()
       AND EXISTS (SELECT 1 FROM public.shop_orders so
                    LEFT JOIN public.shop_handovers h ON h.order_id = so.id
                    WHERE so.preorder_item_id = i.id AND so.status = 'accepted' AND h.ready_at IS NULL)
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      UPDATE public.shop_items SET preorder_late_warned_at = now() WHERE id = it.id AND preorder_late_warned_at IS NULL;
      PERFORM public.declutter_notify(it.owner_id, 'warning', 'Preorder is late',
        format('"%s" was due by %s. Mark each order ready by %s, or those buyers are refunded automatically and what the card company keeps on each refund comes out of your next payout.',
               it.title, to_char(it.preorder_ready_by, 'FMMonth FMDD'), to_char(it.preorder_ready_by + 7, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      v_warned := v_warned + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'late warning: ' || SQLERRM);
    END;
  END LOOP;

  -- Late: 7 days after ready-by has ended, a paid preorder the shop never marked ready is refunded in full.
  FOR c IN
    SELECT so.id FROM public.shop_orders so JOIN public.shop_items i ON i.id = so.preorder_item_id
      LEFT JOIN public.shop_handovers h ON h.order_id = so.id
     WHERE so.status = 'accepted' AND so.captured_at IS NOT NULL AND h.ready_at IS NULL AND h.problem_at IS NULL
       AND ((so.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now()
       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)
     ORDER BY so.id LIMIT 200
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
        CONTINUE;  -- marked ready since the scan
      END IF;
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_shop_late', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'preorder_shop_late', NULL);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder refunded',
        format('The shop did not have your preorder ready within 7 days of %s, so all $%s is on its way back to your card.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'warning', 'Preorder refunded',
        format('The preorder due by %s was not marked ready within 7 days, so the buyer was refunded in full. $%s the card company kept comes out of your next payout.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
        '/shops/dashboard', o.buyer_id);
      v_late_refunds := v_late_refunds + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', c.id::text, 'late refund: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('goal_met', v_met, 'goal_missed', v_missed, 'goal_missed_refunds', v_missed_refunds,
                            'late_warned', v_warned, 'late_refunds', v_late_refunds);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_preorder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_preorder_sweep() TO service_role;

-- 6a. RESTATED from 20261106180902_shops_delivery.sql (newest CREATE): preorders accepted at the hold (see header).
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
  v_fee_charged boolean;
  v_won boolean;
  v_pre public.shop_items;
  v_pre_units integer;
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
  -- Delivery (20261106180902): the page also carries the order's frozen delivery fee (0 for a pickup).
  -- H4-fee: the page carries the frozen setup fee on top of total (items + fee + tax), or, for a page opened
  -- before shop-checkout learned the fee, total alone (then nothing is claimed: not_charged).
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total IS NOT DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents + o.setup_fee_cents;
  IF p_tax_cents IS NULL OR p_tax_cents < 0
     OR (NOT v_fee_charged AND p_amount_total IS DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents) THEN
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
  -- Preorders (20261108184654): a preorder is never counted against the day (shop_day_count skips them), so its
  -- own ready-by date is never "full".
  IF o.preorder_item_id IS NULL AND v_cap IS NOT NULL
     AND public.shop_day_count(o.seller_id, o.ready_date, ARRAY['held', 'accepted', 'handed_over']) >= v_cap THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'day_full', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'That day filled up',
      'Another order took the last spot that day, so nothing was charged and the hold on your card was released. Pick another day.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'day_full', 'order_id', o.id);
  END IF;
  -- Preorders: the item row is locked (every preorder hold of this item queues here), then the preorder must still be
  -- open (not missed, not past its goal deadline or ready-by) and the cap must still fit this order. Otherwise the hold
  -- goes back at no cost.
  IF o.preorder_item_id IS NOT NULL THEN
    SELECT * INTO v_pre FROM public.shop_items WHERE id = o.preorder_item_id FOR UPDATE;
    v_pre_units := public.shop_preorder_units(o.preorder_item_id, false);
    IF v_pre.id IS NULL OR v_pre.preorder_ready_by IS DISTINCT FROM o.ready_date OR v_pre.preorder_goal_missed_at IS NOT NULL
       OR v_pre.preorder_ready_by < public.shop_local_today()
       OR (v_pre.preorder_goal_by IS NOT NULL AND v_pre.preorder_goal_by < public.shop_local_today())
       OR (v_pre.preorder_cap IS NOT NULL
           AND v_pre_units + (SELECT COALESCE(sum(l.quantity), 0)::integer FROM public.shop_order_lines l WHERE l.order_id = o.id) > v_pre.preorder_cap) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder filled up or closed while you were paying, so nothing was charged and the hold on your card is released.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'preorder_closed', 'order_id', o.id);
    END IF;
  END IF;
  -- H4-fee: the one-winner claim. Lost (the account paid the fee elsewhere while the buyer was on the page): the hold
  -- goes back at no cost and the buyer orders again without it, so the fee is never charged twice.
  IF v_fee_charged THEN
    UPDATE public.profiles
       SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
     WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE
    RETURNING onboarding_fee_paid INTO v_won;
    IF v_won IS NOT TRUE THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                    setup_fee_state = 'paid_elsewhere',
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Please order again',
        'You already paid the one-time account setup fee, so this order''s page should not have included it. Nothing was charged and the hold on your card is released. Order again and the fee will not be on it.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'setup_fee_paid_elsewhere', 'order_id', o.id);
    END IF;
  END IF;
  UPDATE public.shop_orders
     SET status = 'held', stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode,
         tax_cents = p_tax_cents,
         -- H4-fee: total_cents stays the sale; the fee lives in setup_fee_cents.
         total_cents = p_amount_total - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now() + interval '24 hours'
   WHERE id = o.id;
  -- Preorders: the shop said yes when it opened the preorder, so the order is accepted at once and the webhook captures
  -- it right away (shop_captures_due picks up a capture that did not answer): the buyer pays in full at order (owner
  -- 11-08).
  IF o.preorder_item_id IS NOT NULL THEN
    UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New preorder',
      format('A new preorder for "%s" came in, ready by %s.', v_pre.title, to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    RETURN jsonb_build_object('result', 'held', 'order_id', o.id, 'preorder', true);
  END IF;
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

-- 6b. RESTATED from 20261030150104_admin_alerts_skip_test_gaps.sql (newest CREATE): the porch no-photo clock skips preorders.
CREATE OR REPLACE FUNCTION public.shop_refund_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  a record;
  v_done integer := 0;
BEGIN
  FOR c IN
    SELECT so.id FROM public.shop_orders so
      LEFT JOIN public.shop_handovers h ON h.order_id = so.id
     WHERE so.status = 'accepted' AND so.captured_at IS NOT NULL AND so.handover_mode = 'porch'
       -- Preorders (20261108184654) run on their own clock: 7 days after ready-by (shop_preorder_sweep).
       AND so.preorder_item_id IS NULL
       AND h.ready_photo_path IS NULL AND h.problem_at IS NULL
       AND ((so.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '3 days' <= now()
     ORDER BY so.ready_date, so.id LIMIT 100
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      -- Re-read under the lock: a photo posted since the scan wins.
      IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_photo_path IS NOT NULL) THEN
        CONTINUE;
      END IF;
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'no_ready_photo', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'no_ready_photo', NULL);
      PERFORM public.shop_give_strike(o.seller_id, 'shop', 'no_ready_photo', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
        format('The shop never marked your order for %s ready, so all $%s is on its way back to your card.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
        format('You never posted the ready photo for the order for %s, so the buyer was refunded in full. The $%s card fee comes out of your next payout, and it counts as a Shops strike.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
        '/shops/dashboard', o.buyer_id);
      -- Test stuff never reaches an admin (owner 2026-10-30): a cron has no
      -- signed-in member and the link is bare '/admin', so the skip is here.
      IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
        FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
          PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order refunded by the clock',
            'A left-out Shops order had no ready photo 3 days after its date, so the buyer was refunded and the shop got a strike.', '/admin');
        END LOOP;
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_refund_sweep', c.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('no_ready_photo_refunded', v_done);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_sweep() TO service_role;

-- 7. Money review 11-08 (1): the shop's ready tap on a preorder counts only from 14 days before its ready-by date
--    (Louisiana date). A tap months early would end the buyer's cancel (shops_cancel_preorder: preorder_ready) and
--    the late refund (the sweep skips an order marked ready) for an item that is not made. A trigger on the one table
--    every ready tap writes (shops_mark_ready, 20261105190034, and any later restatement of it), so no path skips it.
--    A retake of an order already marked ready is left alone (the first ready time never moves).
CREATE OR REPLACE FUNCTION public.shop_handovers_preorder_ready_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ready date;
BEGIN
  IF NEW.ready_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ready_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.shop_handovers h
                                   WHERE h.order_id = NEW.order_id AND h.ready_at IS NOT NULL) THEN
    RETURN NEW;  -- shops_mark_ready's retake: ON CONFLICT keeps the first ready time
  END IF;
  SELECT o.ready_date INTO v_ready FROM public.shop_orders o
   WHERE o.id = NEW.order_id AND o.preorder_item_id IS NOT NULL;
  IF v_ready IS NOT NULL AND public.shop_local_today() < v_ready - 14 THEN
    RAISE EXCEPTION 'preorder_not_ready_yet' USING ERRCODE = '55000',
      HINT = format('You can mark this preorder ready from %s.', to_char(v_ready - 14, 'FMMonth FMDD'));
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handovers_preorder_ready_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_handovers_preorder_ready_guard ON public.shop_handovers;
CREATE TRIGGER trg_shop_handovers_preorder_ready_guard
  BEFORE INSERT OR UPDATE OF ready_at ON public.shop_handovers
  FOR EACH ROW EXECUTE FUNCTION public.shop_handovers_preorder_ready_guard();

-- 8. Money review 11-08 (2): a preorder item is ordered ONLY through shops_request_preorder. An ordinary order
--    (shops_request_order, newest 20261106165310) of it would skip the cap, the goal and the automatic refunds, and
--    run on the 24-hour hold. A trigger on the order lines, so every order path is covered: a line naming an item
--    that is a preorder is refused unless its order is that item's preorder.
CREATE OR REPLACE FUNCTION public.shop_order_lines_preorder_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = NEW.item_id AND i.preorder_ready_by IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = NEW.order_id AND o.preorder_item_id = NEW.item_id) THEN
    RAISE EXCEPTION 'preorder_use_preorder_checkout' USING ERRCODE = '55000',
      HINT = 'This item is a preorder. Order it on its own as a preorder.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_lines_preorder_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_order_lines_preorder_guard ON public.shop_order_lines;
CREATE TRIGGER trg_shop_order_lines_preorder_guard
  BEFORE INSERT OR UPDATE OF item_id, order_id ON public.shop_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.shop_order_lines_preorder_guard();
