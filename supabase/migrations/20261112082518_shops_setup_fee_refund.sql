-- S035 (Shops audit 11-12; lead decision 11-12 2:10 AM in OWNER-DECISIONS): a refund that is not the buyer's doing
-- gives the one-time $2 setup fee back too, matching the 11-11 Jobs no-show FULL refund rule. Before, every Shops
-- refund was sized from total_cents, which leaves the setup fee out, so a shop cancel, a hidden shop (S001 'shop_removed')
-- or a missed preorder goal kept the buyer's $2 while the notice said "all $X is on its way back".
-- Which refunds: fee policy full_shop_pays_fee (shop_cancelled, no_ready_photo, shop_removed, problem_shop_fault, the
-- preorder reasons) and full_platform_absorbs (problem_our_mistake); never keep_card_fee (the buyer's own cancel,
-- a no-fault problem, an unpaid close). Only when this order's charge carried the fee (setup_fee_state 'claimed').
-- Then the account's fee is put back (onboarding_fee_paid false, the order 'put_back'), so it is charged once at the
-- account's next first-time step, exactly as a hold that ends uncharged puts it back (20261105181603).
--   1. shop_refunds.setup_fee_refund_cents (0 unless S035) and the amount CHECK restated: refund = paid - kept -
--      tax kept + setup fee back.
--   2. shop_refund_amounts RESTATED from 20261107162454 (newest CREATE) with one more output column (DROP + CREATE:
--      the return type changes; callers read it with SELECT * INTO a record, so none change).
--   3. shop_write_refund RESTATED from 20261019071055 (newest CREATE): writes the column and puts the fee back.
-- The Stripe refund is sent from refund_cents (functions/_shared/shopRefunds.ts), and the charge carried the fee, so
-- the refund never exceeds the charge. The card fee the shop owes is unchanged (Stripe's fee on the whole charge, S053).
-- MONEY: yes (lh-money-escrow). AUTHZ: service_role functions only; grants restated (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT, DROP FUNCTION IF EXISTS + CREATE, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsSetupFeeRefund.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1.
ALTER TABLE public.shop_refunds
  ADD COLUMN IF NOT EXISTS setup_fee_refund_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_setup_fee_refund;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_setup_fee_refund
  CHECK (setup_fee_refund_cents BETWEEN 0 AND 10000 AND (setup_fee_refund_cents = 0 OR fee_policy <> 'keep_card_fee'));
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_amount;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_amount
  CHECK (refund_cents = paid_cents - kept_cents - tax_kept_cents + setup_fee_refund_cents AND refund_cents > 0);

-- 2.
DROP FUNCTION IF EXISTS public.shop_refund_amounts(uuid, text);
CREATE OR REPLACE FUNCTION public.shop_refund_amounts(p_order_id uuid, p_reason text)
RETURNS TABLE (fee_policy text, paid_cents integer, tax_cents integer, card_fee_cents integer,
               kept_cents integer, tax_kept_cents integer, refund_cents integer, setup_fee_refund_cents integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH o AS (
    -- Helpr delivery (20261106194913): the delivery price already given back, or earned by the Helpr who picked
    -- the order up, is never refunded again; the card fee is prorated to the part refunded (Declutter's rule,
    -- declutter_card_fee_left).
    -- Slice 2a: "paid" is what the order's payment really took: the deposit while a deposit order's rest is unpaid
    -- (its tax share is the tax less the rest's half; its delivery share is the delivery less the rest's half, and no
    -- more of the reserved delivery than that), otherwise the whole sale, exactly as before.
    SELECT p.paid - p.reserved AS total_cents, p.tax AS tax_cents,
           public.declutter_card_fee_left(
             least(p.paid, COALESCE(p.card_fee_cents, public.declutter_card_fee_estimate(p.paid))),
             p.paid, p.reserved) AS fee,
           public.shop_refund_fee_policy(p_reason) AS policy,
           -- S035: the one-time setup fee this order's charge carried (claimed = charged with it).
           p.setup_fee AS setup_fee
      FROM (SELECT CASE WHEN public.shop_order_balance_open(so) THEN so.total_cents - so.balance_cents ELSE so.total_cents END AS paid,
                   CASE WHEN public.shop_order_balance_open(so) THEN so.tax_cents - so.tax_cents / 2 ELSE so.tax_cents END AS tax,
                   CASE WHEN public.shop_order_balance_open(so)
                        THEN least(public.shop_delivery_reserved_cents(so.id), so.delivery_cents - so.delivery_cents / 2)
                        ELSE public.shop_delivery_reserved_cents(so.id) END AS reserved,
                   -- 11-07 (money review change 1): a deposit order whose rest is paid was charged twice, and each
                   -- charge took its own card fee: the deposit's (recorded, else estimated on the deposit charge) plus
                   -- the rest's (recorded by shop_balance_paid, else estimated on the rest).
                   CASE WHEN public.shop_order_two_charges(so)
                        THEN COALESCE(so.card_fee_cents, public.declutter_card_fee_estimate(so.deposit_cents))
                             + COALESCE(so.balance_card_fee_cents, public.declutter_card_fee_estimate(so.balance_cents))
                        ELSE so.card_fee_cents END AS card_fee_cents,
                   CASE WHEN so.setup_fee_state = 'claimed' THEN so.setup_fee_cents ELSE 0 END AS setup_fee
              FROM public.shop_orders so WHERE so.id = p_order_id) p
  ), k AS (
    SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept,
           -- S035 (lead 11-12): a refund that is not the buyer's doing (the shop's fault, a missed preorder goal, our
           -- mistake) gives the setup fee back too, as the 11-11 Jobs no-show rule; a buyer's own cancel keeps it.
           CASE WHEN o.policy IN ('full_shop_pays_fee', 'full_platform_absorbs') THEN o.setup_fee ELSE 0 END AS fee_back
      FROM o
  )
  SELECT k.policy, k.total_cents, k.tax_cents, k.fee, k.kept,
         public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents),
         k.total_cents - k.kept - public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents) + k.fee_back,
         k.fee_back
    FROM k;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_amounts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_amounts(uuid, text) TO service_role;

-- 3.
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
  IF public.shop_order_unaccounted_hand_refund(o.id) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM public.shop_refund_amounts(o.id, p_reason);
  INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
                                   card_fee_cents, kept_cents, tax_kept_cents, refund_cents, setup_fee_refund_cents, note)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, a.fee_policy, a.paid_cents, a.tax_cents,
          a.card_fee_cents, a.kept_cents, a.tax_kept_cents, a.refund_cents, a.setup_fee_refund_cents,
          NULLIF(btrim(COALESCE(p_note, '')), ''))
  RETURNING * INTO r;
  -- S035: the setup fee goes back with the order, so the account has not paid it: it is owed again at the account's
  -- next first-time step (once per account, as a hold that ends uncharged puts it back; 20261105181603).
  IF a.setup_fee_refund_cents > 0 AND o.buyer_id IS NOT NULL THEN
    UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL WHERE user_id = o.buyer_id;
    UPDATE public.shop_orders SET setup_fee_state = 'put_back' WHERE id = o.id AND setup_fee_state = 'claimed';
  END IF;
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
