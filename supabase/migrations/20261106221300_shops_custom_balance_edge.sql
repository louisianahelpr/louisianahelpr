-- Shops custom orders, slice 2b part 2: the SQL the edge side needs (Builder 4, 11-06; plan
-- ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 balance-failure rule; LEAD 11-06 tax rule).
-- Stacked on 2b part 1 (20261106215722).
--   1. A new Shops refund reason, unpaid_close_tax (fee policy keep_card_fee: the buyer's own close, so it is not one
--      of our mistakes; the deposit's whole card fee is already kept, so card_fee_cents 0 and nothing more is kept):
--      on a close where no item changes hands with the rest unpaid (the lapse, the buyer's late cancel, a no-show;
--      trg_shop_orders_mark_unpaid_close), the deposit's sales tax goes back to the buyer. The row is the order's one
--      shop_refunds row: paid_cents is the deposit's tax, tax_cents 0 (the money returned IS the tax, so none of it is
--      "tax inside" to keep), nothing kept. MONEY REVIEW: flagged (new reason, its tax_cents = 0 and card_fee_cents 0).
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
    -- unpaid_close_tax: the buyer's own close (late cancel, lapse, no-show). The card fee stays kept: the deposit's
    -- whole card fee was already kept (nothing else of the deposit comes back), so the row keeps 0 more of it.
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault', 'unpaid_close_tax') THEN 'keep_card_fee'
    WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs'
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
    VALUES (o.id, o.stripe_payment_intent_id, 'unpaid_close_tax', 'keep_card_fee', v_tax, 0,
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

-- 3. What the buyer and the shop read on the order card (slice 4 UI): the plan, the deposit, the rest, and whether
-- the rest was paid or is waiting on the buyer. Row access is the table's own policies (buyer or seller of the row).
-- The saved card (balance_customer_id, balance_payment_method_id), the rest's Stripe ids, attempts and errors stay
-- server-only.
GRANT SELECT (payment_plan, deposit_cents, balance_cents, balance_captured_at, balance_failed_at) ON TABLE public.shop_orders TO authenticated;
