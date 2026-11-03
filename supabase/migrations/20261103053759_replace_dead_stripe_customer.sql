-- A member's stored wallet customer that Stripe no longer has is swapped for a new one (Q2140, Builder 27, 2026-11-02;
-- design approved by the lead 11-02: lazy, only after Stripe answers resource_missing for that customer).
--
-- WHY: public.stripe_customers is first-writer-wins (claim_stripe_customer, 20261018090700) with no replace path, so
-- a customer deleted in the Stripe Dashboard (or by "delete all test data" in test mode) made every later wallet
-- checkout fail with "No such customer" for good. _shared/stripeCustomer.ts withWalletCustomer() calls this ONLY after
-- Stripe refused the stored id as missing, with a new customer it just made.
--
-- WHAT IT DOES: a guarded swap. The member's row for p_mode is replaced only while it still holds p_old (racing taps
-- converge: the second caller's p_old no longer matches, nothing changes, and it gets the id the first one stored).
-- Their Declutter saved card on p_old in that mode is deleted too (the card died with the customer; the card page
-- asks for a new one). Returns the member's current stored id. service_role only; SECURITY INVOKER, like
-- claim_stripe_customer: service_role holds SELECT, INSERT, DELETE on stripe_customers (no UPDATE), so the swap is a
-- DELETE then INSERT in one transaction.
-- No money moves. Replay-safe: CREATE OR REPLACE. Proof: src/test/pglite/replaceDeadStripeCustomer.pglite.mjs.

CREATE OR REPLACE FUNCTION public.replace_stripe_customer(p_user uuid, p_mode text, p_old text, p_new text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_swapped integer;
  v_id text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('live', 'test') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;
  IF p_old IS NULL OR p_old !~ '^cus_[A-Za-z0-9]+$' OR p_new IS NULL OR p_new !~ '^cus_[A-Za-z0-9]+$' OR p_old = p_new THEN
    RAISE EXCEPTION 'invalid_customer' USING ERRCODE = '22023';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.stripe_customers
   WHERE user_id = p_user AND wallet_mode = p_mode AND stripe_customer_id = p_old;
  GET DIAGNOSTICS v_swapped = ROW_COUNT;
  IF v_swapped > 0 THEN
    INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id)
    VALUES (p_user, p_mode, p_new);
    IF to_regclass('public.declutter_buyer_cards') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.declutter_buyer_cards WHERE user_id = $1 AND card_mode = $2 AND stripe_customer_id = $3'
        USING p_user, p_mode, p_old;
    END IF;
  END IF;
  SELECT c.stripe_customer_id INTO v_id FROM public.stripe_customers c
   WHERE c.user_id = p_user AND c.wallet_mode = p_mode;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.replace_stripe_customer(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_stripe_customer(uuid, text, text, text) TO service_role;
