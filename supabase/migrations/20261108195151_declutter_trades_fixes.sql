-- DECLUTTER TRADES FIXES (trades audit 11-08, High #1-#3 and Medium #4-#11; lead calls 11-08 by recommendation).
-- A trade is two $0 cart lines (declutter_respond_swap -> declutter_take_item at $0). Until now nothing on a line said
-- it came from a trade, so every free-item path treated a trade as a free claim. This marks the lines and branches on
-- the mark.
--
-- WHAT:
--   declutter_cart_items.swap_id (NEW)          the trade a $0 line belongs to. respond_swap stamps it on both lines.
--   declutter_swap_offers.reminded_at (NEW)     when the "12 hours left to answer" reminder went out (#11).
--   declutter_my_cart                           RESTATED: a trade line reads source 'swap' (same return shape) (#2).
--   declutter_checkout_free                     RESTATED (#1, #2, #8):
--       * a checkout that is only trade lines skips the $2 setup fee and keeps the once-per-account ID check
--         (declutter_identity_gate); a bundle with a real free claim keeps declutter_free_claim_gate as before;
--       * when the seller's lines include a trade line, only the $0 lines check out here, so a priced line from the
--         same seller stays in the cart for its card checkout (no more not_free_order dead end);
--       * trade wording on the two "checked out" notices.
--   trigger declutter_cart_items_swap_free_only (NEW): a trade line can only join a free ($0) order, so a mixed cart
--       never takes the traded item through a card checkout (start_checkout refuses: trade_checkout_first) (#8).
--   declutter_end_swap(swap, actor) (NEW, internal) ends an accepted trade at once: every line still in a cart is
--       released, a checked-out $0 trade order that is not handed over is closed with no strike, held-back money
--       offers on both items reopen, the trade is 'lapsed', and both sides get ONE trade notice (bell + email) (#2/#5).
--   declutter_seller_cancel_sale                RESTATED: backing out of a trade line ends the whole trade at once
--       with trade wording; no strike (no-show rules are not involved before a pickup is booked) (#5).
--   declutter_deadline_sweep                    RESTATED: the free branch reopens held-back money offers (#4) and, for
--       a trade line, sends no free-item notice and ends the trade at once instead (#2).
--   declutter_swap_sweep                        RESTATED: the lapse paths go through declutter_end_swap (offers on both
--       items reopen, #4); expired offers are emailed; the seller gets a "12 hours left" reminder (#11).
--   declutter_offer_swap / declutter_respond_swap RESTATED: the offer, accept and decline are emailed too, and accept
--       stamps swap_id on both lines (#2, #11).
--   declutter_swap_items_ok                     RESTATED: both items must allow a free pickup (porch or the seller's
--       home), since a trade checks out only through the free pickup; refused with trade_needs_pickup (#9).
--   declutter_void_swaps / declutter_items_void_swaps RESTATED, trigger widened to current_price_cents (#6, #7):
--       * an item that becomes free (auto-free sweep, a seller's price change) closes its open trades and its switch;
--       * an OFFERED item that is paused closes the trade (the seller could not see or accept it); a paused WANTED
--         item still keeps its offers, as before;
--       * the "trade offer closed" notice is emailed too.
--   declutter_remove_cart_item                  RESTATED: cart "Remove" on a trade line ends the whole trade at once.
--   GRANT SELECT (accepts_trades) TO anon + declutter_guest_preview / declutter_guest_first_screen /
--       declutter_first_screen RESTATED (+ accepts_trades): guests and members see
--       "Trades OK" (#3).
--
-- EMAIL: every trade email goes through send_notice_email (the send-notification-email function reads the member's
-- email_declutter_offers / email_declutter_sales preference and the seed boundary). A trade between test accounts
-- (declutter_swap_offers.is_seed) is never emailed at all.
-- MONEY: none moves. A trade order stays $0 / paid_with 'free'; the setup fee is skipped only for an all-trade
-- checkout; a card order is never closed by any trade path.
-- AUTHZ: member RPCs keep auth.uid() via declutter_assert_member / their own checks (a null uid raises); internal
-- helpers are service_role only (REVOKE ... FROM PUBLIC, anon, authenticated). The ID half of the free-claim gate keeps
-- its is_server_context / null-uid early return (declutter_identity_gate, unchanged).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- PROOF: src/test/pglite/declutterTradesFixes.pglite.mjs (NEW_MIGRATION=skip is red). For verdict: lh-money-escrow,
-- lh-authz-rls.

ALTER TABLE public.declutter_cart_items ADD COLUMN IF NOT EXISTS swap_id uuid
  REFERENCES public.declutter_swap_offers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS declutter_cart_items_swap_idx ON public.declutter_cart_items (swap_id) WHERE swap_id IS NOT NULL;
ALTER TABLE public.declutter_swap_offers ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
-- Lines made by trades accepted before this migration.
UPDATE public.declutter_cart_items c SET swap_id = s.id
  FROM public.declutter_swap_offers s
 WHERE c.id IN (s.buyer_line_id, s.seller_line_id) AND c.swap_id IS NULL;

-- ---------------------------------------------------------------------------
-- A trade notice: the bell (declutter_notify) and, unless the trade is between test accounts, an email.
CREATE OR REPLACE FUNCTION public.declutter_swap_tell(p_user uuid, p_type text, p_title text, p_message text,
  p_link text, p_other uuid, p_seed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.declutter_notify(p_user, p_type, p_title, p_message, p_link, p_other);
  IF NOT coalesce(p_seed, false) THEN
    PERFORM public.send_notice_email(p_user, p_title, p_message, p_type, p_link, NULL);
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- #8: a trade line only ever joins a free order. declutter_start_checkout links its lines with
-- UPDATE ... SET order_id, so a mixed cart that still holds a trade line is refused there with clear words.
CREATE OR REPLACE FUNCTION public.declutter_cart_items_swap_free_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.swap_id IS NOT NULL AND NEW.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id
     AND (SELECT o.paid_with FROM public.declutter_orders o WHERE o.id = NEW.order_id) IS DISTINCT FROM 'free' THEN
    RAISE EXCEPTION 'trade_checkout_first' USING ERRCODE = '55000',
      HINT = 'Choose your trade pickup first, then check out the rest.';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS declutter_cart_items_swap_free_only ON public.declutter_cart_items;
CREATE TRIGGER declutter_cart_items_swap_free_only
  BEFORE UPDATE OF order_id ON public.declutter_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_cart_items_swap_free_only();

-- ---------------------------------------------------------------------------
-- Ends an accepted trade at once (#2, #5). p_actor NULL: a side let its 48 hours run out (the sweeps);
-- otherwise the member who backed out. Returns false when the trade was not 'accepted' (already ended).
CREATE OR REPLACE FUNCTION public.declutter_end_swap(p_swap_id uuid, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  s record;
  c record;
  v_released integer := 0;
  v_title text;
  v_offered text;
  v_name text;
  v_msg text;
BEGIN
  -- Lock order: items (id order), then the trade row, then orders, then lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT f.item_id FROM public.declutter_swap_offers f WHERE f.id = p_swap_id
                  UNION ALL SELECT f.offered_item_id FROM public.declutter_swap_offers f WHERE f.id = p_swap_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO s FROM public.declutter_swap_offers f WHERE f.id = p_swap_id AND f.status = 'accepted' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  FOR c IN
    SELECT k.id, k.item_id, k.status, k.order_id, o.status AS order_status, o.paid_with
      FROM public.declutter_cart_items k LEFT JOIN public.declutter_orders o ON o.id = k.order_id
     WHERE k.id IN (s.buyer_line_id, s.seller_line_id)
     ORDER BY k.id
  LOOP
    IF c.status = 'in_cart' THEN
      IF c.order_id IS NOT NULL THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'trade_ended', closed_at = now()
         WHERE id = c.order_id AND status = 'awaiting_payment';
      END IF;
      UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = c.id AND status = 'in_cart';
      UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = c.item_id AND status = 'reserved';
      v_released := v_released + 1;
    ELSIF c.status = 'paid' AND c.order_status = 'paid' AND c.paid_with = 'free' THEN
      -- Checked out, not handed over: released with no strike (the side that checked out is not at fault). The
      -- order closes when the trade line was its only line still on it (declutter_close_paid_order's free branch,
      -- without its free-pickup notices: the trade notice below says it once).
      UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = c.id AND status = 'paid';
      UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = c.item_id AND status = 'sold';
      IF NOT EXISTS (SELECT 1 FROM public.declutter_cart_items z WHERE z.order_id = c.order_id AND z.status = 'paid') THEN
        UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now()
         WHERE id = c.order_id AND status = 'paid' AND paid_with = 'free';
      END IF;
      v_released := v_released + 1;
    END IF;
    -- #4: money offers the trade's hold voided reopen once the item is live again (a no-op otherwise).
    PERFORM public.declutter_reopen_voided_offers(c.id);
  END LOOP;
  UPDATE public.declutter_swap_offers SET status = 'lapsed', updated_at = now() WHERE id = p_swap_id AND status = 'accepted';

  SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = s.item_id;
  SELECT i.title INTO v_offered FROM public.declutter_items i WHERE i.id = s.offered_item_id;
  IF p_actor IS NOT NULL THEN
    SELECT public.member_display_name(p.full_name, 'The other person') INTO v_name FROM public.profiles p WHERE p.user_id = p_actor;
    v_msg := format('%s backed out of the trade of "%s" for "%s", so the trade is off. Both items are back up. Nobody gets a strike.',
                    coalesce(v_name, 'The other person'), coalesce(v_offered, 'an item'), coalesce(v_title, 'an item'));
    PERFORM public.declutter_swap_tell(CASE WHEN p_actor = s.buyer_id THEN s.seller_id ELSE s.buyer_id END,
      'declutter_sales', 'Trade cancelled', v_msg,
      CASE WHEN p_actor = s.buyer_id THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, p_actor, s.is_seed);
    PERFORM public.declutter_notify(p_actor, 'declutter_sales', 'Trade cancelled',
      format('You backed out of the trade of "%s" for "%s". Both items are back up. Nothing changed hands.',
             coalesce(v_offered, 'an item'), coalesce(v_title, 'an item')),
      '/declutter?tab=selling', CASE WHEN p_actor = s.buyer_id THEN s.seller_id ELSE s.buyer_id END);
  ELSIF v_released > 0 THEN
    v_msg := format('A pickup wasn''t chosen in time, so the trade of "%s" for "%s" ended. Both items are back up. Nobody gets a strike.',
                    coalesce(v_offered, 'an item'), coalesce(v_title, 'an item'));
    PERFORM public.declutter_swap_tell(s.buyer_id, 'declutter_sales', 'Trade ended, no strike', v_msg,
      '/declutter?tab=buying', s.seller_id, s.is_seed);
    PERFORM public.declutter_swap_tell(s.seller_id, 'declutter_sales', 'Trade ended, no strike', v_msg,
      '/declutter?tab=selling', s.buyer_id, s.is_seed);
  END IF;
  RETURN true;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261106163703 (the whole body): the "offered item" scope for a pause (#7), a free item (#6), and
-- the notice is emailed too (#11).
CREATE OR REPLACE FUNCTION public.declutter_void_swaps(p_item_id uuid, p_why text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.declutter_swap_offers s
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE s.status = 'open'
       AND (s.offered_item_id = p_item_id OR (s.item_id = p_item_id AND p_why IS DISTINCT FROM 'offered_paused'))
    RETURNING s.id, s.item_id, s.offered_item_id, s.buyer_id, s.seller_id, s.is_seed,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title
  LOOP
    v_n := v_n + 1;
    IF r.offered_item_id = p_item_id THEN
      -- The buyer's own item left the market: the seller's inbox entry goes away and the seller is told.
      PERFORM public.declutter_swap_tell(r.seller_id, 'declutter_offers', 'Trade offer closed',
        format('A trade offer for "%s" closed because the item offered is no longer available.', coalesce(r.title, 'your item')),
        '/declutter?tab=selling', r.buyer_id, r.is_seed);
    ELSE
      PERFORM public.declutter_swap_tell(r.buyer_id, 'declutter_offers', 'Trade offer closed',
        CASE WHEN p_why = 'trades_off'
             THEN format('The seller stopped taking trades on "%s", so your trade offer closed. Nothing changed hands.', coalesce(r.title, 'this item'))
             WHEN p_why = 'free'
             THEN format('"%s" is now free to claim, so your trade offer closed. Nothing changed hands.', coalesce(r.title, 'This item'))
             ELSE format('"%s" is no longer available, so your trade offer closed. Nothing changed hands.', coalesce(r.title, 'This item')) END,
        CASE WHEN p_why = 'free' THEN '/declutter/item/' || r.item_id::text ELSE '/declutter?tab=buying' END,
        r.seller_id, r.is_seed);
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

-- RESTATED from 20261106163703: also an offered item paused (#7) and an item made free (#6).
CREATE OR REPLACE FUNCTION public.declutter_items_void_swaps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF (NEW.status NOT IN ('live', 'paused') AND OLD.status IN ('live', 'paused'))
     OR (NEW.seller_hidden AND NOT OLD.seller_hidden) THEN
    PERFORM public.declutter_void_swaps(NEW.id, 'gone');
  ELSIF NEW.status = 'paused' AND OLD.status = 'live' THEN
    -- Paused keeps the offers on the seller's OWN item (they can still decline, and accept needs it live), but an
    -- offered item that is paused cannot be seen or accepted by the seller: that trade closes.
    PERFORM public.declutter_void_swaps(NEW.id, 'offered_paused');
  END IF;
  IF NEW.current_price_cents = 0 AND OLD.current_price_cents > 0 THEN
    PERFORM public.declutter_void_swaps(NEW.id, 'free');
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS declutter_items_void_swaps ON public.declutter_items;
CREATE TRIGGER declutter_items_void_swaps
  AFTER UPDATE OF status, seller_hidden, current_price_cents ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_void_swaps();

-- #6: a free item is claimed, not traded, so its switch goes off the moment it becomes free.
CREATE OR REPLACE FUNCTION public.declutter_items_free_no_trades()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.current_price_cents = 0 AND NEW.accepts_trades THEN
    NEW.accepts_trades := false;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS declutter_items_free_no_trades ON public.declutter_items;
CREATE TRIGGER declutter_items_free_no_trades
  BEFORE UPDATE OF current_price_cents, price_cents, accepts_trades ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_free_no_trades();

-- ---------------------------------------------------------------------------
-- RESTATED from 20261106163703 (the whole body): both items must allow a free pickup (#9).
CREATE OR REPLACE FUNCTION public.declutter_swap_items_ok(p_item_id uuid, p_offered_item_id uuid, p_buyer uuid)
RETURNS TABLE (o_seller_id uuid, o_title text, o_offered_title text, o_seed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_want record;
  v_give record;
BEGIN
  PERFORM 1 FROM public.declutter_items i WHERE i.id IN (p_item_id, p_offered_item_id) ORDER BY i.id FOR UPDATE;
  SELECT i.* INTO v_want FROM public.declutter_items i WHERE i.id = p_item_id;
  SELECT i.* INTO v_give FROM public.declutter_items i WHERE i.id = p_offered_item_id;
  IF v_want.id IS NULL OR v_want.seller_hidden
     OR (v_want.is_seed AND public.seed_hidden_for(p_buyer)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_give.id IS NULL OR v_give.seller_id IS DISTINCT FROM p_buyer THEN
    RAISE EXCEPTION 'offered_item_not_yours' USING ERRCODE = '22023', HINT = 'Pick one of your own listings to offer.';
  END IF;
  IF v_want.seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_seller_out(v_want.seller_id) OR public.are_users_blocked(v_want.seller_id, p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF public.declutter_member_out(p_buyer) OR v_give.seller_hidden THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_want.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer available.';
  END IF;
  IF v_give.status <> 'live' THEN
    RAISE EXCEPTION 'offered_item_not_available' USING ERRCODE = '55000', HINT = 'The item offered is no longer available.';
  END IF;
  IF v_want.current_price_cents = 0 OR v_give.current_price_cents = 0 THEN
    RAISE EXCEPTION 'free_item_no_trades' USING ERRCODE = '22023', HINT = 'Free items are claimed, not traded.';
  END IF;
  IF NOT v_want.accepts_trades THEN
    RAISE EXCEPTION 'trades_off' USING ERRCODE = '55000', HINT = 'This seller is not taking trades on this item.';
  END IF;
  -- CHANGED (#9): a trade checks out only as a free pickup (porch or the seller's home; declutter_checkout_free), so
  -- an item that allows neither would hold both items for 48 hours and always lapse. NULL handovers = every way.
  IF NOT public.declutter_item_free_pickup_ok(v_want.handovers, v_want.porch_ok)
     OR NOT public.declutter_item_free_pickup_ok(v_give.handovers, v_give.porch_ok) THEN
    RAISE EXCEPTION 'trade_needs_pickup' USING ERRCODE = '22023',
      HINT = 'Trades are picked up from the porch or at home. One of these items isn''t set up for pickup.';
  END IF;
  o_seller_id := v_want.seller_id;
  o_title := v_want.title;
  o_offered_title := v_give.title;
  o_seed := v_want.is_seed OR v_give.is_seed;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.declutter_item_free_pickup_ok(p_handovers text[], p_porch_ok boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_handovers IS NULL
      OR 'pickup_home' = ANY (p_handovers)
      OR ('porch' = ANY (p_handovers) AND coalesce(p_porch_ok, true));
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261106163703 (the whole body): the new offer is emailed to the seller too (#11).
CREATE OR REPLACE FUNCTION public.declutter_offer_swap(p_item_id uuid, p_offered_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_ok record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_item_id IS NULL OR p_offered_item_id IS NULL OR p_item_id = p_offered_item_id THEN
    RAISE EXCEPTION 'invalid_trade' USING ERRCODE = '22023';
  END IF;
  -- The ID rule (OWNER-DECISIONS): the buyer's first purchase. A trader is a lister, so this normally passes at once.
  PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');
  SELECT * INTO v_ok FROM public.declutter_swap_items_ok(p_item_id, p_offered_item_id, v_uid);

  -- Unswept past-due offers never block a new one.
  UPDATE public.declutter_swap_offers SET status = 'expired', closed_at = now(), updated_at = now()
   WHERE status = 'open' AND respond_by <= now()
     AND ((item_id = p_item_id AND buyer_id = v_uid) OR offered_item_id = p_offered_item_id);
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.item_id = p_item_id AND s.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'trade_already_open' USING ERRCODE = '55000',
      HINT = 'You already offered a trade for this item. Wait for the answer or take it back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_swap_offers s
              WHERE s.status = 'open' AND s.offered_item_id = p_offered_item_id) THEN
    RAISE EXCEPTION 'offered_item_in_trade' USING ERRCODE = '55000',
      HINT = 'That item is already offered in another trade. Take that offer back first, or pick another item.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_swap_offers s
       WHERE s.buyer_id = v_uid AND s.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'trade_rate_limited' USING ERRCODE = '54000', HINT = 'You can offer 10 trades a day.';
  END IF;

  INSERT INTO public.declutter_swap_offers (item_id, offered_item_id, buyer_id, seller_id, respond_by, is_seed)
  VALUES (p_item_id, p_offered_item_id, v_uid, v_ok.o_seller_id, now() + interval '48 hours', coalesce(v_ok.o_seed, false))
  RETURNING id INTO v_id;
  -- CHANGED (#11): bell and email.
  PERFORM public.declutter_swap_tell(v_ok.o_seller_id, 'declutter_offers', 'New trade offer',
    format('%s offered "%s" in trade for "%s". Accept or decline within 48 hours. No money changes hands.',
           coalesce((SELECT public.member_display_name(p.full_name, 'A buyer') FROM public.profiles p WHERE p.user_id = v_uid), 'A buyer'),
           v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=selling', v_uid, coalesce(v_ok.o_seed, false));
  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261106163703 (the whole body): accept stamps swap_id on both lines (#2); accept and decline are
-- emailed too (#11).
CREATE OR REPLACE FUNCTION public.declutter_respond_swap(p_swap_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  s record;
  v_ok record;
  v_buyer_line uuid;
  v_seller_line uuid;
  v_name text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.declutter_swap_offers f
   WHERE f.id = p_swap_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF (p_action = 'withdraw') <> (s.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'accept' THEN
    -- Lock order: both items (id order, inside the check), then the trade row.
    SELECT * INTO v_ok FROM public.declutter_swap_items_ok(s.item_id, s.offered_item_id, s.buyer_id);
  END IF;
  SELECT * INTO s FROM public.declutter_swap_offers f WHERE f.id = p_swap_id FOR UPDATE;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'trade_not_open' USING ERRCODE = '55000', HINT = 'This trade offer is already closed.';
  END IF;

  IF p_action = 'withdraw' THEN
    UPDATE public.declutter_swap_offers SET status = 'withdrawn', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
    PERFORM public.declutter_notify(s.seller_id, 'declutter_offers', 'Trade offer withdrawn',
      format('The buyer took back their trade offer for "%s".',
             (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id)),
      '/declutter?tab=selling', s.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF s.respond_by <= now() THEN
    RAISE EXCEPTION 'trade_expired' USING ERRCODE = '55000', HINT = 'This trade offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_swap_offers SET status = 'declined', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
    -- One wording for every decline (B26): never says why. CHANGED (#11): bell and email.
    PERFORM public.declutter_swap_tell(s.buyer_id, 'declutter_offers', 'Trade offer declined',
      format('Your trade offer for "%s" was declined. Nothing changed hands.',
             (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id)),
      '/declutter/item/' || s.item_id::text, v_uid, s.is_seed);
    RETURN 'declined';
  END IF;

  -- accept. The trade row closes FIRST, so the item trigger (fired by take_item reserving the items) voids only the
  -- OTHER open trades naming either item.
  IF public.member_under_18(s.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_swap_offers SET status = 'accepted', closed_at = now(), updated_at = now() WHERE id = p_swap_id;
  -- take_item's own free-claim notices are skipped (the setting it already honours, 20261104124645); this sends one each.
  PERFORM set_config('declutter.bundle_take', 'on', true);
  v_buyer_line := public.declutter_take_item(s.item_id, s.buyer_id, 0, 'buy', NULL);
  v_seller_line := public.declutter_take_item(s.offered_item_id, s.seller_id, 0, 'buy', NULL);
  PERFORM set_config('declutter.bundle_take', '', true);
  UPDATE public.declutter_swap_offers SET buyer_line_id = v_buyer_line, seller_line_id = v_seller_line WHERE id = p_swap_id;
  -- CHANGED (#2): both lines say they are a trade, so every free-item path can tell them apart.
  UPDATE public.declutter_cart_items SET swap_id = p_swap_id WHERE id IN (v_buyer_line, v_seller_line);

  SELECT public.member_display_name(p.full_name, 'The seller') INTO v_name FROM public.profiles p WHERE p.user_id = s.seller_id;
  PERFORM public.declutter_notice_ref(v_buyer_line); -- Q2659
  -- CHANGED (#11): the buyer's "accepted" is emailed too.
  PERFORM public.declutter_swap_tell(s.buyer_id, 'declutter_sales', 'Trade accepted: choose a pickup within 48 hours',
    format('%s accepted your trade: "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           coalesce(v_name, 'The seller'), v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=buying', s.seller_id, s.is_seed);
  PERFORM public.declutter_notice_ref(v_seller_line); -- Q2659
  PERFORM public.declutter_notify(s.seller_id, 'declutter_sales', 'Trade set: choose a pickup within 48 hours',
    format('You traded "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           v_ok.o_title, v_ok.o_offered_title),
    '/declutter?tab=selling', s.buyer_id);
  RETURN 'accepted';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261106184913 (the whole body). CHANGED: the lapse paths go through declutter_end_swap (one trade
-- notice, held-back offers on both items reopen: #4); expired offers are emailed; a "12 hours left" reminder (#11).
CREATE OR REPLACE FUNCTION public.declutter_swap_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_lapsed integer := 0;
  v_done integer := 0;
BEGIN
  FOR r IN
    UPDATE public.declutter_swap_offers s SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE s.status = 'open' AND s.respond_by <= now()
    RETURNING s.id, s.buyer_id, s.seller_id, s.item_id, s.is_seed,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title
  LOOP
    v_expired := v_expired + 1;
    PERFORM public.declutter_swap_tell(r.buyer_id, 'declutter_offers', 'Trade offer expired',
      format('The seller did not answer your trade offer for "%s" within 48 hours, so it closed. Nothing changed hands.', coalesce(r.title, 'an item')),
      '/declutter/item/' || r.item_id::text, r.seller_id, r.is_seed);
  END LOOP;

  -- CHANGED (#11): 12 hours before the answer window ends, the seller is reminded once.
  FOR r IN
    UPDATE public.declutter_swap_offers s SET reminded_at = now()
     WHERE s.status = 'open' AND s.reminded_at IS NULL
       AND s.respond_by > now() AND s.respond_by <= now() + interval '12 hours'
    RETURNING s.id, s.buyer_id, s.seller_id, s.is_seed,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.offered_item_id) AS offered_title
  LOOP
    v_reminded := v_reminded + 1;
    PERFORM public.declutter_swap_tell(r.seller_id, 'declutter_offers', 'Trade offer: about 12 hours left',
      format('You have about 12 hours left to answer the trade offer of "%s" for "%s". If you don''t answer, it closes.',
             coalesce(r.offered_title, 'an item'), coalesce(r.title, 'your item')),
      '/declutter?tab=selling', r.buyer_id, r.is_seed);
  END LOOP;

  -- Both orders handed over: the trade is done (slice 4, unchanged).
  UPDATE public.declutter_swap_offers s SET status = 'completed', updated_at = now()
   WHERE s.status = 'accepted'
     AND (SELECT count(*) FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
           WHERE c.id IN (s.buyer_line_id, s.seller_line_id) AND c.status = 'paid' AND o.status = 'handed_over') = 2;
  GET DIAGNOSTICS v_done = ROW_COUNT;

  -- CHANGED: one side's line ended unfinished (its 48 hours ran out, it was cancelled, or its order closed without a
  -- handover). declutter_end_swap releases what is still held (a line in a cart; a checked-out free order not yet
  -- handed over, no strike), reopens held-back offers, marks the trade 'lapsed' and tells both sides once. An order
  -- already handed over is never undone; a card order is never touched.
  FOR r IN
    SELECT s.id FROM public.declutter_swap_offers s
     WHERE s.status = 'accepted'
       AND EXISTS (SELECT 1 FROM public.declutter_cart_items c
                    WHERE c.id IN (s.buyer_line_id, s.seller_line_id) AND c.status NOT IN ('in_cart', 'paid'))
  LOOP
    BEGIN
      IF public.declutter_end_swap(r.id, NULL) THEN
        v_lapsed := v_lapsed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'declutter_swap_sweep: trade % not ended: %', r.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_swap_sweep', r.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'reminded', v_reminded, 'lapsed', v_lapsed, 'completed', v_done);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_swap_tell(uuid, text, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_tell(uuid, text, text, text, text, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_cart_items_swap_free_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.declutter_end_swap(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_end_swap(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_void_swaps(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_void_swaps(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_items_void_swaps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.declutter_items_free_no_trades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.declutter_swap_items_ok(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_items_ok(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_item_free_pickup_ok(text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_free_pickup_ok(text[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_offer_swap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_offer_swap(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_respond_swap(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_swap(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_swap_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261101175510_declutter_buying_lists_hide_seed.sql (the whole body). CHANGED (#2): a trade line reads source 'swap'.

CREATE OR REPLACE FUNCTION public.declutter_my_cart()
 RETURNS TABLE(line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid, price_cents integer, status text, checkout_by timestamp with time zone, order_id uuid, order_status text, handover text, premium_cents integer, total_cents integer, porch_ok boolean, delivery_cents integer, delivery_task_id uuid, handovers text[], closed_at timestamp with time zone, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id,
         -- DC-18: the title kept on the line once the listing is gone; "former member" only when the seller's account is.
         COALESCE(i.title, c.item_title,
                  CASE WHEN c.seller_id IS NULL THEN 'An item from a former member' ELSE 'A listing that was taken down' END),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         -- Q2427: a line still in the cart shows its original price (a bundle discount is applied at checkout).
         c.seller_id, CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END,
         c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id, i.handovers,
         c.closed_at,  -- DC-18: when an ended line ended
         CASE WHEN c.swap_id IS NOT NULL THEN 'swap' ELSE c.source END  -- DB-5; CHANGED (trades #2): 'swap' = a trade line
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
     -- A test item stays out of a non-test viewer's cart (the items read policy's rule; its seller still sees it).
     AND (i.id IS NULL OR NOT i.is_seed OR c.seller_id = v_uid OR NOT public.seed_hidden_in_discovery())
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$function$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261103224955_q2390_move_drafts_haul_away_free_pick_ai_check_checkout_not_found_is_404.sql (the whole body). CHANGED (#1, #2, #8), marked below.

CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_taker text;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
  v_place public.declutter_porch_places%ROWTYPE;
  v_has_swap boolean;  -- trades #8
  v_all_swap boolean;  -- trades #1
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  -- CHANGED (trades #8): when this seller's lines include a trade line, only the $0 lines check out here; a priced
  -- line from the same seller stays in the cart for its card checkout (a trade line can never join a card order).
  v_has_swap := EXISTS (SELECT 1 FROM public.declutter_cart_items c
                         WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
                           AND c.checkout_by > now() AND c.swap_id IS NOT NULL);
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() AND (c2.price_cents = 0 OR NOT v_has_swap) ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now() AND (c.price_cents = 0 OR NOT v_has_swap);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Owner 2026-10-30: a first-timer the giver picked pays the one-time fee, then verifies, before the address opens.
  -- CHANGED (trades #1, lead 11-08): a trade never charges the $2 setup fee. A checkout that is only trade lines keeps
  -- the once-per-account ID check (its is_server_context / null-uid early return unchanged) and skips the fee half.
  v_all_swap := NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c WHERE c.id = ANY (v_lines) AND c.swap_id IS NULL);
  IF v_all_swap THEN
    PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');
  ELSE
    PERFORM public.declutter_free_claim_gate(v_uid);
  END IF;
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  IF public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (20261030164712): a free porch pickup from a seller with saved places is at the place the buyer picked.
  IF p_handover IN ('porch', 'pickup_home')
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
  END IF;
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  -- CHANGED (trades #2): a trade pickup says trade, never "free item".
  IF v_has_swap THEN
    PERFORM public.declutter_notify(v_uid, 'payment', 'Trade pickup set',
      'Your trade pickup is set. Next: choose when to pick it up. No money changes hands.',
      '/declutter?view=cart', p_seller_id);
    PERFORM public.declutter_notify(p_seller_id, 'payment', 'Trade pickup chosen',
      COALESCE(v_taker, 'Someone') || ' chose how to pick up their trade item. No money changes hands.',
      '/declutter?tab=selling', v_uid);
  ELSE
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_order;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261103221614_q2390_review_refund_withdraw_no_show_cancel_book_not_found_is_404.sql (the whole body). CHANGED (#5): backing out of a trade line.

CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_sale(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_line record;
BEGIN
  -- Not strike/age/switch-gated: anyone may back out (and takes the strike, unless the line is free: B100).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Ownership before any lock (lh-authz-rls review 3b #4): with no switch gate,
  -- a stranger must not be able to lock someone else's items, even briefly.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = p_item_id
      OR i.id IN (SELECT c2.item_id FROM public.declutter_cart_items c2
                   WHERE c2.order_id = (SELECT c.order_id FROM public.declutter_cart_items c
                                         WHERE c.item_id = p_item_id AND c.status = 'in_cart'))
   ORDER BY i.id FOR UPDATE;
  SELECT i.id, i.status, i.title INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT c.* INTO v_line FROM public.declutter_cart_items c
   WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_sale_to_cancel' USING ERRCODE = '55000';
  END IF;
  IF v_line.status = 'paid' THEN
    RAISE EXCEPTION 'sale_already_paid' USING ERRCODE = '55000',
      HINT = 'The buyer already paid. Contact support to cancel.';
  END IF;
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_cancelled', closed_at = now()
     WHERE id = v_line.order_id AND status = 'awaiting_payment';
  END IF;
  UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
   WHERE id = v_line.id AND status = 'in_cart';
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = v_line.order_id AND status = 'in_cart';
  END IF;
  -- CHANGED (trades #5, lead 11-08): backing out of a trade ends the WHOLE trade now, with trade wording, and no
  -- strike (no pickup was booked, so the no-show rules do not apply). The item goes back up first, so the money
  -- offers its hold voided reopen (#4).
  IF v_line.swap_id IS NOT NULL THEN
    UPDATE public.declutter_items SET status = CASE WHEN public.declutter_seller_out(v_uid) THEN 'withdrawn' ELSE 'live' END,
           updated_at = now()
     WHERE id = p_item_id AND status = 'reserved';
    PERFORM public.declutter_reopen_voided_offers(v_line.id);
    PERFORM public.declutter_end_swap(v_line.swap_id, v_uid);
    RETURN public.declutter_active_strike_count(v_uid);
  END IF;
  -- B100: a free claim goes back up with no strike for anyone (a seller who is out of Declutter cannot have a live
  -- listing, so theirs comes down as before), and the person who claimed it is told so.
  IF v_line.price_cents = 0 THEN
    IF public.declutter_seller_out(v_uid) THEN
      UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s". Nothing was charged and you get no strike.', v_item.title),
        '/declutter?tab=buying', v_uid);
    ELSE
      UPDATE public.declutter_items SET status = 'live', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s", so it went back up. Nothing was charged and you get no strike.', v_item.title),
        '/declutter/item/' || p_item_id::text, v_uid);
    END IF;
    RETURN public.declutter_active_strike_count(v_uid);
  END IF;
  UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
   WHERE id = p_item_id AND status = 'reserved';
  -- D2-16: only an unpaid sale gets here (sale_already_paid above), so nothing was charged.
  PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
    format('The seller cancelled the sale of "%s". Nothing was charged.', v_item.title), '/declutter?view=cart', v_uid);
  -- D2-10: "after accepting it" only when the seller accepted an offer; a Buy now had nothing to accept.
  RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,
    CASE WHEN v_line.source = 'offer'
         THEN format('You cancelled the sale of "%s" after accepting it.', v_item.title)
         ELSE format('You cancelled the sale of "%s".', v_item.title) END, v_line.id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RESTATED from 20261102031228_declutter_reminders_retry_strict.sql (the whole body). CHANGED in the free branch only (#2, #4).

CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  v_unstruck integer := 0;
  v_talked integer := 0;
  v_free_missed integer := 0;
  v_buy_missed integer := 0;  -- DB-5
  v_reopened integer := 0;  -- BUY-1
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    -- E2-7: both sides are told which item. The old words stay only for an offer whose item row is gone.
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.title IS NULL THEN
             CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
                  ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END
           WHEN r.awaiting = 'seller' THEN format('The seller did not answer your offer on "%s" within 48 hours, so it closed. Nothing was charged.', r.title)
           ELSE format('You did not answer the counteroffer on "%s" within 48 hours, so it closed.', r.title) END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.title IS NULL THEN
             CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
                  ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END
           WHEN r.awaiting = 'seller' THEN format('You did not answer an offer on "%s" within 48 hours, so it closed.', r.title)
           ELSE format('The buyer did not answer your counteroffer on "%s" within 48 hours, so it closed.', r.title) END,
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
       -- BUY-1: only a hold longer than 24 hours (a free claim's 48) gets the 24-hour reminder; a 24-hour offer hold
       -- was told at the start, and a 30-minute Buy now hold has no time for it.
       AND c.checkout_by - c.created_at > interval '24 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.id, c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
   -- Q2465: the reminder IS this step: sent strict; a failure clears this line's claim so the next run retries it.
   BEGIN
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours',
        CASE WHEN r.title IS NULL THEN 'Your free item is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.'
             ELSE format('"%s" is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',
        CASE WHEN r.title IS NULL THEN 'You have an item waiting at checkout. Pay within 24 hours or it goes back up for sale.'
             ELSE format('"%s" is waiting at checkout. Pay within 24 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',
      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.'
           ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END,
      '/declutter?tab=buying');
    END IF;
    v_r24 := v_r24 + 1;
   EXCEPTION WHEN OTHERS THEN
    -- The block's own savepoint undid the reminder; the claim is cleared here, outside it, so the next run sends it.
    UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id;
    PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_24h:' || r.id::text, SQLERRM);
   END;
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
       -- BUY-1: a 30-minute Buy now hold (even one checkout stretched to its Stripe page) gets no 2-hour reminder.
       AND c.checkout_by - c.created_at > interval '2 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.id, c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
   -- Q2465: the reminder IS this step: sent strict; a failure clears this line's claim so the next run retries it.
   BEGIN
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', '2 hours left to choose a pickup',
        CASE WHEN r.title IS NULL THEN 'Choose how you''ll pick up your free item in the next 2 hours or it goes back up.'
             ELSE format('Choose how you''ll pick up "%s" in the next 2 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', '2 hours left to check out',
        CASE WHEN r.title IS NULL THEN 'Pay in the next 2 hours or the item goes back up for sale.'
             ELSE format('Pay for "%s" in the next 2 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', '2 hours left to check out',
      CASE WHEN r.title IS NULL THEN 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.'
           ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,
      '/declutter?tab=buying');
    END IF;
    v_r2 := v_r2 + 1;
   EXCEPTION WHEN OTHERS THEN
    -- The block's own savepoint undid the reminder; the claim is cleared here, outside it, so the next run sends it.
    UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id;
    PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_2h:' || r.id::text, SQLERRM);
   END;
  END LOOP;

  -- Missed checkouts. Lock order items -> orders -> lines, one line at a time.
  FOR r IN
    SELECT c.id, c.item_id
      FROM public.declutter_cart_items c
     WHERE c.status = 'in_cart' AND c.checkout_by <= now()
     ORDER BY c.item_id
  LOOP
    PERFORM 1 FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
    SELECT c.*, i.title INTO v_line
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = r.id;
    IF v_line.status <> 'in_cart' THEN CONTINUE; END IF;
    -- Grace (BUY-1): starting checkout stretches the hold to its Stripe page's end
    -- (declutter_attach_checkout_session), so a payable order only gets 10 min
    -- past the deadline for Stripe's paid event to arrive. A payment that lands
    -- after the hold is released is refunded in full (declutter_mark_order_paid).
    IF v_line.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                      AND v_line.checkout_by > now() - interval '10 minutes') THEN
      CONTINUE;
    END IF;
    BEGIN
      -- Who stopped this checkout? A seller who blocked the buyer backed out
      -- (row 19: seller strike); a seller who can no longer sell ends it with
      -- no strike for the buyer; otherwise the buyer missed it (rows 7, 59).
      -- user_blocks is read directly: are_users_blocked() answers only for
      -- parties or server context.
      IF EXISTS (SELECT 1 FROM public.user_blocks b
                  WHERE b.blocker_id = v_line.seller_id AND b.blocked_id = v_line.buyer_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_blocked', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
          format('The seller cancelled the sale of "%s". You were not charged and you get no strike.', v_line.title),
          '/declutter?tab=buying', v_line.seller_id);
        PERFORM public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers', v_line.item_id,
          format('You blocked the buyer of "%s" after the sale, which cancels it.', v_line.title), v_line.id);
      ELSIF public.declutter_seller_out(v_line.seller_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_out', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'ended', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'This sale was cancelled',
          format('"%s" can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),
          '/declutter?tab=buying');
      -- 20261028235249 (owner 2026-10-28, Q2462 #3730): the two talked about the handover and no way that always
      -- works was shared, so the buyer could not check out: the sale ends with no strike for anyone.
      ELSIF public.declutter_pair_needs_talk(v_line.buyer_id, v_line.seller_id)
            AND EXISTS (SELECT 1 FROM public.declutter_handover_talks t
                         WHERE t.buyer_id = v_line.buyer_id AND t.seller_id = v_line.seller_id
                           AND t.opened_at >= v_line.created_at) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_talked := v_talked + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the seller didn''t find a way to hand over "%s", so the sale ended. You were not charged and nobody gets a strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the buyer didn''t find a way to hand over "%s", so the sale ended and it is back up for sale. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      -- DA-12 (owner 2026-10-29): a free item whose 48 hours ran out goes back up with no strike for anyone.
      ELSIF v_line.price_cents = 0 THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_free_missed := v_free_missed + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          -- CHANGED (trades #4): money offers a $0 hold voided (a trade line's) reopen; a no-op for a real free item.
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);
          -- CHANGED (trades #2): a trade line sends no free-item notice; the whole trade ends now, told once.
          IF v_line.swap_id IS NOT NULL THEN
            PERFORM public.declutter_end_swap(v_line.swap_id, NULL);
          ELSE
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Free item went back up',
            format('You didn''t choose a pickup for "%s" within 48 hours, so it went back up. You get no strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Free item is back up',
            format('The person getting "%s" didn''t choose a pickup within 48 hours, so it is back up. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
          END IF;
        END IF;
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout, and backing out before paying is no strike.
      -- An accepted offer (source 'offer') still falls through to the strike below.
      ELSIF v_line.source = 'buy' THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_buy_missed := v_buy_missed + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
            format('You didn''t pay for "%s" in time, so it went back up for sale. You were not charged and you get no strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      ELSE
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_missed := v_missed + 1;
          -- Back on sale (rows 13/59).
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          IF public.feature_enabled_for_user('declutter', v_line.buyer_id) THEN
            -- BUY-1: "in time", since an accepted offer now has 24 hours (a line made before this has 48).
            PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
              format('You did not check out "%s" in time.', v_line.title), v_line.id);
          ELSE
            -- Row 62: the switch was turned off for this buyer mid-sale.
            v_unstruck := v_unstruck + 1;
            PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
              format('Checkout for "%s" closed. You were not charged and you get no strike.', v_line.title),
              '/declutter?tab=buying', v_line.seller_id);
          END IF;
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad line never stops every other missed checkout; it is retried
      -- on the next run (the line is still in_cart) and filed where ops reads it.
      PERFORM public.log_cron_defect('declutter_deadline_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- 20261028235249: talks past their 72 hours close (after the lines above were judged with them).
  UPDATE public.declutter_handover_talks SET closed_at = now()
   WHERE closed_at IS NULL AND expires_at <= now();

  RETURN jsonb_build_object('offers_expired', v_expired, 'reminded_24h', v_r24,
                            'reminded_2h', v_r2, 'checkouts_missed', v_missed, 'missed_without_strike', v_unstruck,
                            'ended_after_talk', v_talked, 'free_missed_without_strike', v_free_missed,
                            'buy_missed_without_strike', v_buy_missed,  -- DB-5
                            'offers_reopened', v_reopened);  -- BUY-1
END;
$function$;

-- ---------------------------------------------------------------------------
-- Trades audit 11-08, last items (lead 11-08):
--   Cart "Remove" on a trade line ends the WHOLE trade at once (declutter_end_swap, as "Back out of trade" does), not
--   at the next :47 sweep. declutter_remove_cart_item RESTATED from 20261103173728 (prod md5(prosrc) equal to it,
--   measured 11-08). CHANGED: a trade line locks both trade items in id order first (end_swap's own order, so a
--   remove and a back-out never deadlock), and sends no "Back on sale" notice (end_swap says it once, as a trade).
--   #3 "Trades OK" for guests: anon may read accepts_trades (a public listing fact, like accepts_offers, which anon
--   already reads) and declutter_guest_preview names it. declutter_guest_preview RESTATED from 20261107212823 (prod
--   md5(prosrc) equal to it, measured 11-08). CHANGED: + i.accepts_trades. The GRANT comes first: the function is
--   SECURITY INVOKER, so anon must hold the column before it names it.
GRANT SELECT (accepts_trades) ON public.declutter_items TO anon;

CREATE OR REPLACE FUNCTION public.declutter_guest_preview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH ranked AS (
    SELECT i.id, i.seller_id, i.status, i.title, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
           i.porch_ok, i.accepts_offers, i.accepts_trades, i.sale_mode, i.last_price_drop_on, i.drop_pct, i.drops_stopped
      FROM public.declutter_items i
     WHERE i.status IN ('live', 'reserved')
     ORDER BY i.live_at DESC
     LIMIT 25
  ),
  items AS (
    SELECT * FROM ranked ORDER BY live_at DESC LIMIT 24
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC) FROM items t), '[]'::jsonb),
    'more', (SELECT count(*) FROM ranked) > 24,
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id IN (SELECT id FROM items)
    ), '[]'::jsonb)
  );
$fn$;
REVOKE ALL ON FUNCTION public.declutter_guest_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_preview() TO anon, service_role;

-- declutter_guest_first_screen RESTATED from 20261107172400 (prod md5(prosrc) equal to it, measured 11-08): the
-- guest's whole list when there is no preview, taken as the list itself, so it names accepts_trades too. CHANGED:
-- + i.accepts_trades (its columns stay a copy of ITEM_COLUMNS, src/boot/guestDeclutterPrefetch.test.ts).
CREATE OR REPLACE FUNCTION public.declutter_guest_first_screen()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH items AS (
    SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
           i.porch_ok, i.accepts_offers, i.accepts_trades
      FROM public.declutter_items i
     WHERE i.status IN ('live', 'reserved')
     ORDER BY i.live_at DESC
     LIMIT 500
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC) FROM items t), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id IN (SELECT id FROM items)
    ), '[]'::jsonb)
  );
$fn$;
REVOKE ALL ON FUNCTION public.declutter_guest_first_screen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_first_screen() TO anon, service_role;

-- declutter_first_screen RESTATED from 20261101092004 (prod md5(prosrc) equal to it, measured 11-08): a member's cold
-- /declutter answer names every ITEM_COLUMNS column (src/boot/declutterPrefetch.test.ts), so + i.accepts_trades.
-- Nothing else changed; it stays SECURITY INVOKER (the member's own row policies) and authenticated-only.
CREATE OR REPLACE FUNCTION public.declutter_first_screen(p_switch_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cap constant integer := 24;
  v_me uuid := (SELECT auth.uid());
  v_switches jsonb;
  v_lat double precision;
  v_lng double precision;
  v_zip text;
  v_parish text;
  v_zip_parish text;
  v_has_position boolean;
  v_rows jsonb[];
  v_items jsonb;
  v_ids uuid[];
  v_sellers uuid[];
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_switches := public.feature_switches_for_me(COALESCE(p_switch_keys, '{}'::text[]));

  -- The profile's own position; both or neither, as deriveFallbackLocation reads it.
  SELECT CASE WHEN p.longitude IS NOT NULL THEN p.latitude::double precision END,
         CASE WHEN p.latitude IS NOT NULL THEN p.longitude::double precision END,
         left(regexp_replace(COALESCE(p.zip_code, ''), '[^0-9]', '', 'g'), 5),
         p.parish
    INTO v_lat, v_lng, v_zip, v_parish
    FROM public.profiles p
   WHERE p.user_id = v_me;
  v_has_position := v_lat IS NOT NULL;

  -- B82: no position on file. The browser then measures from the ZIP's parish, else the profile's parish
  -- (deriveFallbackLocation's rungs 2 and 3), at src/lib/parishCentroids.ts's point for it (getParishCentroid: a
  -- trailing " Parish" dropped, the name matched exactly). Sort from that same point, so the capped answer is the top
  -- of the list the browser draws and Browse can show it before the full read. The table is a COPY of
  -- PARISH_CENTROIDS; src/test/declutterFirstScreenParishOrigin.test.ts holds the two equal.
  IF NOT v_has_position THEN
    IF length(v_zip) = 5 THEN
      v_zip_parish := public.get_parish_for_zip(v_zip);
    END IF;
    SELECT c.lat, c.lng INTO v_lat, v_lng
      FROM (VALUES
        ('Orleans', 29.9511, -90.0715),
        ('Jefferson', 29.9494, -90.1486),
        ('St. Tammany', 30.4218, -89.9986),
        ('East Baton Rouge', 30.4583, -91.1403),
        ('Lafayette', 30.2241, -92.0198),
        ('Caddo', 32.5776, -93.8773),
        ('Calcasieu', 30.2266, -93.2174),
        ('Ouachita', 32.4807, -92.1193),
        ('Rapides', 31.2911, -92.4451),
        ('Bossier', 32.5232, -93.6629),
        ('Tangipahoa', 30.6260, -90.4290),
        ('St. Bernard', 29.7574, -89.7892),
        ('Plaquemines', 29.4716, -89.6553),
        ('Livingston', 30.4441, -90.7301),
        ('Ascension', 30.2046, -90.9046),
        ('Iberia', 30.0085, -91.8276),
        ('Lafourche', 29.4513, -90.3085),
        ('Terrebonne', 29.5833, -90.7050),
        ('St. Charles', 29.9358, -90.3661),
        ('Vermilion', 29.8732, -92.2987),
        ('St. Landry', 30.6905, -92.0123),
        ('Acadia', 30.2775, -92.4111),
        ('Natchitoches', 31.7232, -93.0860),
        ('Webster', 32.7184, -93.3360),
        ('Beauregard', 30.6477, -93.3500),
        ('Allen', 30.6486, -92.8294),
        ('St. Mary', 29.6377, -91.4490),
        ('Pointe Coupee', 30.7088, -91.5969),
        ('St. Martin', 30.1271, -91.6021),
        ('St. James', 30.0289, -90.7929),
        ('St. John the Baptist', 30.1247, -90.4892),
        ('Washington', 30.8478, -90.0411),
        ('Avoyelles', 31.0658, -92.0061),
        ('Evangeline', 30.7349, -92.4142),
        ('Vernon', 31.1080, -93.1834),
        ('Sabine', 31.5650, -93.5520),
        ('DeSoto', 32.0596, -93.7397),
        ('Bienville', 32.3504, -92.9899),
        ('Jackson', 32.2989, -92.5595),
        ('Lincoln', 32.6053, -92.6629),
        ('Union', 32.8323, -92.3713),
        ('Morehouse', 32.8156, -91.7929),
        ('West Carroll', 32.7951, -91.4489),
        ('East Carroll', 32.7333, -91.2358),
        ('Madison', 32.3633, -91.2275),
        ('Tensas', 32.0036, -91.3433),
        ('Concordia', 31.4424, -91.6379),
        ('Catahoula', 31.6628, -91.8551),
        ('LaSalle', 31.6747, -92.1597),
        ('Grant', 31.5949, -92.5638),
        ('Winn', 31.9460, -92.6402),
        ('Caldwell', 32.0921, -92.1225),
        ('Franklin', 32.1304, -91.6749),
        ('Richland', 32.4131, -91.7654),
        ('West Baton Rouge', 30.4661, -91.3145),
        ('Iberville', 30.3164, -91.3469),
        ('West Feliciana', 30.8772, -91.4044),
        ('East Feliciana', 30.8442, -91.0429),
        ('St. Helena', 30.8175, -90.7068),
        ('Assumption', 29.9101, -91.0628),
        ('Cameron', 29.8324, -93.1700),
        ('Jefferson Davis', 30.2649, -92.8127),
        ('Red River', 32.0950, -93.3360),
        ('Claiborne', 32.8221, -92.9963)
      ) AS c(name, lat, lng)
     WHERE c.name IN (trim(regexp_replace(COALESCE(v_zip_parish, ''), '\s+Parish\s*$', '', 'i')),
                      trim(regexp_replace(COALESCE(v_parish, ''), '\s+Parish\s*$', '', 'i')))
     ORDER BY (c.name = trim(regexp_replace(COALESCE(v_zip_parish, ''), '\s+Parish\s*$', '', 'i'))) DESC
     LIMIT 1;
  END IF;

  SELECT array_agg(to_jsonb(t) ORDER BY t.miles NULLS LAST, t.live_at DESC) INTO v_rows
    FROM (
      SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
             i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
             i.porch_ok, i.accepts_offers, i.accepts_trades, i.sale_mode, i.last_price_drop_on, i.drop_pct, i.drops_stopped,
             CASE WHEN v_lat IS NOT NULL THEN
               2 * 3958.8 * asin(least(1, sqrt(
                 sin(radians(COALESCE(i.area_lat, 0)::double precision - v_lat) / 2) ^ 2
                 + cos(radians(v_lat)) * cos(radians(COALESCE(i.area_lat, 0)::double precision))
                   * sin(radians(COALESCE(i.area_lng, 0)::double precision - v_lng) / 2) ^ 2)))
             END AS miles
        FROM public.declutter_items i
       WHERE i.status IN ('live', 'reserved') AND i.seller_id IS DISTINCT FROM v_me
       ORDER BY miles NULLS LAST, i.live_at DESC
       LIMIT v_cap + 1
    ) t;

  SELECT COALESCE(jsonb_agg(r.v - 'miles' ORDER BY r.n), '[]'::jsonb),
         array_agg((r.v ->> 'id')::uuid),
         array_agg(DISTINCT (r.v ->> 'seller_id')::uuid) FILTER (WHERE r.v ->> 'seller_id' IS NOT NULL)
    INTO v_items, v_ids, v_sellers
    FROM unnest(v_rows) WITH ORDINALITY AS r(v, n)
   WHERE r.n <= v_cap;

  RETURN jsonb_build_object(
    'switches', v_switches,
    'items', v_items,
    'more', COALESCE(cardinality(v_rows), 0) > v_cap,
    'near', CASE WHEN v_lat IS NOT NULL THEN jsonb_build_object('lat', v_lat, 'lng', v_lng) END,
    'zip_parish', CASE WHEN NOT v_has_position AND length(v_zip) = 5
      THEN jsonb_build_object('zip', v_zip, 'parish', v_zip_parish) END,
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id = ANY (COALESCE(v_ids, '{}'::uuid[]))
    ), '[]'::jsonb),
    'watching', COALESCE((
      SELECT jsonb_agg(w.item_id) FROM public.declutter_watchlist w WHERE w.user_id = v_me
    ), '[]'::jsonb),
    'bundle_sellers', CASE
      WHEN COALESCE(v_switches ->> 'declutter', 'false') = 'true' AND COALESCE(cardinality(v_sellers), 0) > 0
        THEN to_jsonb(public.declutter_bundle_sellers(v_sellers))
      ELSE '[]'::jsonb
    END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_first_screen(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_first_screen(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_remove_cart_item(p_line_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item uuid;
  v_swap uuid;
  l record;
  o public.declutter_orders;  -- a row type, so o.id reads NULL when the line has no order
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT c.item_id, c.swap_id INTO v_item, v_swap FROM public.declutter_cart_items c WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: items (id order; a trade line takes both of the trade's items, end_swap's order) -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = v_item
      OR i.id IN (SELECT f.item_id FROM public.declutter_swap_offers f WHERE f.id = v_swap
                  UNION ALL SELECT f.offered_item_id FROM public.declutter_swap_offers f WHERE f.id = v_swap)
   ORDER BY i.id FOR UPDATE;
  SELECT c.*, i.title INTO l
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.id = p_line_id AND c.buyer_id = v_uid;
  IF l.order_id IS NOT NULL THEN
    SELECT x.* INTO o FROM public.declutter_orders x WHERE x.id = l.order_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.id = p_line_id FOR UPDATE;
  SELECT c.status INTO v_status FROM public.declutter_cart_items c WHERE c.id = p_line_id;
  IF v_status = 'removed' THEN
    RETURN 'already';
  END IF;
  IF v_status <> 'in_cart' THEN
    RAISE EXCEPTION 'not_in_cart' USING ERRCODE = '55000', HINT = 'This item is not in your cart any more.';
  END IF;
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' AND o.stripe_checkout_session_id IS NOT NULL
     AND o.created_at > now() - interval '35 minutes' THEN
    RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
      HINT = 'You opened checkout for this. Close the payment page, then try again in a few minutes.';
  END IF;

  UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now()
   WHERE id = p_line_id AND status = 'in_cart';
  IF o.id IS NOT NULL AND o.status = 'awaiting_payment' THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = o.id AND status = 'awaiting_payment';
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = o.id AND status = 'in_cart';
  END IF;
  IF public.declutter_seller_out(l.seller_id) THEN
    UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
  ELSE
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = l.item_id AND status = 'reserved';
    IF l.swap_id IS NULL THEN
      PERFORM public.declutter_notify(l.seller_id, 'new_offers', 'Back on sale',
        format('The buyer let "%s" go before checking out. It''s back on sale.', l.title),
        '/declutter?tab=selling', v_uid);
    END IF;
  END IF;
  -- CHANGED (trades, lead 11-08): removing a trade line backs out of the whole trade now: the other side's line is
  -- released, money offers the holds voided reopen on both items, and both sides get one "Trade cancelled" notice.
  IF l.swap_id IS NOT NULL THEN
    PERFORM public.declutter_end_swap(l.swap_id, v_uid);
  END IF;
  RETURN 'removed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_cart_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_cart_item(uuid) TO authenticated, service_role;
