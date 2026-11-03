-- Shipping claim remainder is sent to the seller BY AN ADMIN BY HAND (owner 11-03, via the lead: "the rest of a
-- shipping insurance claim, after the seller's debts on that order, is sent to the seller by an admin by hand, never
-- automatically"). 20261103210119 records that rest as seller_due_cents (status 'seller_due'); its CHECK already allows
-- 'seller_paid', but nothing could set it and nothing listed what is owed.
--
-- Now (no automatic payout anywhere):
--   1. shipping_claim_payouts.sent_at / sent_ref: when the admin sent it and how (a transfer id, a check number).
--      CHECK: 'seller_paid' exactly when sent_at is set.
--   2. declutter_admin_ship_claims_due(): admin only, behind declutter_shipping: every claim still 'seller_due', oldest
--      first: the claim, order, seller and the amount to send by hand.
--   3. declutter_admin_mark_ship_claim_sent(claim, ref): admin only, behind the switch; 'seller_due' -> 'seller_paid'
--      once, with an admin_audit_log row and one notice to the seller (no fee words). The same claim again with the same
--      ref answers already_sent and writes nothing; another ref is refused; a 'settled' claim (nothing due) is refused.
-- Proof: src/test/pglite/shippingClaimSentByHand.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, the CHECK dropped and re-added, CREATE OR REPLACE.

ALTER TABLE public.shipping_claim_payouts ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE public.shipping_claim_payouts ADD COLUMN IF NOT EXISTS sent_ref text;
ALTER TABLE public.shipping_claim_payouts DROP CONSTRAINT IF EXISTS shipping_claim_sent_by_hand;
ALTER TABLE public.shipping_claim_payouts ADD CONSTRAINT shipping_claim_sent_by_hand CHECK (
  ((status = 'seller_paid') = (sent_at IS NOT NULL))
  AND (sent_ref IS NULL OR char_length(sent_ref) BETWEEN 1 AND 200)
  AND ((sent_at IS NULL) = (sent_ref IS NULL)));

CREATE OR REPLACE FUNCTION public.declutter_admin_ship_claims_due()
RETURNS TABLE (claim_id uuid, order_id uuid, seller_id uuid, claim_ref text, seller_due_cents integer, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter_shipping');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.order_id, c.seller_id, c.claim_ref, c.seller_due_cents, c.created_at
      FROM public.shipping_claim_payouts c
     WHERE c.status = 'seller_due'
     ORDER BY c.created_at, c.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_ship_claims_due() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_ship_claims_due() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_mark_ship_claim_sent(p_claim_id uuid, p_sent_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ref text := btrim(COALESCE(p_sent_ref, ''));
  c public.shipping_claim_payouts;
BEGIN
  PERFORM public.require_feature('declutter_shipping');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_ref) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_sent_ref' USING ERRCODE = '22023', HINT = 'Say how you sent it: the transfer id or check number.';
  END IF;
  SELECT * INTO c FROM public.shipping_claim_payouts x WHERE x.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF c.status = 'seller_paid' THEN
    IF c.sent_ref = v_ref THEN
      RETURN jsonb_build_object('result', 'already_sent', 'claim_id', c.id, 'seller_due_cents', c.seller_due_cents);
    END IF;
    RAISE EXCEPTION 'claim_already_sent' USING ERRCODE = '55000', HINT = 'This claim was already marked sent with another reference.';
  END IF;
  IF c.status <> 'seller_due' THEN
    RAISE EXCEPTION 'nothing_due' USING ERRCODE = '55000', HINT = 'This claim paid only what the seller owed; nothing is due to them.';
  END IF;
  UPDATE public.shipping_claim_payouts SET status = 'seller_paid', sent_at = now(), sent_ref = v_ref WHERE id = c.id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_admin_mark_ship_claim_sent', 'declutter_order', c.order_id::text,
          jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref, 'seller_due_cents', c.seller_due_cents, 'sent_ref', v_ref));
  IF c.seller_id IS NOT NULL THEN
    PERFORM public.declutter_notify(c.seller_id, 'declutter_refunds', 'Carrier claim money sent',
      format('We sent you $%s from the carrier''s claim on the package you shipped.', to_char(c.seller_due_cents / 100.0, 'FM999990.00')),
      '/declutter?tab=selling');
  END IF;
  RETURN jsonb_build_object('result', 'sent', 'claim_id', c.id, 'seller_due_cents', c.seller_due_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_mark_ship_claim_sent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_mark_ship_claim_sent(uuid, text) TO authenticated, service_role;
