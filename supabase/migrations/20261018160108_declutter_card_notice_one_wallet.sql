-- One wallet card everywhere (owner pop-up, 2026-10-18): a member's default
-- saved card may be charged automatically in any section where they turned on
-- automatic charges (auto-tip, recurring). The "Card saved" notice that
-- declutter_save_card sends promised "never charged until you check out and
-- pay", which is no longer the whole truth. Same promise, truthful: charged
-- only when you buy, or automatically where you turned on automatic charges.
--
-- Body otherwise unchanged from 20261018090700_one_wallet_stripe_customers.sql
-- (live pg_get_functiondef read 2026-10-18 16:00Z: that body, with the old text).
-- Replay-safe: guarded on declutter_buyer_cards like the original; grants restated.
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
    'Your card is saved. It is charged only when you buy, or automatically where you turned on automatic charges.', '/declutter');
END;
$function$
$def$;
    REVOKE ALL ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.declutter_save_card(uuid, text, text, text, text, text) TO service_role;
  END IF;
END
$save_card$;
