-- Q2390 packet 23 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for the two wallet-customer functions that still raised P0002:
--   replace_stripe_customer  (service_role only, SECURITY INVOKER; the raise
--                             fires before its DELETE/INSERT)
--   claim_stripe_customer    (service_role only, SECURITY INVOKER; the raise
--                             fires before its INSERT)
-- Each raises 'user_not_found' only when p_user IS NULL. Their only caller is
-- supabase/functions/_shared/stripeCustomer.ts (resolveStripeCustomer and
-- replacingDeadCustomer), which always passes the signed-in user's id and turns
-- ANY rpc error into StripeCustomerUnavailable without reading the SQLSTATE, so
-- no edge map changes. Neither moves money or calls pg_net. MONEY-adjacent: the
-- caller's Stripe customers.create (idempotency-keyed) runs before each call,
-- exactly as before this change.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY INVOKER and
-- search_path as on prod). Name, newest copy, prod md5:
--   replace_stripe_customer                20261103053759 a900b324535272b057836ad34eeb51d6
--   claim_stripe_customer                  20261018090700 00020676eebe80a5e58f2234bb35069f
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (2 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

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
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
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

CREATE OR REPLACE FUNCTION public.claim_stripe_customer(p_user uuid, p_mode text, p_customer text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('live', 'test') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;
  IF p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_customer' USING ERRCODE = '22023';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id)
  VALUES (p_user, p_mode, p_customer)
  ON CONFLICT (user_id, wallet_mode) DO NOTHING;
  SELECT c.stripe_customer_id INTO v_id FROM public.stripe_customers c
   WHERE c.user_id = p_user AND c.wallet_mode = p_mode;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_stripe_customer(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_customer(uuid, text, text) TO service_role;

