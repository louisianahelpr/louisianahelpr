-- One wallet, slice 1 (owner 2026-10-18: "verify ONCE, use EVERYWHERE").
-- Plan: ~/.lh-wt/handoffs-1017/one-wallet-plan.md.
--
-- ONE stored Stripe Customer per member per Stripe mode. Before this, each
-- section found or made its own: Jobs looked customers up BY EMAIL (Stripe
-- does not treat email as a key, so a reused address inherits the old
-- customer and its saved cards), Declutter kept its own in
-- declutter_buyer_cards. Every checkout now resolves the customer through
-- supabase/functions/_shared/stripeCustomer.ts, which reads this table and
-- claims a new row through claim_stripe_customer(); it never searches Stripe
-- by email.
--
-- Per MODE because a test-mode cus_ does not exist under the live key
-- (_shared/stripeMode.ts pins test accounts to test and everyone else to live,
-- so a real member has exactly one row).
--
-- Service role only: RLS on with no policy, no grant to anon/authenticated,
-- and service_role gets SELECT/INSERT/DELETE but NOT UPDATE, so a stored
-- customer can never be rebound to another id (first writer wins is
-- structural, not only the claim function's habit). The claim function is
-- SECURITY INVOKER (lh-authz-rls review): if an EXECUTE grant ever leaked, the
-- caller would still hit RLS with no policy. The id is never sent to a client
-- and the table is not in the data export (declutter_buyer_cards'
-- stripe_customer_id is stripped there too; see dataExportInventory EXEMPT).

CREATE TABLE IF NOT EXISTS public.stripe_customers (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_mode text NOT NULL CHECK (wallet_mode IN ('live', 'test')),
  stripe_customer_id text NOT NULL UNIQUE CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, wallet_mode)
);
ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_customers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.stripe_customers TO service_role;
-- Q807: unconfirmed-email sessions cannot write (service role only here anyway).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;

-- First writer wins: two taps that each made a customer converge on the one
-- stored first; the caller uses whatever this returns. Two statements with an
-- explicit conflict target: the SELECT sees a row a racing claim committed,
-- and a customer id already stored for ANOTHER member raises (23505) instead
-- of being swallowed. An unknown user raises through the foreign key (23503).
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
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
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

-- Backfill: every Declutter saved card's customer becomes the member's stored
-- customer in that card's mode (1 row on prod, 2026-10-18, card_mode 'test').
-- A customer id already stored for another member is skipped, never moved.
DO $backfill$
BEGIN
  IF to_regclass('public.declutter_buyer_cards') IS NOT NULL THEN
    INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id, created_at)
    SELECT c.user_id, c.card_mode, c.stripe_customer_id, c.saved_at
      FROM public.declutter_buyer_cards c
     WHERE c.card_mode IN ('live', 'test')
       AND c.stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ON CONFLICT DO NOTHING;
  END IF;
END
$backfill$;

-- The card-saved webhook (stripe-webhook handlers/declutterCheckout.ts) stores
-- the customer the setup page ran on. It now claims that customer too (first
-- writer wins), so a card page opened before this deploy, on a customer the
-- wallet does not know yet, still lands in the wallet (lh-money-escrow review
-- #3). Body otherwise unchanged from 20261014224914 (declutter slice 3b).
DO $save_card$
BEGIN
  IF to_regclass('public.declutter_buyer_cards') IS NOT NULL THEN
    EXECUTE $def$
CREATE OR REPLACE FUNCTION public.declutter_save_card(p_user uuid, p_customer text, p_payment_method text, p_brand text, p_last4 text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.declutter_buyer_cards (user_id, stripe_customer_id, payment_method_id, brand, last4, card_mode, saved_at)
  VALUES (p_user, p_customer, p_payment_method, left(p_brand, 20),
          CASE WHEN p_last4 ~ '^[0-9]{4}$' THEN p_last4 END, p_mode, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stripe_customer_id = EXCLUDED.stripe_customer_id, payment_method_id = EXCLUDED.payment_method_id,
        brand = EXCLUDED.brand, last4 = EXCLUDED.last4, card_mode = EXCLUDED.card_mode, saved_at = now();
  -- One wallet: the member's first stored customer in this mode wins.
  -- A cus_ already stored for ANOTHER member (never expected: the id comes
  -- from Stripe's signed event) is logged, not raised, so the webhook does not
  -- retry forever; the card is still saved (reviews: lh-authz-rls #1, lh-money-escrow #2).
  IF p_mode IN ('live', 'test') AND p_customer ~ '^cus_[A-Za-z0-9]+$' THEN
    BEGIN
      INSERT INTO public.stripe_customers (user_id, wallet_mode, stripe_customer_id)
      VALUES (p_user, p_mode, p_customer)
      ON CONFLICT (user_id, wallet_mode) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'one wallet: % is stored for another member; card saved, wallet unchanged', p_customer;
    END;
  END IF;
  PERFORM public.declutter_notify(p_user, 'payment', 'Card saved',
    'Your card is saved for Declutter. It is never charged until you check out and pay.', '/declutter');
END;
$function$
$def$;
    REVOKE ALL ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) TO service_role;
  END IF;
END
$save_card$;
