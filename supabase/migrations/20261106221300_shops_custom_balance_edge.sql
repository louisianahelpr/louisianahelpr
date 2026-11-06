-- Shops custom orders, slice 2b part 2: the SQL the edge side needs (Builder 4, 11-06; plan
-- ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 balance-failure rule; LEAD 11-06 tax rule).
-- Stacked on 2b part 1 (20261106215722).
--   1. A new Shops refund reason, unpaid_close_tax (fee policy full_platform_absorbs): on a close where no item changes
--      hands with the rest unpaid (the lapse, the buyer's late cancel, a no-show; trg_shop_orders_mark_unpaid_close),
--      the deposit's sales tax goes back to the buyer. The row is the order's one shop_refunds row: paid_cents is the
--      deposit's tax, tax_cents 0 (the money returned IS the tax, so none of it is "tax inside" to keep), nothing kept.
--      MONEY REVIEW: flagged (new reason, and its tax_cents = 0 reading).
--   2. shop_lapse_tax_done: the edge calls it after Stripe Tax's FULL reversal of the order's transaction; it writes
--      that refund row (sent by declutter-money's shop_refunds_due like every other) and marks the step done, at once.
--   (LEAD 11-06: shops_order_custom_quote keeps deposit_not_ready until every 2b part is built and tested; only the
--    last commit before review drops it.)
-- MONEY: yes (lh-money-escrow). AUTHZ: service-only.
-- REPLAY-SAFE: constraint swapped only when its text lacks the reason, CREATE OR REPLACE, grants restated.

-- 1. The reason and its fee policy. RESTATED from 20261019071055 (shop_refund_fee_policy; its only body).
CREATE OR REPLACE FUNCTION public.shop_refund_fee_policy(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee'
    -- unpaid_close_tax: the tax goes back whole; no card fee is ever kept out of tax.
    WHEN p_reason IN ('problem_our_mistake', 'unpaid_close_tax') THEN 'full_platform_absorbs'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_fee_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_fee_policy(text) TO service_role;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_refunds_reason_check'
                    AND conrelid = 'public.shop_refunds'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%unpaid_close_tax%') THEN
    ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_reason_check;
    ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_reason_check CHECK (reason IN (
      'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed',
      'problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'unpaid_close_tax'));
  END IF;
END;
$do$;

-- 2. The tax step is done: Stripe Tax's transaction was reversed in full (the edge, before this call); the deposit's
--    tax goes back through the order's refund row. RESTATED from 20261106215722 (signature unchanged).
CREATE OR REPLACE FUNCTION public.shop_lapse_tax_done(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_tax integer;
  v_refund uuid;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.balance_lapsed_at IS NULL OR o.lapse_tax_done_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_owed', 'order_id', p_order_id);
  END IF;
  -- The deposit's tax: what the deposit capture took of the tax (the rest held floor(tax / 2), 2a).
  v_tax := o.tax_cents - o.tax_cents / 2;
  IF v_tax > 0 AND o.stripe_payment_intent_id IS NOT NULL THEN
    INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
                                     card_fee_cents, kept_cents, tax_kept_cents, refund_cents, note)
    VALUES (o.id, o.stripe_payment_intent_id, 'unpaid_close_tax', 'full_platform_absorbs', v_tax, 0,
            0, 0, 0, v_tax, 'Sales tax on the deposit: the order closed with no item handed over.')
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_refund;
    IF v_refund IS NULL THEN
      -- The order already has its one refund row (an earlier refund): a person settles the tax by hand.
      PERFORM public.log_cron_defect('shop_lapse_tax_done', o.id::text, 'order already has a refund row; deposit tax not queued');
    END IF;
  END IF;
  UPDATE public.shop_orders SET lapse_tax_done_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'done', 'order_id', o.id, 'refund_id', v_refund, 'tax_cents', v_tax);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_lapse_tax_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lapse_tax_done(uuid) TO service_role;
