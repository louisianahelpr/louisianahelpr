-- Owner 2026-11-25 (phone polish, answering the audit pop-up): "on browse there should be a heart in the bottom right
-- of the picture so people can favorite it and then the seller can send lower offers if they favor it like on vinted
-- or they can do auto offers like depop."
--
-- The Vinted half is live since 20261120010630 (declutter_send_saver_offer: one tap sends every saver a private offer,
-- once per item per 24 hours). This is the Depop half: AUTO-OFFER NEW SAVERS. On Selling, the seller turns on
-- "Auto-offer new savers" for a live priced listing at 10, 15 or 20% off (5..50 accepted). From then on, each member
-- who saves (hearts) that listing gets the same private offer at once: a declutter_offers row awaiting the BUYER
-- (counter_count 0, first event seller/offer, 48 hours), exactly the thread a saver offer starts, so Accept, Counter and
-- Decline are declutter_respond_offer as today, accepting needs the saved card and is charged least(offer, price now)
-- through declutter_take_item, and the deadline sweep closes it after 48 hours.
--
-- declutter_set_auto_liker_offer(p_item_id, p_percent_off) -> jsonb {percent_off, amount_cents} | NULL (turned off)
--   * The seller's own live or paused listing; Declutter member, not banned (the offer RPCs' own checks).
--   * p_percent_off NULL turns it off. Otherwise 5..50, and today's offer price must pass the saver-offer rules: below
--     today's price, at least $1, at least half today's price, never below the seller's own lowest price.
-- declutter_auto_offer_new_saver(): AFTER INSERT ON declutter_watchlist (every way a save is written; today only
--   declutter_set_watch). It never refuses the save: when the offer cannot go (no rule, listing not live or hidden, the
--   seller out of Declutter,
--   the price now too low for the percent, below the lowest price, the saver is the seller, already has an open
--   offer, got an automatic offer on this item before, is in a block with the seller, is out of Declutter or has
--   Declutter off), it simply sends nothing. ONE automatic offer per saver per item, ever (declutter_offers.auto_liker),
--   so unsaving and saving again never sends a second one. The item row lock serializes it with sends and answers.
--   Q137 / owner rule "test data never shows to real people": a test listing (is_seed), or a seller who is a test
--   account or a seed profile, auto-offers only to test accounts and seed profiles.
--   The saver's notice: declutter_notify(..., 'declutter_offers', ...), the Offers kind, so the member's own Offers
--   switches decide push and email exactly as for every other offer notice (opt-outs respected); declutter_notice_ref
--   names the offer (it opens it and retires once answered, Q2659). One notice per save that sends an offer, never a
--   reminder (owner rule: no "still there?" nudges).
--
-- New: one table (the seller's rule per item; seller reads own), one column on declutter_offers, one RPC, one trigger
-- function + trigger. No feature switch (owner: ship on for everyone). Money: none moves here; an accepted automatic
-- offer is charged through declutter_take_item exactly as any accepted offer.
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY / TRIGGER IF EXISTS,
-- CREATE OR REPLACE, grants restated by role name.
-- Proof: src/test/pglite/declutterAutoOfferNewSavers.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).

-- ---------------------------------------------------------------------------
-- 1. The seller's rule: one row per listing while "Auto-offer new savers" is on.
CREATE TABLE IF NOT EXISTS public.declutter_auto_liker_offers (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  percent_off smallint NOT NULL CHECK (percent_off BETWEEN 5 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_auto_liker_offers_seller_idx ON public.declutter_auto_liker_offers (seller_id);
ALTER TABLE public.declutter_auto_liker_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_auto_liker_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_auto_liker_offers TO authenticated;
GRANT ALL ON TABLE public.declutter_auto_liker_offers TO service_role;
DROP POLICY IF EXISTS "declutter auto liker offers: seller reads own" ON public.declutter_auto_liker_offers;
CREATE POLICY "declutter auto liker offers: seller reads own" ON public.declutter_auto_liker_offers
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
COMMENT ON TABLE public.declutter_auto_liker_offers IS
  'Owner 2026-11-25 (Depop-style): the seller''s "Auto-offer new savers" percent per listing. Written only by '
  'declutter_set_auto_liker_offer; read by the seller (own rows) and by the declutter_watchlist insert trigger.';

-- 2. Which threads an automatic offer started (one per saver per item, ever).
ALTER TABLE public.declutter_offers ADD COLUMN IF NOT EXISTS auto_liker boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS declutter_offers_auto_liker_idx ON public.declutter_offers (item_id, buyer_id) WHERE auto_liker;

-- ---------------------------------------------------------------------------
-- 3. The seller turns it on (a percent) or off (NULL).
CREATE OR REPLACE FUNCTION public.declutter_set_auto_liker_offer(p_item_id uuid, p_percent_off integer)
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
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_percent_off IS NOT NULL AND (p_percent_off < 5 OR p_percent_off > 50) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick between 5% and 50% off.';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;

  IF p_percent_off IS NULL THEN
    DELETE FROM public.declutter_auto_liker_offers WHERE item_id = p_item_id AND seller_id = v_uid;
    RETURN NULL;
  END IF;

  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale can send offers.';
  END IF;
  IF v_item.current_price_cents IS NULL OR v_item.current_price_cents < 200 THEN
    RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023', HINT = 'This price is too low to take anything off.';
  END IF;
  v_amount := round(v_item.current_price_cents * (100 - p_percent_off) / 100.0)::integer;
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

  INSERT INTO public.declutter_auto_liker_offers (item_id, seller_id, percent_off)
  VALUES (p_item_id, v_uid, p_percent_off)
  ON CONFLICT (item_id) DO UPDATE SET percent_off = EXCLUDED.percent_off, updated_at = now();
  RETURN jsonb_build_object('percent_off', p_percent_off, 'amount_cents', v_amount);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_auto_liker_offer(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_liker_offer(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_set_auto_liker_offer(uuid, integer) IS
  'Owner 2026-11-25 (Depop-style): the seller turns "Auto-offer new savers" on at a percent off (5..50) or off (NULL).';

-- ---------------------------------------------------------------------------
-- 4. A new save gets the automatic offer (or nothing; the save itself always stands).
CREATE OR REPLACE FUNCTION public.declutter_auto_offer_new_saver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_pct smallint;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_amount integer;
  v_test_seller boolean;
  v_seller_name text;
  v_offer uuid;
BEGIN
  SELECT a.percent_off INTO v_pct FROM public.declutter_auto_liker_offers a WHERE a.item_id = NEW.item_id;
  IF v_pct IS NULL THEN
    RETURN NEW;
  END IF;
  -- The item row lock serializes this with a saver send and any offer answer on the item.
  SELECT * INTO v_item FROM public.declutter_items WHERE id = NEW.item_id FOR UPDATE;
  IF NOT FOUND OR v_item.status <> 'live' OR v_item.seller_hidden OR NEW.user_id = v_item.seller_id THEN
    RETURN NEW;
  END IF;
  IF v_item.current_price_cents IS NULL OR v_item.current_price_cents < 200 THEN
    RETURN NEW;
  END IF;
  v_amount := round(v_item.current_price_cents * (100 - v_pct) / 100.0)::integer;
  IF v_amount < 100 OR v_amount >= v_item.current_price_cents OR v_amount * 2 < v_item.current_price_cents THEN
    RETURN NEW;
  END IF;
  SELECT p.floor_price_cents INTO v_floor FROM public.declutter_item_private p WHERE p.item_id = NEW.item_id;
  IF v_floor IS NOT NULL AND v_amount < v_floor THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o
              WHERE o.item_id = NEW.item_id AND o.buyer_id = NEW.user_id AND (o.status = 'open' OR o.auto_liker)) THEN
    RETURN NEW;
  END IF;
  -- Review (2026-11-25): a seller out of Declutter (banned, strikes, under 18, business-like) sends nothing, so a rule
  -- set before that never sends offers declutter_respond_offer would refuse to accept.
  IF public.are_users_blocked(NEW.user_id, v_item.seller_id)
     OR public.declutter_seller_out(v_item.seller_id)
     OR public.declutter_member_out(NEW.user_id)
     OR NOT public.feature_enabled_for_user('declutter', NEW.user_id) THEN
    RETURN NEW;
  END IF;
  -- Q137 / owner rule: test data never reaches a real member.
  v_test_seller := v_item.is_seed
    OR COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = v_item.seller_id), false)
    OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v_item.seller_id);
  IF v_test_seller
     AND NOT COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = NEW.user_id), false)
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- The save always stands: the offer and its notice are one sub-block, and any error in it (say a buyer's own offer
  -- opened in the same instant, hitting declutter_offers_one_open_per_buyer) undoes only the offer, with a warning in
  -- the database log, never the heart tap. Review 2026-11-25.
  BEGIN
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, auto_liker)
  VALUES (NEW.item_id, NEW.user_id, v_item.seller_id, v_amount, 'buyer', now() + interval '48 hours', 0, true)
  RETURNING id INTO v_offer;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_offer, 'seller', 'offer', v_amount);
  SELECT public.member_display_name(pr.full_name, NULL) INTO v_seller_name FROM public.profiles pr WHERE pr.user_id = v_item.seller_id;
  PERFORM public.declutter_notice_ref(v_offer); -- Q2659: the notice opens this offer and retires once it is answered
  PERFORM public.declutter_notify(NEW.user_id, 'declutter_offers', 'Offer on an item you saved',
    CASE WHEN v_seller_name IS NOT NULL AND NOT public.declutter_names_hidden(NEW.user_id, v_item.seller_id)
      THEN format('%s offered you "%s" for $%s (was $%s). Accept, decline or send a different price within 48 hours.',
                  v_seller_name, v_item.title, to_char(v_amount / 100.0, 'FM999990.00'),
                  to_char(v_item.current_price_cents / 100.0, 'FM999990.00'))
      ELSE format('The seller offered you "%s" for $%s (was $%s). Accept, decline or send a different price within 48 hours.',
                  v_item.title, to_char(v_amount / 100.0, 'FM999990.00'),
                  to_char(v_item.current_price_cents / 100.0, 'FM999990.00')) END,
    '/declutter?tab=buying', v_item.seller_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_auto_offer_new_saver: item % saver %: %', NEW.item_id, NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_offer_new_saver() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_auto_offer_new_saver() TO service_role;
COMMENT ON FUNCTION public.declutter_auto_offer_new_saver() IS
  'Owner 2026-11-25 (Depop-style): a new save on a listing with "Auto-offer new savers" on gets one private offer (once per saver per item).';

DROP TRIGGER IF EXISTS declutter_watchlist_auto_offer ON public.declutter_watchlist;
CREATE TRIGGER declutter_watchlist_auto_offer
  AFTER INSERT ON public.declutter_watchlist
  FOR EACH ROW EXECUTE FUNCTION public.declutter_auto_offer_new_saver();
