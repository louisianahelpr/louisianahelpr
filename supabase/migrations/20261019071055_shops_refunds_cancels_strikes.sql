-- Shops M3: refunds, cancels and strikes (docs/specs/local-shops-prep.md L41-L43,
-- L75, O2, O3; plan ~/.lh-wt/handoffs-1017/shops-s3-plan.md M3; owner decisions
-- 2026-10-18 ~19:55Z: O3 buyer no-show = a late cancel under the shop's preset +
-- a buyer strike; a shop that cancels refunds the buyer IN FULL and is billed the
-- card fee + a strike; NEVER absorb a fee; our-mistake refunds stay full; Shops
-- has its OWN strike count, shop_strikes, 20261018164444).
--
-- Every path here acts on an ACCEPTED order whose hold was CAPTURED and that is
-- not handed over (before acceptance the hold just drops, M1). Each one:
--   1. locks the order row (FOR UPDATE) first,
--   2. decides from ONE reading under that lock (the buyer's cancel calls
--      shop_order_free_cancel_until in this same transaction),
--   3. records the outcome on the order (status out of 'accepted', close_reason
--      saying free/late/who) and writes the money row (shop_refunds or
--      shop_payouts) before commit,
--   4. and only after commit does an edge function call Stripe (shop-checkout's
--      tap, declutter-money's retry) with the key shop-refund-<refund id>.
--
-- The outcomes (O2, O3, L42, L43, L75):
--   buyer cancel, free (inside the window)  -> status 'refunded', close_reason
--       'buyer_cancelled_free'; refund = paid - Stripe's card fee - the sales tax
--       on that kept fee (Jobs J3, owner 2026-10-18: the tax on a kept amount is
--       kept from the refund, we never pay it); stock back.
--   buyer cancel, late (outside the window) -> status 'cancelled', close_reason
--       'buyer_cancelled_late'; nothing is refunded (all of it is kept, so all
--       of its tax is kept), the shop is paid its items (shop_payouts, minus its
--       card-fee debt) as if handed over.
--   buyer no-show (O3, in-person orders, reported by the shop after the ready
--       date ended) -> exactly the late cancel ('buyer_no_show') + a BUYER strike.
--   shop cancel (L42)  -> status 'refunded', 'shop_cancelled'; the buyer gets
--       EVERYTHING back; Stripe's card fee becomes the shop's fee debt (the one
--       ledger shared with Declutter, which now carries shop_refund_id); a SHOP
--       strike; stock back.
--   left-out order with no ready photo 3 days after its ready date (Q2155 a) ->
--       the shop-cancel outcome ('no_ready_photo'), every admin told.
--   admin (M4, L43/L75): pay the shop (shop_complete_handover 'admin'), or refund
--       by reason: problem_shop_fault (full, shop pays the fee, shop strike),
--       problem_no_fault (price back, card fee + its tax kept), problem_our_mistake
--       (full, the one case the platform carries the fee: owner 10-14), shop_removed
--       (full, shop pays the fee).
-- reason -> fee_policy -> amounts are table CHECKs (Declutter's pattern), so no
-- code path can write a refund that keeps the wrong amount.
--
-- A handed-over order is final: no path here refunds one (so a consumed fee-debt
-- deduction is never orphaned, Q2155 b).
--
-- L91: no switch on any of these (they only finish or unwind money).
-- Replay-safe: IF NOT EXISTS / OR REPLACE / constraint swaps in DO blocks; every
-- constraint validated (the looser CHECKs hold for every existing row). Grants by
-- role name; REVOKE ... FROM PUBLIC, anon (and authenticated for service steps).
-- Only UNIQUE indexes (no new unused_index name). Section 12 adds the Louisiana
-- marketplace-facilitator YTD counter and its $80,000 early warning. Section 13
-- records refunds made BY HAND in the Stripe Dashboard (the webhook, or an admin's
-- "Record a refund made in Stripe"): the order closes and the shop is never paid
-- for it by a clock. Applied 3x by src/test/pglite/shopsRefunds.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The order: new close reasons; a captured order may now end 'cancelled'
--    (a late cancel or a no-show, the shop paid).
DO $do$
BEGIN
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_close_reason_check;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_close_reason_check CHECK (close_reason IS NULL OR close_reason IN (
    'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost',
    'capture_gave_up', 'order_closed', 'amount_mismatch', 'day_full',
    'handed_over',
    'buyer_cancelled_free', 'buyer_cancelled_late', 'buyer_no_show', 'shop_cancelled', 'no_ready_photo',
    'admin_refunded', 'refunded_by_hand'));
  -- 'partially_refunded': a refund made by hand in Stripe that did not return the whole
  -- payment (section 13). Terminal; the shop is not paid until an admin decides.
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_status_check;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_status_check CHECK (status IN (
    'awaiting_hold', 'held', 'accepted', 'declined', 'expired', 'cancelled', 'superseded', 'handed_over',
    'refunded', 'partially_refunded'));
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_captured_is_accepted;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_captured_is_accepted CHECK (
    captured_at IS NULL OR status IN ('accepted', 'handed_over', 'refunded', 'partially_refunded', 'cancelled'));
  -- A captured order that ends 'cancelled' is one the shop is paid for.
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_captured_cancel_is_late;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_captured_cancel_is_late CHECK (
    status <> 'cancelled' OR captured_at IS NULL OR close_reason IN ('buyer_cancelled_late', 'buyer_no_show'));
  -- 'refunded' is only ever a captured order with its refund row.
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_refunded_captured;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_refunded_captured CHECK (
    status <> 'refunded' OR (captured_at IS NOT NULL
      AND close_reason IN ('buyer_cancelled_free', 'shop_cancelled', 'no_ready_photo', 'admin_refunded', 'refunded_by_hand')));
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_partial_is_by_hand;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_partial_is_by_hand CHECK (
    status <> 'partially_refunded' OR (captured_at IS NOT NULL AND close_reason = 'refunded_by_hand'));
END
$do$;

-- ---------------------------------------------------------------------------
-- 1. Refunds: one per order, ever. reason -> fee_policy -> amounts by CHECK.
--    ONE formula (/code-review of shops-m3-v1 #7): who carries the card fee
--    (shop_refund_fee_policy) and the tax kept on a kept fee (shop_refund_tax_kept)
--    are the two functions the table CHECKs call, and shop_refund_amounts(order,
--    reason) builds every refund amount from them: the buyer's quote and the
--    refund write read the same figures the CHECKs hold.
CREATE OR REPLACE FUNCTION public.shop_refund_fee_policy(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee'
    WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_fee_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_fee_policy(text) TO service_role;

-- J3: the sales tax on what is kept is kept too, rounded up (Jobs' taxOnKeptCents).
CREATE OR REPLACE FUNCTION public.shop_refund_tax_kept(p_kept integer, p_tax integer, p_paid integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_kept = 0 OR p_tax = 0 THEN 0
              ELSE ceil(p_kept::numeric * p_tax / (p_paid - p_tax))::integer END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_tax_kept(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_tax_kept(integer, integer, integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.shop_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
  stripe_payment_intent_id text NOT NULL UNIQUE CHECK (stripe_payment_intent_id ~ '^pi_'),
  reason text NOT NULL CHECK (reason IN (
    'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed',
    'problem_shop_fault', 'problem_no_fault', 'problem_our_mistake')),
  fee_policy text NOT NULL CHECK (fee_policy IN ('keep_card_fee', 'full_shop_pays_fee', 'full_platform_absorbs')),
  paid_cents integer NOT NULL CHECK (paid_cents > 0),
  tax_cents integer NOT NULL CHECK (tax_cents >= 0),
  card_fee_cents integer NOT NULL CHECK (card_fee_cents >= 0),
  kept_cents integer NOT NULL,
  tax_kept_cents integer NOT NULL,
  refund_cents integer NOT NULL,
  -- held_for_review: a refund made by hand in Stripe stands on this order (section 13): no
  -- cron sends this row; only an admin settles or releases it (section 14, the readiness
  -- admin tools). settled_by_hand: an admin settled it with money moved outside the app.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand')),
  review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 300),
  review_held_at timestamptz,
  held_notified_at timestamptz,
  settled_by_hand_ref text,
  settled_by_hand_cents integer,
  settled_by_hand_note text,
  stripe_refund_id text UNIQUE CHECK (stripe_refund_id IS NULL OR stripe_refund_id ~ '^(re|pyr)_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  -- How many times Stripe failed / canceled a refund this row had recorded: each one
  -- starts a fresh run of tries under its own idempotency keys (shop-refund-<id>-v<n>).
  reversals integer NOT NULL DEFAULT 0 CHECK (reversals BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT shop_refunds_tax_inside CHECK (tax_cents < paid_cents AND card_fee_cents <= paid_cents),
  -- Who carries Stripe's card fee, by reason (owner: never absorb, except our mistake).
  CONSTRAINT shop_refunds_policy CHECK (fee_policy = public.shop_refund_fee_policy(reason)),
  CONSTRAINT shop_refunds_kept CHECK (kept_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN card_fee_cents ELSE 0 END),
  -- J3: the sales tax on what is kept is kept too, rounded up (Jobs' taxOnKeptCents).
  CONSTRAINT shop_refunds_tax_kept CHECK (tax_kept_cents = public.shop_refund_tax_kept(kept_cents, tax_cents, paid_cents)),
  CONSTRAINT shop_refunds_amount CHECK (refund_cents = paid_cents - kept_cents - tax_kept_cents AND refund_cents > 0),
  CONSTRAINT shop_refunds_succeeded CHECK (status <> 'succeeded' OR stripe_refund_id IS NOT NULL),
  -- Settled by an admin (section 14): only ever for the WHOLE refund the row owes, with what it was settled by.
  CONSTRAINT shop_refunds_settled_in_full CHECK (settled_by_hand_cents IS NULL OR settled_by_hand_cents = refund_cents),
  CONSTRAINT shop_refunds_settled_says_how CHECK (status <> 'settled_by_hand' OR (settled_by_hand_ref IS NOT NULL AND settled_by_hand_cents IS NOT NULL))
);
ALTER TABLE public.shop_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_refunds FROM PUBLIC, anon, authenticated;
-- The two sides read their order's refund (not the Stripe ids, not the retry bookkeeping).
GRANT SELECT (id, order_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents,
              refund_cents, status, created_at, executed_at)
  ON TABLE public.shop_refunds TO authenticated;
GRANT ALL ON TABLE public.shop_refunds TO service_role;
DROP POLICY IF EXISTS "shop refunds: the two sides read" ON public.shop_refunds;
CREATE POLICY "shop refunds: the two sides read" ON public.shop_refunds
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin')
         OR EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = shop_refunds.order_id
                  AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));
COMMENT ON TABLE public.shop_refunds IS
  'Shops M3: one refund per order. reason -> fee_policy -> amounts are CHECKs. Written only by shop_* RPCs; sent by shop-checkout / declutter-money with key shop-refund-<id>.';

DROP TRIGGER IF EXISTS trg_shop_refunds_seed ON public.shop_refunds;
CREATE TRIGGER trg_shop_refunds_seed BEFORE INSERT ON public.shop_refunds
  FOR EACH ROW EXECUTE FUNCTION public.shop_money_rows_seed();

-- ---------------------------------------------------------------------------
-- 2. ONE fee-debt ledger per seller across Declutter and Shops: a debt comes
--    from a Declutter refund OR a Shops refund, exactly one.
ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS shop_refund_id uuid;
ALTER TABLE public.declutter_seller_fee_debts ALTER COLUMN refund_id DROP NOT NULL;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_fee_debts_shop_refund_fkey') THEN
    ALTER TABLE public.declutter_seller_fee_debts ADD CONSTRAINT declutter_fee_debts_shop_refund_fkey
      FOREIGN KEY (shop_refund_id) REFERENCES public.shop_refunds(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_fee_debts_shop_refund_once') THEN
    ALTER TABLE public.declutter_seller_fee_debts ADD CONSTRAINT declutter_fee_debts_shop_refund_once UNIQUE (shop_refund_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_fee_debts_one_source') THEN
    ALTER TABLE public.declutter_seller_fee_debts ADD CONSTRAINT declutter_fee_debts_one_source
      CHECK (num_nonnulls(refund_id, shop_refund_id) = 1);
  END IF;
END
$do$;
GRANT SELECT (id, seller_id, amount_cents, remaining_cents, created_at) ON TABLE public.declutter_seller_fee_debts TO authenticated;
GRANT ALL ON TABLE public.declutter_seller_fee_debts TO service_role;

-- ---------------------------------------------------------------------------
-- 2b. The ledger of refunds made by hand in Stripe on a Shops charge (section 13
--     says how it is written and what it blocks).
CREATE TABLE IF NOT EXISTS public.shop_hand_refunds (
  stripe_refund_id text PRIMARY KEY CHECK (stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9]+$'),
  stripe_payment_intent_id text NOT NULL CHECK (stripe_payment_intent_id ~ '^pi_'),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
  shop_refund_id uuid REFERENCES public.shop_refunds(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  livemode boolean,
  recorded_how text NOT NULL CHECK (recorded_how IN ('webhook', 'admin')),
  recorded_by uuid,
  outcome text NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  failed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_hand_refunds_admin_says_who CHECK (recorded_how <> 'admin' OR recorded_by IS NOT NULL)
);
-- The two foreign keys are covered by UNIQUE indexes (their leading column), as in the rest of this file.
CREATE UNIQUE INDEX IF NOT EXISTS shop_hand_refunds_order_once ON public.shop_hand_refunds (order_id, stripe_refund_id);
CREATE UNIQUE INDEX IF NOT EXISTS shop_hand_refunds_row_once ON public.shop_hand_refunds (shop_refund_id, stripe_refund_id);
ALTER TABLE public.shop_hand_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_hand_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_hand_refunds TO service_role;
DROP TRIGGER IF EXISTS trg_shop_hand_refunds_seed ON public.shop_hand_refunds;
CREATE TRIGGER trg_shop_hand_refunds_seed BEFORE INSERT ON public.shop_hand_refunds
  FOR EACH ROW EXECUTE FUNCTION public.shop_money_rows_seed();

-- ---------------------------------------------------------------------------
-- 3. Strikes: once per order, person and reason; each expires after a year (L45).
CREATE UNIQUE INDEX IF NOT EXISTS shop_strikes_once ON public.shop_strikes (order_id, user_id, reason) WHERE order_id IS NOT NULL;
ALTER TABLE public.shop_strikes ADD COLUMN IF NOT EXISTS removed_note text;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_strikes_removed_note_len') THEN
    ALTER TABLE public.shop_strikes ADD CONSTRAINT shop_strikes_removed_note_len
      CHECK (removed_note IS NULL OR char_length(removed_note) <= 500);
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.shop_strikes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_strikes TO service_role;

CREATE OR REPLACE FUNCTION public.shop_give_strike(p_user uuid, p_side text, p_reason text, p_order uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  IF p_user IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.shop_strikes (user_id, offender_side, reason, order_id, expires_at, is_seed)
  VALUES (p_user, p_side, p_reason, p_order, now() + interval '1 year',
          COALESCE((SELECT o.is_seed FROM public.shop_orders o WHERE o.id = p_order), false))
  ON CONFLICT (order_id, user_id, reason) WHERE order_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_count := public.shop_active_strike_count(p_user);
    PERFORM public.declutter_notify(p_user, 'warning', 'Shops strike',
      format('You got a Shops strike (%s of 3). It ends in a year. At 3, Shops closes for you until one ends.', v_count)
        || ' If this is wrong, contact Louisiana Helpr support.',
      '/shops/orders');
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_give_strike(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_give_strike(uuid, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The shared steps (service only). Each expects the caller to hold the
--    order's row lock already.

-- Every refund amount for an order and a reason, from the two functions the
-- table CHECKs call (the quote and the write read this, never their own formula).
CREATE OR REPLACE FUNCTION public.shop_refund_amounts(p_order_id uuid, p_reason text)
RETURNS TABLE (fee_policy text, paid_cents integer, tax_cents integer, card_fee_cents integer,
               kept_cents integer, tax_kept_cents integer, refund_cents integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH o AS (
    SELECT so.total_cents, so.tax_cents,
           least(so.total_cents, COALESCE(so.card_fee_cents, public.declutter_card_fee_estimate(so.total_cents))) AS fee,
           public.shop_refund_fee_policy(p_reason) AS policy
      FROM public.shop_orders so WHERE so.id = p_order_id
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

-- Write the refund row by reason; the CHECKs hold the amounts. A shop-paid fee
-- becomes the shop's fee debt in the same transaction.
CREATE OR REPLACE FUNCTION public.shop_write_refund(p_order_id uuid, p_reason text, p_note text)
RETURNS public.shop_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  r public.shop_refunds;
  a record;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.captured_at IS NULL OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000';
  END IF;
  -- Never an app refund on top of a refund made by hand in Stripe (section 13).
  IF EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = o.id AND hr.failed_at IS NULL) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM public.shop_refund_amounts(o.id, p_reason);
  INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
                                   card_fee_cents, kept_cents, tax_kept_cents, refund_cents, note)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, a.fee_policy, a.paid_cents, a.tax_cents,
          a.card_fee_cents, a.kept_cents, a.tax_kept_cents, a.refund_cents, NULLIF(btrim(COALESCE(p_note, '')), ''))
  RETURNING * INTO r;
  IF a.fee_policy = 'full_shop_pays_fee' AND a.card_fee_cents > 0 AND o.seller_id IS NOT NULL THEN
    INSERT INTO public.declutter_seller_fee_debts (seller_id, shop_refund_id, amount_cents, remaining_cents)
    VALUES (o.seller_id, r.id, a.card_fee_cents, a.card_fee_cents)
    ON CONFLICT (shop_refund_id) DO NOTHING;
  END IF;
  -- The home-food sale did not happen: it leaves the yearly count (L8).
  DELETE FROM public.shop_cottage_sales WHERE source_ref = o.id;
  RETURN r;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_write_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_write_refund(uuid, text, text) TO service_role;

-- Stock back (items locked in id order, as shops_accept_order: no deadlock).
CREATE OR REPLACE FUNCTION public.shop_return_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM 1 FROM public.shop_items i JOIN public.shop_order_lines ol ON ol.item_id = i.id
   WHERE ol.order_id = p_order_id ORDER BY i.id FOR UPDATE OF i;
  UPDATE public.shop_items i SET stock_count = i.stock_count + ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = p_order_id AND ol.item_id = i.id AND i.stock_count IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_return_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_return_stock(uuid) TO service_role;

-- The shop is owed its items on a late cancel or a no-show (as at a handover:
-- the card-fee debt comes out first, one shop_payouts row, ever).
CREATE OR REPLACE FUNCTION public.shop_owe_shop(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, o.items_cents);
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, o.items_cents, v_debt, o.items_cents - v_debt,
          CASE WHEN o.items_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END, now())
  ON CONFLICT (order_id) DO NOTHING;
  RETURN o.items_cents - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owe_shop(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owe_shop(uuid) TO service_role;

-- The common gate: an accepted, charged order not handed over, no open problem
-- (unless an admin decides it). Returns the locked row.
CREATE OR REPLACE FUNCTION public.shop_lock_open_charged_order(p_order_id uuid, p_allow_problem boolean)
RETURNS public.shop_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status IN ('handed_over') THEN
    RAISE EXCEPTION 'order_final' USING ERRCODE = '55000', HINT = 'This order was picked up and is final.';
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is already closed.';
  END IF;
  IF o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The card is still being charged. Try again in a few minutes.';
  END IF;
  -- A refund made by hand in Stripe stands on this order (section 13): nobody refunds or
  -- pays from it automatically; an admin decides through the held-for-review tools.
  IF EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = o.id AND hr.failed_at IS NULL) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
      HINT = 'This order was refunded in Stripe. Louisiana Helpr decides it.';
  END IF;
  IF NOT COALESCE(p_allow_problem, false)
     AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides it.';
  END IF;
  RETURN o;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The buyer cancels an accepted order (O2). AS THE BUYER.
--    p_expect: 'free' or 'late', what the buyer's screen showed. If the window
--    moved between the screen and the tap, nothing happens ('cancel_terms_changed')
--    and the screen asks again, so nobody loses money to a stale screen.
CREATE OR REPLACE FUNCTION public.shops_buyer_cancel_order(p_order_id uuid, p_expect text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  r public.shop_refunds;
  v_owed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_expect IS NULL OR p_expect NOT IN ('free', 'late') THEN
    RAISE EXCEPTION 'invalid_expect' USING ERRCODE = '22023';
  END IF;
  -- 1. The row lock FIRST (the ready tap and the clock take the same lock).
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  -- 2. ONE reading of the window, under the lock.
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  IF (p_expect = 'free') IS DISTINCT FROM v_free THEN
    RAISE EXCEPTION 'cancel_terms_changed' USING ERRCODE = '55000',
      HINT = 'The free-cancel time for this order has changed. Look again before cancelling.';
  END IF;
  -- 3. Recorded on the order before commit; Stripe runs after it.
  IF v_free THEN
    UPDATE public.shop_orders SET status = 'refunded', close_reason = 'buyer_cancelled_free', closed_at = now()
     WHERE id = o.id AND status = 'accepted';
    r := public.shop_write_refund(o.id, 'buyer_cancelled', NULL);
    PERFORM public.shop_return_stock(o.id);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
      format('The buyer cancelled the order for %s inside your free-cancel time. Do not make it.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled',
      format('$%s is on its way back to your card, less the card-processing cost%s. Card refunds usually show up in 5 to 10 business days.',
             to_char(r.refund_cents / 100.0, 'FM999999990.00'),
             CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancelled_free', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Order cancelled late',
    format('The buyer cancelled the order for %s after your free-cancel time, so you are paid for it ($%s).',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order cancelled',
    'You cancelled after the shop''s free-cancel time, so nothing is refunded and the shop is paid.',
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled_late', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_buyer_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_buyer_cancel_order(uuid, text) TO authenticated, service_role;

-- What the buyer's screen shows before the tap (read only; no lock: the tap
-- decides again under the lock). AS THE BUYER.
CREATE OR REPLACE FUNCTION public.shops_order_cancel_quote(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL
     OR EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RETURN jsonb_build_object('can_cancel', false);
  END IF;
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  -- The free cancel's figures are exactly what shop_write_refund will write.
  SELECT * INTO a FROM public.shop_refund_amounts(o.id, 'buyer_cancelled');
  RETURN jsonb_build_object('can_cancel', true, 'free', v_free,
    'free_until', CASE WHEN v_until IS NULL OR NOT isfinite(v_until) THEN NULL ELSE v_until END,
    'paid_cents', o.total_cents,
    'refund_cents', CASE WHEN v_free THEN a.refund_cents ELSE 0 END,
    'kept_cents', CASE WHEN v_free THEN a.kept_cents + a.tax_kept_cents ELSE o.total_cents END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_cancel_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_cancel_quote(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The shop cancels an accepted order (L42). AS THE SHOP. Full refund, the
--    card fee billed to the shop, a shop strike.
CREATE OR REPLACE FUNCTION public.shops_shop_cancel_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
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
  o := public.shop_lock_open_charged_order(o.id, false);
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'shop_cancelled', decline_reason = v_reason, closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, 'shop_cancelled', v_reason);
  PERFORM public.shop_return_stock(o.id);
  PERFORM public.shop_give_strike(o.seller_id, 'shop', 'shop_cancelled', o.id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled by the shop',
    format('The shop cancelled your order for %s. All $%s is on its way back to your card; card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'))
      || CASE WHEN v_reason IS NOT NULL THEN ' Their note: ' || v_reason ELSE '' END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
    format('You cancelled an accepted order. The buyer gets everything back, the $%s card fee comes out of your next payout, and it counts as a Shops strike.',
           to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_cancel_order(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The buyer did not come (O3). AS THE SHOP. Only an in-person order the shop
--    marked ready, only once its ready date has ended (Louisiana time), only
--    before the automatic finish. = a late cancel + a buyer strike.
CREATE OR REPLACE FUNCTION public.shops_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_owed integer;
BEGIN
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
  o := public.shop_lock_open_charged_order(o.id, false);
  IF o.handover_mode <> 'in_person' THEN
    RAISE EXCEPTION 'not_in_person' USING ERRCODE = '55000',
      HINT = 'A left-out order cannot be a no-show; it finishes on its own after the ready date.';
  END IF;
  -- Only an order the shop marked ready (/code-review of shops-m3-v1 #2): a shop
  -- that never said "it's ready" cannot say the buyer failed to come for it.
  IF NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_ready' USING ERRCODE = '55000',
      HINT = 'Mark the order ready first. A no-show can only be reported for an order you had ready.';
  END IF;
  IF now() < ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') THEN
    RAISE EXCEPTION 'too_early_for_no_show' USING ERRCODE = '55000',
      HINT = 'You can report a no-show once the ready date is over.';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.shop_give_strike(o.buyer_id, 'buyer', 'buyer_no_show', o.id);
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Missed pickup',
    format('The shop says you did not pick up your order for %s. A missed pickup counts as a late cancel: nothing is refunded and the shop is paid. If you did pick it up, contact Louisiana Helpr support.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'No-show recorded',
    format('You are paid for the order ($%s).', to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'no_show', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_no_show(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The clock (declutter-money, every 10 minutes): a left-out order whose shop
--    never posted the ready photo, 3 days after its ready date ended, is
--    refunded as the shop's fault (Q2155 a). Every admin is told.
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
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order refunded by the clock',
          'A left-out Shops order had no ready photo 3 days after its date, so the buyer was refunded and the shop got a strike.', '/admin');
      END LOOP;
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

-- ---------------------------------------------------------------------------
-- 9. Sending refunds (service only): the queue and the report back.
CREATE OR REPLACE FUNCTION public.shop_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, refund_cents integer,
               livemode boolean, checkout_session_id text, attempts integer, reversals integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.id, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, o.payment_livemode,
         o.stripe_checkout_session_id, r.attempts, r.reversals
    FROM public.shop_refunds r
    JOIN public.shop_orders o ON o.id = r.order_id
   WHERE r.status IN ('pending', 'failed') AND r.next_attempt_at <= now() AND r.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = r.order_id AND hr.failed_at IS NULL)
     -- The tap sends its own refund; the sweep only picks up one it did not finish.
     AND r.created_at <= now() - interval '2 minutes'
   ORDER BY r.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refunds_due(integer) TO service_role;

-- One refund row as the edge sees it (the tap's own send, right after commit).
CREATE OR REPLACE FUNCTION public.shop_refund_to_send(p_refund_id uuid)
RETURNS TABLE (refund_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text, refund_cents integer,
               livemode boolean, checkout_session_id text, attempts integer, reversals integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.id, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, o.payment_livemode,
         o.stripe_checkout_session_id, r.attempts, r.reversals
    FROM public.shop_refunds r
    JOIN public.shop_orders o ON o.id = r.order_id
   WHERE r.id = p_refund_id AND r.status IN ('pending', 'failed')
     AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = r.order_id AND hr.failed_at IS NULL);
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_to_send(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_to_send(uuid) TO service_role;

-- What Stripe did: a succeeded row is final; a failure counts and backs off
-- (10 min doubling, at most a day; 12 tries, then the edge pages ops).
CREATE OR REPLACE FUNCTION public.shop_refund_executed(p_refund_id uuid, p_stripe_refund_id text, p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded AND (p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_') THEN
    RAISE EXCEPTION 'invalid_refund' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_id = CASE WHEN p_succeeded THEN p_stripe_refund_id ELSE stripe_refund_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_refund_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.shop_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_executed(uuid, text, boolean, text) TO service_role;

-- A refund Stripe took and later FAILED or was canceled (charge.refund.updated):
-- the money never left, so the row is reopened (failed, due now) and
-- declutter-money sends a new refund. Only the refund the row recorded can
-- reopen it. Returns whether it did. (/code-review of shops-m3-v1 #4) The
-- reopened row starts a FRESH run of tries (attempts back to 0, reversals + 1,
-- so its keys are new: shop-refund-<id>-v<reversals>[-r<n>]): adding a try
-- instead pushed a row on its 12th try past the queue's limit, so it was never
-- re-sent and the give-up page (sent on a failed 12th try) never came.
CREATE OR REPLACE FUNCTION public.shop_refund_reversed(p_refund_id uuid, p_stripe_refund_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.shop_refunds
     SET status = 'failed', stripe_refund_id = NULL, next_attempt_at = now(),
         attempts = 0, reversals = least(reversals + 1, 100),
         last_error = left('Stripe reversed refund ' || COALESCE(p_stripe_refund_id, '?'), 500)
   WHERE id = p_refund_id AND status = 'succeeded' AND stripe_refund_id = p_stripe_refund_id;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_reversed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_reversed(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. The shop is paid on a late cancel or a no-show too (shop_payouts_due,
--     newest body 20261018211820, with that one status widened).
CREATE OR REPLACE FUNCTION public.shop_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, livemode boolean, checkout_session_id text, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, o.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id,
         o.payment_livemode, o.stripe_checkout_session_id, p.attempts
    FROM public.shop_payouts p
    JOIN public.shop_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = o.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND (o.status = 'handed_over'
          OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = p.order_id AND h.problem_at IS NOT NULL
                       AND h.confirmed_how IS DISTINCT FROM 'admin')
     -- A charge refunded by hand in Stripe never pays the shop from here (section 13).
     AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = p.order_id AND hr.failed_at IS NULL)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payouts_due(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. M4 admin tools. Each checks has_role(admin) itself, writes admin_audit_log,
--     and needs no switch (an admin can unwind money with Shops off).

-- Decide a problem by paying the shop (L43: the buyer did get it).
CREATE OR REPLACE FUNCTION public.shops_admin_pay_shop(p_order_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_note text := btrim(COALESCE(p_note, ''));
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  o := public.shop_lock_open_charged_order(p_order_id, true);
  v_out := public.shop_complete_handover(o.id, 'admin');
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_pay_shop', 'shop_order', o.id::text, jsonb_build_object('note', v_note));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_pay_shop(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_pay_shop(uuid, text) TO authenticated, service_role;

-- Refund by reason (L43, L75). problem_shop_fault also gives the shop a strike.
CREATE OR REPLACE FUNCTION public.shops_admin_refund_order(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_note text := btrim(COALESCE(p_note, ''));
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'shop_removed') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  o := public.shop_lock_open_charged_order(p_order_id, true);
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'admin_refunded', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, p_reason, v_note);
  IF p_reason = 'problem_shop_fault' THEN
    PERFORM public.shop_give_strike(o.seller_id, 'shop', 'problem_shop_fault', o.id);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_refund_order', 'shop_order', o.id::text,
          jsonb_build_object('reason', p_reason, 'note', v_note, 'refund_cents', r.refund_cents, 'refund_id', r.id));
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
    format('Louisiana Helpr refunded your order for %s: $%s is on its way back to your card%s. Card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'),
           CASE WHEN r.kept_cents > 0 THEN ', less the card-processing cost' || CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END ELSE '' END),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
    format('Louisiana Helpr refunded the order for %s to the buyer, so it is not paid out.', to_char(o.ready_date, 'FMMonth FMDD'))
      || CASE WHEN r.fee_policy = 'full_shop_pays_fee'
              THEN format(' The $%s card fee comes out of your next payout.', to_char(r.card_fee_cents / 100.0, 'FM999990.00')) ELSE '' END
      || CASE WHEN p_reason = 'problem_shop_fault' THEN ' It counts as a Shops strike.' ELSE '' END,
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'refunded', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_refund_order(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_refund_order(uuid, text, text) TO authenticated, service_role;

-- Strike management: remove one (with a note), or give one for an order.
CREATE OR REPLACE FUNCTION public.shops_admin_remove_strike(p_strike_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  s public.shop_strikes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  UPDATE public.shop_strikes SET removed_at = now(), removed_by = v_uid, removed_note = v_note
   WHERE id = p_strike_id AND removed_at IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'strike_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_remove_strike', 'shop_strike', s.id::text, jsonb_build_object('user_id', s.user_id, 'note', v_note));
  PERFORM public.declutter_notify(s.user_id, 'info', 'Shops strike removed',
    'Louisiana Helpr removed one of your Shops strikes.', '/shops/orders');
  RETURN jsonb_build_object('result', 'removed', 'strike_id', s.id, 'active', public.shop_active_strike_count(s.user_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_remove_strike(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_remove_strike(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_give_strike(p_order_id uuid, p_side text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  o public.shop_orders;
  v_user uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('buyer', 'shop') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_user := CASE WHEN p_side = 'buyer' THEN o.buyer_id ELSE o.seller_id END;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'member_gone' USING ERRCODE = '55000';
  END IF;
  v_id := public.shop_give_strike(v_user, p_side, 'admin_strike', o.id);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'strike_exists' USING ERRCODE = '23505', HINT = 'That side already has an admin strike for this order.';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_give_strike', 'shop_strike', v_id::text,
          jsonb_build_object('order_id', o.id, 'side', p_side, 'user_id', v_user, 'note', v_note));
  RETURN jsonb_build_object('result', 'given', 'strike_id', v_id, 'active', public.shop_active_strike_count(v_user));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_give_strike(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_give_strike(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Louisiana marketplace-facilitator threshold (lead 2026-10-19; R.S. 47:340.1(C)(2)-(3),
--     tax memo ~/.lh-wt/handoffs-1017/tax-research-memo.md Q1): registration is due
--     within 30 days once facilitated retail sales delivered into Louisiana pass
--     $100,000 in a calendar year. We count, per calendar year in Louisiana time,
--     the ITEM totals (never our fee, never the tax) of COMPLETED facilitated sales:
--       Shops    handed over (handed_over_at), or a late cancel / no-show the shop is
--                paid for (closed_at): the buyer paid and the sale stands;
--       Declutter handed over (handed_over_at).
--     Refunded, expired and open orders never count; test (is_seed) orders never
--     count. Every Shops pickup and every Declutter handover is in Louisiana.
--     At $80,000 (the early warning) every admin is told in-app ONCE per year
--     (facilitator_threshold_alerts, one row per year) and declutter-money posts
--     the ops alert, then marks it sent.
CREATE TABLE IF NOT EXISTS public.facilitator_threshold_alerts (
  year integer PRIMARY KEY CHECK (year BETWEEN 2026 AND 2200),
  threshold_cents bigint NOT NULL CHECK (threshold_cents > 0),
  total_cents_at_alert bigint NOT NULL CHECK (total_cents_at_alert >= 0),
  crossed_at timestamptz NOT NULL DEFAULT now(),
  ops_alert_sent_at timestamptz
);
ALTER TABLE public.facilitator_threshold_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.facilitator_threshold_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.facilitator_threshold_alerts TO service_role;
COMMENT ON TABLE public.facilitator_threshold_alerts IS
  'One row per calendar year once facilitated Louisiana retail sales (Shops + Declutter items) passed the $80,000 early warning (R.S. 47:340.1 duty at $100,000).';

CREATE OR REPLACE FUNCTION public.facilitated_la_sales_cents(p_year integer)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH bounds AS (
    SELECT (make_date(p_year, 1, 1)::timestamp AT TIME ZONE 'America/Chicago') AS t0,
           (make_date(p_year + 1, 1, 1)::timestamp AT TIME ZONE 'America/Chicago') AS t1
  )
  SELECT COALESCE((SELECT sum(o.items_cents) FROM public.shop_orders o, bounds b
                    WHERE NOT o.is_seed
                      AND ((o.status = 'handed_over' AND o.handed_over_at >= b.t0 AND o.handed_over_at < b.t1)
                        OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')
                            AND o.closed_at >= b.t0 AND o.closed_at < b.t1))), 0)::bigint
       + COALESCE((SELECT sum(d.items_cents) FROM public.declutter_orders d, bounds b
                    WHERE NOT d.is_seed AND d.status = 'handed_over'
                      AND d.handed_over_at >= b.t0 AND d.handed_over_at < b.t1), 0)::bigint;
$fn$;
REVOKE ALL ON FUNCTION public.facilitated_la_sales_cents(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facilitated_la_sales_cents(integer) TO service_role;

-- The money step's check (every 10 minutes). Crossing writes the year's row and
-- tells every admin once; 'ops_alert_due' stays true until the edge posted the
-- ops alert (facilitator_alert_sent), so a failed post is retried, never lost.
CREATE OR REPLACE FUNCTION public.facilitator_threshold_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_year integer := extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer;
  v_total bigint := public.facilitated_la_sales_cents(v_year);
  v_warn bigint := 8000000;
  v_new boolean := false;
  a record;
  r public.facilitator_threshold_alerts;
BEGIN
  IF v_total >= v_warn THEN
    INSERT INTO public.facilitator_threshold_alerts (year, threshold_cents, total_cents_at_alert)
    VALUES (v_year, v_warn, v_total)
    ON CONFLICT (year) DO NOTHING
    RETURNING * INTO r;
    v_new := r.year IS NOT NULL;
    IF v_new THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Louisiana sales tax registration coming',
          format('Shops + Declutter sales delivered into Louisiana passed $%s this year. Registering as a marketplace facilitator is required within 30 days of passing $100,000 (R.S. 47:340.1).',
                 to_char(v_total / 100.0, 'FM999,999,990.00')), '/admin');
      END LOOP;
    END IF;
  END IF;
  SELECT * INTO r FROM public.facilitator_threshold_alerts WHERE year = v_year;
  RETURN jsonb_build_object('year', v_year, 'total_cents', v_total, 'warn_cents', v_warn, 'duty_cents', 10000000,
    'crossed_now', v_new, 'ops_alert_due', r.year IS NOT NULL AND r.ops_alert_sent_at IS NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.facilitator_threshold_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facilitator_threshold_check() TO service_role;

CREATE OR REPLACE FUNCTION public.facilitator_alert_sent(p_year integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  UPDATE public.facilitator_threshold_alerts SET ops_alert_sent_at = now()
   WHERE year = p_year AND ops_alert_sent_at IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.facilitator_alert_sent(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facilitator_alert_sent(integer) TO service_role;

-- The Shops orders queue: open problems, refunds not yet sent, payouts stuck
-- or held, recent strikes. Admin only; one read.
CREATE OR REPLACE FUNCTION public.shops_admin_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'problems', (SELECT COALESCE(jsonb_agg(x ORDER BY x.problem_at), '[]'::jsonb) FROM (
      SELECT o.id AS order_id, o.buyer_id, o.seller_id, o.shop_id, s.name AS shop_name, o.ready_date, o.items_cents,
             o.total_cents, o.card_fee_cents, o.tax_cents, o.handover_mode, h.problem_at, h.problem_note,
             h.ready_photo_path, h.ready_at, o.is_seed
        FROM public.shop_orders o
        JOIN public.shop_handovers h ON h.order_id = o.id
        LEFT JOIN public.shops s ON s.id = o.shop_id
       WHERE o.status = 'accepted' AND h.problem_at IS NOT NULL) x),
    'refunds', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) FROM (
      SELECT r.id AS refund_id, r.order_id, r.reason, r.fee_policy, r.refund_cents, r.status, r.attempts, r.last_error,
             r.created_at, r.next_attempt_at, o.is_seed
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id
       WHERE r.status <> 'succeeded') x),
    'payouts', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) FROM (
      SELECT p.id AS payout_id, p.order_id, o.seller_id, s.name AS shop_name, p.amount_cents, p.status, p.attempts,
             p.last_error, p.review_reason, p.created_at, (ph.helper_id IS NOT NULL) AS on_hold, ph.reason AS hold_reason, o.is_seed
        FROM public.shop_payouts p
        JOIN public.shop_orders o ON o.id = p.order_id
        LEFT JOIN public.shops s ON s.id = o.shop_id
        LEFT JOIN public.payout_holds ph ON ph.helper_id = o.seller_id
       -- held_for_review too (/code-review of shops-m3-v1 #6): a payout no cron will send is exactly one an admin must see.
       WHERE p.status IN ('pending', 'failed', 'held_for_review')) x),
    'facilitator', jsonb_build_object(
      'year', extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer,
      'ytd_cents', public.facilitated_la_sales_cents(extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::integer),
      'warn_cents', 8000000, 'duty_cents', 10000000),
    'strikes', (SELECT COALESCE(jsonb_agg(x ORDER BY x.given_at DESC), '[]'::jsonb) FROM (
      SELECT k.id AS strike_id, k.user_id, k.offender_side, k.reason, k.order_id, k.given_at, k.expires_at,
             public.shop_active_strike_count(k.user_id) AS active_count, k.is_seed
        FROM public.shop_strikes k
       WHERE k.removed_at IS NULL AND k.expires_at > now()
       ORDER BY k.given_at DESC LIMIT 200) x));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_queue() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 13. Refunds made BY HAND in the Stripe Dashboard on a Shops charge
--     (/code-review of shops-m3-v1 #1). The app made no refund, so nothing in
--     shop_refunds knows it, yet the buyer has the money back: the shop must never
--     be paid for that order by a clock. Each such Stripe refund is recorded once
--     (shop_hand_refunds, keyed on its re_ id) by the webhook (charge.refunded,
--     automatically) or by an admin ("Record a refund made in Stripe", admin Shops
--     orders, checked against Stripe by shop-checkout first; no new Stripe refund is
--     made). Only against THIS order's PaymentIntent. Recording it (rule A of the v2
--     review: ANY live hand refund holds the WHOLE order):
--       - every unsent app refund row and shop payout of the order -> held_for_review
--         (never sent on top; an admin settles or releases it), and every refund path
--         (the lock, shop_write_refund) refuses the order: refunded_in_stripe;
--       - an order with no app refund closes: 'refunded' (the whole payment back) or
--         'partially_refunded', close_reason 'refunded_by_hand'; an accepted order's
--         stock comes back; the handover clock only reads 'accepted';
--       - a hand refund Stripe fails later reopens NOTHING: the order stays held;
--       - every new one is answered so the caller pages ops (a payout already sent,
--         an app refund already sent, a refund id recorded on another payment).
-- (The table shop_hand_refunds is created in section 2b: shop_payouts_due reads it.)

-- Holds the WHOLE order (/code-review of shops-m3 v2, rule A): every unsent app refund
-- row and every unsent shop payout of the order goes to held_for_review, so no cron sends
-- money on top of a refund made by hand; an admin settles or releases each one.
CREATE OR REPLACE FUNCTION public.shop_hold_order_for_hand_refund(p_order_id uuid, p_why text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.shop_refunds SET status = 'held_for_review', review_held_at = now(), review_reason = left(p_why, 300)
   WHERE order_id = p_order_id AND status IN ('pending', 'failed');
  UPDATE public.shop_payouts SET status = 'held_for_review', review_held_at = now(), review_reason = left(p_why, 300)
   WHERE order_id = p_order_id AND status IN ('pending', 'failed');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_hold_order_for_hand_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_hold_order_for_hand_refund(uuid, text) TO service_role;

-- Service only (the webhook; the admin path). Accepted only against THIS order's
-- PaymentIntent (the order is found by it). Every newly recorded refund holds the whole
-- order (rule A). Answers what happened (the caller pages ops for each new one):
--   'already'                       this re_ id is recorded on this same payment
--   'recorded_other_order'          this re_ id is recorded on a DIFFERENT payment: nothing changed
--   'not_shops'                     no Shops order has this payment
--   'recorded_refund_held'          the order's app refund was not sent yet: it is held, never sent on top
--   'recorded_row_already_settled'  the app refund was ALREADY sent: the buyer may have two refunds
--   'closed_refunded' / 'closed_partially_refunded'  the order closed, the shop not paid
--   'recorded_after_payout'         the shop's payout had already gone out: recover it by hand
--   'recorded_not_charged'          the order was never recorded as captured: held, a person checks
CREATE OR REPLACE FUNCTION public.shop_record_hand_refund(p_payment_intent_id text, p_stripe_refund_id text,
  p_amount_cents integer, p_livemode boolean, p_how text, p_admin uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  r public.shop_refunds;
  p public.shop_payouts;
  v_prior public.shop_hand_refunds;
  v_covered bigint;
  v_outcome text;
  v_full boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_'
     OR p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$'
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_how IS NULL OR p_how NOT IN ('webhook', 'admin') THEN
    RAISE EXCEPTION 'invalid_hand_refund' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_prior FROM public.shop_hand_refunds h WHERE h.stripe_refund_id = p_stripe_refund_id;
  IF FOUND THEN
    RETURN CASE WHEN v_prior.stripe_payment_intent_id = p_payment_intent_id THEN 'already' ELSE 'recorded_other_order' END;
  END IF;
  -- The order row lock first (every Shops money path takes it).
  SELECT * INTO o FROM public.shop_orders WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_shops';
  END IF;
  SELECT * INTO r FROM public.shop_refunds WHERE order_id = o.id FOR UPDATE;
  IF r.id IS NOT NULL AND r.stripe_refund_id = p_stripe_refund_id THEN
    RETURN 'already';
  END IF;
  v_covered := p_amount_cents + COALESCE((SELECT sum(h.amount_cents) FROM public.shop_hand_refunds h
                                           WHERE h.order_id = o.id AND h.failed_at IS NULL), 0);
  v_full := v_covered >= o.total_cents;
  IF o.captured_at IS NULL THEN
    v_outcome := 'recorded_not_charged';
  ELSIF r.id IS NOT NULL THEN
    v_outcome := CASE WHEN r.status = 'succeeded' THEN 'recorded_row_already_settled' ELSE 'recorded_refund_held' END;
  ELSE
    SELECT * INTO p FROM public.shop_payouts WHERE order_id = o.id FOR UPDATE;
    v_outcome := CASE WHEN p.id IS NOT NULL AND p.status IN ('succeeded', 'settled_by_hand') THEN 'recorded_after_payout'
                      WHEN v_full THEN 'closed_refunded' ELSE 'closed_partially_refunded' END;
  END IF;
  INSERT INTO public.shop_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, shop_refund_id, amount_cents,
                                        livemode, recorded_how, recorded_by, outcome, note)
  VALUES (p_stripe_refund_id, p_payment_intent_id, o.id, r.id, p_amount_cents, p_livemode, p_how, p_admin, v_outcome,
          NULLIF(btrim(COALESCE(p_note, '')), ''));
  -- Rule A: the whole order is held (its unsent app refund and its unsent payout).
  PERFORM public.shop_hold_order_for_hand_refund(o.id,
    format('refunded_by_hand: %s ($%s) was refunded in Stripe; decide this row by hand',
           p_stripe_refund_id, to_char(p_amount_cents / 100.0, 'FM999999990.00')));
  IF r.id IS NOT NULL OR v_outcome = 'recorded_not_charged' THEN
    RETURN v_outcome;
  END IF;
  -- No app refund: the order closes (whatever it was), and the shop is not paid by any clock.
  IF o.status = 'accepted' THEN
    PERFORM public.shop_return_stock(o.id);
    DELETE FROM public.shop_cottage_sales WHERE source_ref = o.id;
  END IF;
  IF o.status IN ('accepted', 'handed_over', 'cancelled', 'partially_refunded') THEN
    UPDATE public.shop_orders
       SET status = CASE WHEN v_full THEN 'refunded' ELSE 'partially_refunded' END,
           close_reason = 'refunded_by_hand', closed_at = COALESCE(closed_at, now())
     WHERE id = o.id;
  END IF;
  IF v_outcome <> 'recorded_after_payout' THEN
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
      format('Louisiana Helpr refunded the order for %s to the buyer, so it is not paid out for now. Louisiana Helpr will tell you what happens next.',
             to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN v_outcome;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_record_hand_refund(text, text, integer, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_record_hand_refund(text, text, integer, boolean, text, uuid, text) TO service_role;

-- "Record a refund made in Stripe" (admin Shops orders). SERVICE ONLY (rule B of the
-- v2 review): shop-checkout's admin_record_hand_refund checks the caller is an admin,
-- RETRIEVES the re_ from Stripe and checks it is a live refund on this order's payment
-- for exactly this amount, then calls this with the admin's id. Records the re_ id and
-- amount against the order; makes NO Stripe refund.
CREATE OR REPLACE FUNCTION public.shops_admin_record_hand_refund(p_admin uuid, p_order_id uuid, p_stripe_refund_id text,
  p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := p_admin;
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_stripe_refund_id, ''));
  o public.shop_orders;
  v_out text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF v_ref !~ '^(re|pyr)_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Paste the Stripe refund id (re_...).';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > o.total_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount refunded, at most what the buyer paid.';
  END IF;
  -- A re_ id another money row already holds is not this order's hand refund.
  IF NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds h WHERE h.stripe_refund_id = v_ref AND h.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.shop_refunds r WHERE r.stripe_refund_id = v_ref AND r.order_id = o.id)
     AND public.money_ref_in_use(v_ref) THEN
    RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
      HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
  END IF;
  v_out := public.shop_record_hand_refund(o.stripe_payment_intent_id, v_ref, p_amount_cents, o.payment_livemode, 'admin', v_uid, v_note);
  IF v_out <> 'already' THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (v_uid, 'shops_admin_record_hand_refund', 'shop_order', o.id::text,
            jsonb_build_object('stripe_refund_id', v_ref, 'amount_cents', p_amount_cents, 'note', v_note, 'outcome', v_out));
  END IF;
  RETURN jsonb_build_object('result', v_out, 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_record_hand_refund(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_admin_record_hand_refund(uuid, uuid, text, integer, text) TO service_role;

-- charge.refund.updated: a hand refund Stripe later failed / canceled moved no
-- money. It is marked failed, the order STAYS held (nothing reopens or sends on its
-- own: rule A of the v2 review), and the caller pages ops: the buyer is NOT repaid
-- and a person decides. 'not_shops' when no hand refund has this id; 'already'
-- when it was marked before.
CREATE OR REPLACE FUNCTION public.shop_hand_refund_failed(p_stripe_refund_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  h public.shop_hand_refunds;
BEGIN
  SELECT * INTO h FROM public.shop_hand_refunds WHERE stripe_refund_id = p_stripe_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_shops';
  END IF;
  IF h.failed_at IS NOT NULL THEN
    RETURN 'already';
  END IF;
  UPDATE public.shop_hand_refunds SET failed_at = now() WHERE stripe_refund_id = p_stripe_refund_id;
  -- Never reopened automatically (rule A): the order stays held; a person decides.
  PERFORM public.shop_hold_order_for_hand_refund(h.order_id,
    left('refund made in Stripe ' || p_stripe_refund_id || ' FAILED; the buyer is not repaid: decide by hand', 300));
  RETURN 'marked_failed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_hand_refund_failed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_hand_refund_failed(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 14. The payout-readiness held-for-review admin tools (20261019070737) know a held
--     Shops refund (kind 'shop_refund'): restated from there (newest bodies) with that
--     one kind added, and two Shops rules:
--       - list: admin_payouts_held_for_review shows it (the buyer, the refund owed, the
--         PaymentIntent); payout_held_check pages ops daily (the buyer is not told: a refund
--         was already made to them in Stripe).
--       - release (always with the confirmation): refused for a shop payout or Shops refund
--         while a refund made in Stripe stands on the order (refunded_in_stripe), or for a
--         shop payout on an order the shop is not paid for automatically (order_not_payable):
--         the queues would never send it, so it would sit 'pending' forever. It stays held
--         and the admin settles it by hand.
--       - settle by hand: the global Stripe-id check (money_ref_in_use) as for every kind; a
--         re_ the Shops hand-refund ledger recorded on THIS row's payment is adopted (it must
--         cover the whole refund: hand_refund_short), any other re_ goes into that ledger;
--         only for the WHOLE refund the row owes (settle_amount_differs; CHECK
--         shop_refunds_settled_in_full), like the table's own amounts.
--     Every Shops path takes the order row lock before the payout / refund row.
DO $do$
BEGIN
  ALTER TABLE public.payout_settlements DROP CONSTRAINT IF EXISTS payout_settlements_row_kind_check;
  ALTER TABLE public.payout_settlements ADD CONSTRAINT payout_settlements_row_kind_check
    CHECK (row_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund', 'shop_refund'));
END
$do$;

CREATE OR REPLACE FUNCTION public.admin_payouts_held_for_review()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(held.h || jsonb_build_object(
      'payee_account', (SELECT pr.stripe_account_id FROM public.profiles pr WHERE pr.user_id = (held.h ->> 'payee_id')::uuid),
      'sibling_refs', (SELECT COALESCE(jsonb_agg(to_jsonb(sb) ORDER BY sb.ref), '[]'::jsonb) FROM (
          SELECT 'declutter' AS kind, x.id, x.stripe_transfer_id AS ref, x.amount_cents FROM public.declutter_payouts x
           WHERE x.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'helpr_task', x.id, x.stripe_transfer_id, x.amount_cents FROM public.helpr_task_payouts x
           WHERE x.helpr_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'shop', x.id, x.stripe_transfer_id, x.amount_cents FROM public.shop_payouts x JOIN public.shop_orders so ON so.id = x.order_id
           WHERE so.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          LIMIT 20) sb))
    ORDER BY held.h ->> 'held_at'), '[]'::jsonb) FROM (
    SELECT to_jsonb(x) AS h FROM (
      SELECT 'declutter' AS kind, p.id, p.seller_id AS payee_id, p.amount_cents, p.review_reason AS reason, p.review_held_at AS held_at,
             'declutter_order_' || p.order_id::text AS stripe_group
        FROM public.declutter_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- The REAL transfer group a Helpr's delivery payout is sent in: its Declutter order's.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.review_held_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text END
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.review_held_at, 'shop_order_' || p.order_id::text
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id
        FROM public.declutter_refunds r LEFT JOIN public.declutter_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.review_held_at, d.stripe_payment_intent_id
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Shops (this migration): an app refund held because a refund made in Stripe stands on its order.
      SELECT 'shop_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
    ) x) held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payouts_held_for_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payouts_held_for_review() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_payout_release(p_kind text, p_id uuid, p_note text, p_confirm_no_transfer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_status text;
  v_order uuid;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF p_confirm_no_transfer IS NOT TRUE THEN
    RAISE EXCEPTION 'confirm_no_transfer_required' USING ERRCODE = '22023',
      HINT = 'Confirm you checked Stripe and no transfer or refund was made for this row outside the app.';
  END IF;
  -- Shops: the order row lock first (every Shops money path takes it, shop_record_hand_refund too).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status INTO v_status FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops: a release the queue would never send is refused, so nothing sits 'pending' forever.
  -- While a refund made in Stripe stands on the order (shop_refunds_due / shop_refund_to_send /
  -- shop_payouts_due all skip it), or the order was closed by one, the row STAYS held: the admin
  -- decides it by hand (settle). Once that Stripe refund failed, the held app refund may go back.
  IF p_kind IN ('shop', 'shop_refund') THEN
    IF EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = v_order AND hr.failed_at IS NULL)
       OR (p_kind = 'shop' AND o.close_reason = 'refunded_by_hand') THEN
      RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
        HINT = 'A refund made in Stripe stands on this order, so this stays held. Settle it by hand once you have decided.';
    END IF;
    IF p_kind = 'shop' AND NOT (
         (o.status = 'handed_over' OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
         AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = v_order AND h.problem_at IS NOT NULL
                           AND h.confirmed_how IS DISTINCT FROM 'admin')) THEN
      RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '55000',
        HINT = 'This order is not one the shop is paid for automatically (open problem, or not handed over). Settle it by hand.';
    END IF;
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop_refund' THEN
    UPDATE public.shop_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_release', p_kind, p_id::text, jsonb_build_object('note', v_note, 'confirmed_no_transfer', true));
  RETURN jsonb_build_object('result', 'released', 'kind', p_kind, 'id', p_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_payout_settle_by_hand(p_kind text, p_id uuid, p_ref text, p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_stripe text;
  v_other text;
  v_status text;
  v_pi text;
  v_adopted boolean := false;
  v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop');
  v_succeeded boolean;
  v_order uuid;
  o public.shop_orders;
  sr public.shop_refunds;
  v_hand public.shop_hand_refunds;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount it was settled for.';
  END IF;
  IF v_ref ~* '^other:' THEN
    v_other := left(btrim(regexp_replace(v_ref, '^other:', '', 'i')), 300);
    IF char_length(v_other) < 3 THEN
      RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Say how it was paid outside Stripe, after "other:".';
    END IF;
  ELSIF (v_payout AND v_ref ~ '^(tr|po)_[A-Za-z0-9]+$') OR (NOT v_payout AND v_ref ~ '^(re|pyr)_[A-Za-z0-9]+$') THEN
    v_stripe := v_ref;
  ELSE
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023',
      HINT = 'A Stripe transfer / payout id (tr_..., po_...) for a payout, a refund id (re_...) for a refund, or "other: how it was paid".';
  END IF;
  -- Shops: the order row lock first (every Shops money path takes it, shop_record_hand_refund too).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT * INTO sr FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
    v_status := sr.status;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- A Shops refund is settled only for the WHOLE refund it owes (never part of it: the rest would
  -- be lost track of); the table CHECK shop_refunds_settled_in_full says the same.
  IF p_kind = 'shop_refund' AND p_amount_cents <> sr.refund_cents THEN
    RAISE EXCEPTION 'settle_amount_differs' USING ERRCODE = '22023',
      HINT = format('A Shops refund is settled only for its whole amount, $%s.', to_char(sr.refund_cents / 100.0, 'FM999999990.00'));
  END IF;
  IF v_stripe IS NOT NULL THEN
    -- A Dashboard refund the hand-refund ledger recorded with no row, on THIS row's payment, is
    -- the refund that settled it: adopted (linked), not refused.
    IF p_kind = 'declutter_refund' THEN
      SELECT r.stripe_payment_intent_id INTO v_pi FROM public.declutter_refunds r WHERE r.id = p_id;
      UPDATE public.declutter_hand_refunds SET refund_row_id = p_id, hand_outcome = 'settled'
       WHERE stripe_refund_id = v_stripe AND stripe_payment_intent_id = v_pi AND refund_row_id IS NULL AND failed_at IS NULL;
      v_adopted := FOUND;
    END IF;
    -- Shops: a live refund made in Stripe that the hand-refund ledger recorded on THIS row's payment
    -- is adopted, if it covers the whole refund this row owes (a payment has at most one Shops
    -- refund row: shop_refunds.stripe_payment_intent_id is UNIQUE, so it is this row's or no row's).
    IF p_kind = 'shop_refund' THEN
      SELECT * INTO v_hand FROM public.shop_hand_refunds h
       WHERE h.stripe_refund_id = v_stripe AND h.stripe_payment_intent_id = sr.stripe_payment_intent_id AND h.failed_at IS NULL
       FOR UPDATE;
      IF FOUND THEN
        IF v_hand.amount_cents < sr.refund_cents THEN
          RAISE EXCEPTION 'hand_refund_short' USING ERRCODE = '22023',
            HINT = 'That Stripe refund is less than this refund owes. Once the buyer has the rest, settle it with "other: <the refund ids>".';
        END IF;
        UPDATE public.shop_hand_refunds SET shop_refund_id = p_id, outcome = 'settled' WHERE stripe_refund_id = v_stripe;
        v_adopted := true;
      END IF;
    END IF;
    IF NOT v_adopted AND public.money_ref_in_use(v_stripe) THEN
      RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
        HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
    END IF;
  END IF;
  INSERT INTO public.payout_settlements (stripe_ref, off_stripe_note, row_kind, row_id, amount_cents)
  VALUES (v_stripe, v_other, p_kind, p_id, p_amount_cents);
  -- A transfer on a payout / a refund on a refund: 'succeeded' with that id (the ledgers and the
  -- webhooks know it). A Stripe payout id or money paid outside Stripe: 'settled_by_hand'.
  v_succeeded := v_stripe IS NOT NULL AND (NOT v_payout OR v_stripe ~ '^tr_');
  IF p_kind = 'declutter_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
                                               livemode, hand_outcome)
    SELECT v_stripe, r.stripe_payment_intent_id, r.order_id, r.id, p_amount_cents, COALESCE(r.payment_livemode, true), 'settled'
      FROM public.declutter_refunds r WHERE r.id = p_id;
  END IF;
  -- Shops: a refund id the ledger did not know goes into it, so the order's payout stays blocked
  -- and a later failure of that refund is routed (shop_hand_refund_failed) like any other.
  IF p_kind = 'shop_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.shop_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, shop_refund_id, amount_cents,
                                          livemode, recorded_how, recorded_by, outcome, note)
    VALUES (v_stripe, sr.stripe_payment_intent_id, sr.order_id, sr.id, p_amount_cents, o.payment_livemode, 'admin', v_uid, 'settled',
            left(v_note, 500));
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    UPDATE public.shop_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_settle_by_hand', p_kind, p_id::text,
          jsonb_build_object('note', v_note, 'ref', v_ref, 'amount_cents', p_amount_cents, 'adopted_hand_refund', v_adopted));
  RETURN jsonb_build_object('result', 'settled', 'kind', p_kind, 'id', p_id, 'adopted_hand_refund', v_adopted,
    'status', CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payout_held_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT x.* FROM (
      SELECT 'declutter'::text AS kind, p.id, p.seller_id AS payee, p.amount_cents, p.review_reason, p.held_notified_at,
             COALESCE(o.is_seed, false) AS is_seed
        FROM public.declutter_payouts p LEFT JOIN public.declutter_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.held_notified_at, false
        FROM public.helpr_task_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.held_notified_at, COALESCE(o.is_seed, false)
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Shops: the buyer is NOT sent "needs a quick review ... before it can be sent" (payee NULL):
      -- this row is held because a refund was already made to them in Stripe. Ops still see it daily.
      SELECT 'shop_refund', sr.id, NULL::uuid, sr.refund_cents, sr.review_reason, sr.held_notified_at, sr.is_seed
        FROM public.shop_refunds sr WHERE sr.status = 'held_for_review'
    ) x LIMIT 500
  LOOP
    v_n := v_n + 1;
    -- Nested (not AND): plpgsql plans the inner statements only when the table exists.
    IF to_regclass('public.error_logs') IS NOT NULL THEN
     IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE jsonb_typeof(e.tags) = 'object'
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND e.tags ->> 'source' = 'payout-held-for-review'
         AND e.tags ->> 'row_id' = r.id::text
         AND e.created_at > date_trunc('day', now())
     ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Payout or refund held for review: decide it on the admin money page — %s %s ($%s). %s',
                     r.kind, r.id, to_char(r.amount_cents / 100.0, 'FM999990.00'), coalesce(left(r.review_reason, 200), '')),
              jsonb_strip_nulls(jsonb_build_object('source', 'payout-held-for-review', 'area', 'payouts',
                                                   'row_kind', r.kind, 'row_id', r.id::text,
                                                   'seed', CASE WHEN r.is_seed THEN 'true' END)),
              jsonb_build_object('row_kind', r.kind, 'row_id', r.id, 'amount_cents', r.amount_cents));
     END IF;
    END IF;
    IF r.held_notified_at IS NULL AND r.payee IS NOT NULL THEN
      PERFORM public.declutter_notify(r.payee, 'payment',
        CASE WHEN r.kind LIKE '%refund' THEN 'Your refund needs a quick review' ELSE 'Your payout needs a quick review' END,
        format('Your $%s %s needs a quick review by our team before it can be sent. You do not need to do anything; we will tell you when it is on its way.',
               to_char(r.amount_cents / 100.0, 'FM999990.00'), CASE WHEN r.kind LIKE '%refund' THEN 'refund' ELSE 'payout' END),
        '/profile?tab=earnings');
    END IF;
    IF r.held_notified_at IS NULL THEN
      IF r.kind = 'declutter' THEN UPDATE public.declutter_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'helpr_task' THEN UPDATE public.helpr_task_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'shop' THEN UPDATE public.shop_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'declutter_refund' THEN UPDATE public.declutter_refunds SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'delivery_refund' THEN UPDATE public.declutter_delivery_refunds SET held_notified_at = now() WHERE id = r.id;
      ELSE UPDATE public.shop_refunds SET held_notified_at = now() WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_held_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_held_check() TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate (shop_refunds, shop_hand_refunds and facilitator_threshold_alerts are new).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
