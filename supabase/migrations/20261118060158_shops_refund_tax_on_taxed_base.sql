-- Q2111 cash layer (Shops launch pass 2, 2026-11-18; lh-money-escrow finding 92969b7ba#3): a keep-card-fee refund
-- kept tax on the kept card fee at tax / (paid - tax). "paid - tax" still holds the order's delivery, which carries no
-- sales tax, so on a delivery order the rate came out low and the buyer got back about 1 cent too much tax per $1
-- kept (worked example in the item: items 2000, buyer fee 170, delivery 500, tax 195, kept 100: 8c kept, exact 9c).
-- Exact: divide by the money the tax was figured on, the items plus the buyer fee = paid - tax - delivery share.
--
-- 1. shop_refunds.taxed_base_cents (NULL on every older row, which keeps its old CHECK reading).
-- 2. shop_refund_tax_kept_on_base(kept, tax, base) = ceil(kept x tax / base), rounded up as J3.
-- 3. shop_refunds_tax_kept reads the base when the row has one, else the old paid-based formula, so no stored row
--    changes meaning.
-- 4. shop_refund_amounts returns taxed_base_cents and figures the tax kept on it; restated from its newest CREATE
--    (20261112082518_shops_setup_fee_refund), DROP first because its result columns grow.
-- 5. shop_write_refund writes taxed_base_cents; restated from its newest CREATE (20261112082518).
-- Only shop_write_refund's rows carry a base. The custom-balance refund rows (20261106221300, 20261107170121) keep
-- NULL and the old formula (they keep no card fee from the rest charge: kept 0, so tax kept 0 either way).
-- Not here: the Stripe Tax reversal share (chargeRefunded.ts, the item's layer 2).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before ADD, DROP FUNCTION IF EXISTS, OR REPLACE.

-- 1.
ALTER TABLE public.shop_refunds ADD COLUMN IF NOT EXISTS taxed_base_cents integer;

-- 2.
CREATE OR REPLACE FUNCTION public.shop_refund_tax_kept_on_base(p_kept integer, p_tax integer, p_base integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_kept = 0 OR p_tax = 0 THEN 0
              ELSE ceil(p_kept::numeric * p_tax / NULLIF(p_base, 0))::integer END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_tax_kept_on_base(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_tax_kept_on_base(integer, integer, integer) TO service_role;

-- 3.
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_taxed_base;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_taxed_base
  CHECK (taxed_base_cents IS NULL OR (taxed_base_cents > 0 AND taxed_base_cents <= paid_cents - tax_cents));
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_tax_kept;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_tax_kept
  CHECK (tax_kept_cents = CASE WHEN taxed_base_cents IS NULL
                               THEN public.shop_refund_tax_kept(kept_cents, tax_cents, paid_cents)
                               ELSE public.shop_refund_tax_kept_on_base(kept_cents, tax_cents, taxed_base_cents) END);

-- 4.
DROP FUNCTION IF EXISTS public.shop_refund_amounts(uuid, text);
CREATE OR REPLACE FUNCTION public.shop_refund_amounts(p_order_id uuid, p_reason text)
RETURNS TABLE (fee_policy text, paid_cents integer, tax_cents integer, card_fee_cents integer,
               kept_cents integer, tax_kept_cents integer, refund_cents integer, setup_fee_refund_cents integer,
               taxed_base_cents integer)
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
           p.setup_fee AS setup_fee,
           -- Q2111: the money the tax was figured on (items + buyer fee): what was paid less the tax and less the
           -- delivery share, which carries no sales tax (reserved or not). NULL (the old paid-based reading) if that
           -- would not be positive, so a refund never fails on the table CHECK.
           CASE WHEN p.paid - p.tax - p.delivery > 0 THEN p.paid - p.tax - p.delivery END AS taxed_base
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
                   CASE WHEN so.setup_fee_state = 'claimed' THEN so.setup_fee_cents ELSE 0 END AS setup_fee,
                   CASE WHEN public.shop_order_balance_open(so) THEN COALESCE(so.delivery_cents, 0) - COALESCE(so.delivery_cents, 0) / 2
                        ELSE COALESCE(so.delivery_cents, 0) END AS delivery
              FROM public.shop_orders so WHERE so.id = p_order_id) p
  ), k AS (
    SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept,
           -- S035 (lead 11-12): a refund that is not the buyer's doing (the shop's fault, a missed preorder goal, our
           -- mistake) gives the setup fee back too, as the 11-11 Jobs no-show rule; a buyer's own cancel keeps it.
           CASE WHEN o.policy IN ('full_shop_pays_fee', 'full_platform_absorbs') THEN o.setup_fee ELSE 0 END AS fee_back
      FROM o
  )
  SELECT k.policy, k.total_cents, k.tax_cents, k.fee, k.kept, k.tax_kept,
         k.total_cents - k.kept - k.tax_kept + k.fee_back,
         k.fee_back,
         k.taxed_base
    FROM (SELECT k.*, CASE WHEN k.taxed_base IS NULL THEN public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents)
                           ELSE public.shop_refund_tax_kept_on_base(k.kept, k.tax_cents, k.taxed_base) END AS tax_kept
            FROM k) k;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_amounts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_amounts(uuid, text) TO service_role;

-- 5.
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
                                   card_fee_cents, kept_cents, tax_kept_cents, refund_cents, setup_fee_refund_cents, taxed_base_cents, note)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, a.fee_policy, a.paid_cents, a.tax_cents,
          a.card_fee_cents, a.kept_cents, a.tax_kept_cents, a.refund_cents, a.setup_fee_refund_cents, a.taxed_base_cents,
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
