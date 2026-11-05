-- Q2106 S3b step 1 (Builder 3, 11-04; lead-approved plan 9:4x PM): a Declutter refund row says how much of it goes
-- back to the buyer's GIFT balance, and a gift-only order's refund has no card payment.
--
-- Found on the S3 schema read: declutter_refunds.stripe_payment_intent_id was NOT NULL + '^pi_', so every close path
-- of a gift-only paid order (stripe_payment_intent_id NULL on the order) raised inside declutter_record_refund, and a
-- gift+card order's paths would ask Stripe to refund the whole price from a charge that covered only the card part.
--
-- refund_cents stays the TOTAL given back (card + gift), so every existing amount and policy CHECK holds unchanged;
-- gift_refund_cents (0..refund_cents) is the part restored to the gift balance (restore_gift_card_for_declutter_order,
-- key 'declutter_refund:'||id), and the card refund is refund_cents - gift_refund_cents. A row with no payment intent is
-- allowed ONLY when all of it goes to the gift balance, and then at most one per order (the PI's UNIQUE no longer
-- dedupes it). Not "AND order_id IS NOT NULL" (the plan's first wording): order_id is ON DELETE SET NULL, so that
-- CHECK would make any cascade that deletes an order with a gift-only refund fail; the row keeps its money record
-- instead. Replay-safe: every step is guarded.
ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS gift_refund_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_gift_share;
ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_gift_share
  CHECK (gift_refund_cents >= 0 AND gift_refund_cents <= refund_cents);

ALTER TABLE public.declutter_refunds ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_gift_only_no_card;
ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_gift_only_no_card
  CHECK (stripe_payment_intent_id IS NOT NULL OR gift_refund_cents = refund_cents);

CREATE UNIQUE INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order
  ON public.declutter_refunds (order_id) WHERE stripe_payment_intent_id IS NULL;
