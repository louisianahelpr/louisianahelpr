-- Declutter top 5, #1 (owner 11-19, "Do all 5", after the Vinted/Depop audit): ONE-TAP OFFER TO SAVERS.
-- On Selling, a live priced listing that people saved shows "N saved this. Send them an offer": the seller picks 10, 15
-- or 20% off (or a dollar amount) and every saver gets a private offer at that price, in their Offers on Buying, with
-- 48 hours to answer. It is the existing offer thread, started by the seller: a declutter_offers row awaiting the
-- BUYER (counter_count 0, first event seller/offer), so Accept, Counter and Decline are declutter_respond_offer as they
-- are today, a buyer's counter still meets the seller's "Answer offers for me" rules there, accepting needs the saved
-- card and charges least(offer, price now), and the deadline sweep closes it after 48 hours.
--
-- declutter_send_saver_offer(p_item_id, p_percent_off, p_amount_cents) -> jsonb {sent, amount_cents, next_at}
--   * Exactly one of p_percent_off (5..50) or p_amount_cents (the offer price itself) is given.
--   * The seller's own live, priced, visible listing; Declutter member, not banned (the offer RPCs' own checks).
--   * The price: below today's price, at least $1, at least half today's price (the buyer-offer rule), and never below
--     the seller's own "lowest you'll take" (declutter_item_private.floor_price_cents) when one is set.
--   * ONE send per item per 24 hours (declutter_saver_offer_sends), claimed under the item's row lock, so two taps
--     never send twice. A send that reaches nobody records nothing and is refused (no_savers), so the 24 hours are
--     not spent on nothing.
--   * Who gets it: everyone on declutter_watchlist for the item except the seller, anyone who already has an open
--     offer on it (one open thread per buyer per item, declutter_offers_one_open_per_buyer), anyone in a block with the
--     seller, anyone out of Declutter (declutter_member_out) or without Declutter on (feature_enabled_for_user).
--     Q137 / owner rule "test data never shows to real people": a test listing (is_seed), or a seller who is a test
--     account or a seed profile, sends only to test accounts and seed profiles. At most 200 savers per send.
--   * Each saver's notice: declutter_notify(..., 'declutter_offers', ...): the Offers kind, so the member's own
--     Offers switches decide push and email exactly as for every other offer notice (the bell row is the in-app
--     record, as for all offers). declutter_notice_ref names the offer, so the notice opens it and stops counting
--     once it is answered (Q2659). The seller is named first name + last initial, never across a block or ban.
--
-- New: one table (send log, seller reads own), one RPC, one column on declutter_offers (saver_offer_id, which send
-- started the thread; NULL on every other thread). No feature switch (owner: ship on for everyone). Money: none
-- moves here; an accepted saver offer is charged through declutter_take_item exactly as any accepted offer.
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE,
-- grants restated. Proof: src/test/pglite/declutterOfferToSavers.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).

-- ---------------------------------------------------------------------------
-- 1. The send log: one row per send. The seller reads their own (Selling shows "Sent to 4 · next one tomorrow").
CREATE TABLE IF NOT EXISTS public.declutter_saver_offer_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  percent_off smallint CHECK (percent_off IS NULL OR percent_off BETWEEN 5 AND 50),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 100000),
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000),
  sent_count integer NOT NULL CHECK (sent_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_saver_offer_sends_item_idx ON public.declutter_saver_offer_sends (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS declutter_saver_offer_sends_seller_idx ON public.declutter_saver_offer_sends (seller_id, created_at DESC);
ALTER TABLE public.declutter_saver_offer_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_saver_offer_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_saver_offer_sends TO authenticated;
GRANT ALL ON TABLE public.declutter_saver_offer_sends TO service_role;
DROP POLICY IF EXISTS "declutter saver offer sends: seller reads own" ON public.declutter_saver_offer_sends;
CREATE POLICY "declutter saver offer sends: seller reads own" ON public.declutter_saver_offer_sends
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()));
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_saver_offer_sends IS
  'Declutter top 5 #1 (owner 11-19): each "send an offer to the people who saved this" (one per item per 24 hours). '
  'Written only by declutter_send_saver_offer. The seller reads their own rows.';

-- 2. Which send started an offer thread (NULL on every other thread).
ALTER TABLE public.declutter_offers ADD COLUMN IF NOT EXISTS saver_offer_id uuid
  REFERENCES public.declutter_saver_offer_sends(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS declutter_offers_saver_offer_idx ON public.declutter_offers (saver_offer_id) WHERE saver_offer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The send.
CREATE OR REPLACE FUNCTION public.declutter_send_saver_offer(p_item_id uuid, p_percent_off integer, p_amount_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_amount integer;
  v_last timestamptz;
  v_test_seller boolean;
  v_seller_name text;
  v_send uuid := gen_random_uuid();
  v_offer uuid;
  v_sent integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF (p_percent_off IS NULL) = (p_amount_cents IS NULL) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick a percent off or a price.';
  END IF;
  IF p_percent_off IS NOT NULL AND (p_percent_off < 5 OR p_percent_off > 50) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick between 5% and 50% off.';
  END IF;

  -- The item row lock serializes two sends (and any offer answer) on this item.
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'live' OR v_item.seller_hidden THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can send an offer.';
  END IF;
  IF v_item.current_price_cents IS NULL OR v_item.current_price_cents < 200 THEN
    RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023', HINT = 'This price is too low to take anything off.';
  END IF;

  v_amount := COALESCE(p_amount_cents, round(v_item.current_price_cents * (100 - p_percent_off) / 100.0)::integer);
  IF v_amount < 100 OR v_amount >= v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023', HINT = 'The offer has to be less than the price and at least $1.';
  END IF;
  IF v_amount * 2 < v_item.current_price_cents THEN
    RAISE EXCEPTION 'offer_too_low' USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
  END IF;
  SELECT p.floor_price_cents INTO v_floor FROM public.declutter_item_private p WHERE p.item_id = p_item_id;
  IF v_floor IS NOT NULL AND v_amount < v_floor THEN
    RAISE EXCEPTION 'below_your_lowest' USING ERRCODE = '22023',
      HINT = format('That is below your lowest price, %s. Pick a smaller discount or change your lowest price.',
                    public.declutter_price_text(v_floor));
  END IF;

  SELECT max(s.created_at) INTO v_last FROM public.declutter_saver_offer_sends s WHERE s.item_id = p_item_id;
  IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'saver_offer_rate_limited' USING ERRCODE = '54000',
      HINT = 'You can send one offer a day for each item.';
  END IF;

  -- Q137 / owner rule: test data never reaches a real member.
  v_test_seller := v_item.is_seed
    OR COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = v_uid), false)
    OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v_uid);
  SELECT public.member_display_name(pr.full_name, NULL) INTO v_seller_name FROM public.profiles pr WHERE pr.user_id = v_uid;

  -- The log row first (the offers point at it). A send that reaches nobody raises no_savers below, which rolls this
  -- row back with everything else, so the 24 hours are not spent.
  INSERT INTO public.declutter_saver_offer_sends (id, item_id, seller_id, percent_off, amount_cents, price_cents, sent_count)
  VALUES (v_send, p_item_id, v_uid, p_percent_off, v_amount, v_item.current_price_cents, 1);

  FOR r IN
    SELECT w.user_id
      FROM public.declutter_watchlist w
      LEFT JOIN public.profiles wp ON wp.user_id = w.user_id
     WHERE w.item_id = p_item_id
       AND w.user_id <> v_uid
       AND NOT EXISTS (SELECT 1 FROM public.declutter_offers o
                        WHERE o.item_id = p_item_id AND o.buyer_id = w.user_id AND o.status = 'open')
       AND NOT public.are_users_blocked(w.user_id, v_uid)
       AND NOT public.declutter_member_out(w.user_id)
       AND public.feature_enabled_for_user('declutter', w.user_id)
       AND (NOT v_test_seller
            OR COALESCE(wp.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = w.user_id))
     ORDER BY w.created_at
     LIMIT 200
  LOOP
    INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, saver_offer_id)
    VALUES (p_item_id, r.user_id, v_uid, v_amount, 'buyer', now() + interval '48 hours', 0, v_send)
    RETURNING id INTO v_offer;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (v_offer, 'seller', 'offer', v_amount);
    PERFORM public.declutter_notice_ref(v_offer); -- Q2659: the notice opens this offer and retires once it is answered
    PERFORM public.declutter_notify(r.user_id, 'declutter_offers', 'Offer on an item you saved',
      CASE WHEN v_seller_name IS NOT NULL AND NOT public.declutter_names_hidden(r.user_id, v_uid)
        THEN format('%s offered you "%s" for $%s (was $%s). Accept, decline or send a different price within 48 hours.',
                    v_seller_name, v_item.title, to_char(v_amount / 100.0, 'FM999990.00'),
                    to_char(v_item.current_price_cents / 100.0, 'FM999990.00'))
        ELSE format('The seller offered you "%s" for $%s (was $%s). Accept, decline or send a different price within 48 hours.',
                    v_item.title, to_char(v_amount / 100.0, 'FM999990.00'),
                    to_char(v_item.current_price_cents / 100.0, 'FM999990.00')) END,
      '/declutter?tab=buying', v_uid);
    v_sent := v_sent + 1;
  END LOOP;

  IF v_sent = 0 THEN
    RAISE EXCEPTION 'no_savers' USING ERRCODE = '55000',
      HINT = 'Nobody who saved this can get an offer right now (they may already have one open).';
  END IF;
  UPDATE public.declutter_saver_offer_sends SET sent_count = v_sent WHERE id = v_send;
  RETURN jsonb_build_object('sent', v_sent, 'amount_cents', v_amount, 'next_at', now() + interval '24 hours');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_send_saver_offer(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_saver_offer(uuid, integer, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_send_saver_offer(uuid, integer, integer) IS
  'Declutter top 5 #1 (owner 11-19): the seller sends one private offer to everyone who saved a live listing (once per item per 24 hours).';
