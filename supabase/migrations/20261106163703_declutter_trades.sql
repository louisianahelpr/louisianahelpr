-- DECLUTTER TRADES, slice 1: the server (owner 10-31 ~8:55 PM, OWNER-DECISIONS "Declutter trades"; plan approved by the
-- lead 11-06). A buyer offers ONE of their own live listings for a seller's listing; the seller accepts or declines.
-- Item for item, FREE: no fee and no money. In the code it is a "swap" so it is never confused with the existing
-- trade_* names, which mean a sale (declutter_trade_rows_seed, invalidateTrades); members see "trade".
--
-- WHAT (all new; nothing existing is restated):
--   declutter_items.accepts_trades            the per-listing "Open to trades" switch, OFF by default.
--   declutter_seller_defaults.accepts_trades  the Declutter settings default for a new listing, OFF by default.
--   declutter_swap_offers                     one trade offer: the seller's item, the buyer's offered item, the two
--                                             sides, status, respond_by (48 hours, the offer window) and, once
--                                             accepted, the two $0 cart lines it made.
--   declutter_set_trade_rules(item, on)       the seller's per-listing switch (draft, live or paused; never a free item).
--   declutter_offer_swap(item, offered item)  the buyer's offer.
--   declutter_respond_swap(swap, action)      accept / decline (the seller), withdraw (the buyer).
--   declutter_swap_sweep()                    hourly: expires open offers past 48 hours; ends an accepted trade whose
--                                             other side let its 48-hour pickup choice run out.
--   trigger declutter_items_void_swaps        a listing that is sold, reserved, removed, ended or hidden voids every
--                                             open trade naming it, at once (lead 11-06).
--
-- RULES (lead decisions by recommendation, logged in OWNER-DECISIONS 11-06):
--   * Both items live, neither free, different owners, not blocked, the target item open to trades.
--   * One open trade per buyer per target item; an offered item sits in at most ONE open trade (never promised twice).
--   * A pending trade holds nothing. No counters in v1.
--   * Accept reserves BOTH items through the existing declutter_take_item at $0 (source 'buy', the free 48-hour hold),
--     so each side gets the other's item as a $0 line and checks out through the existing declutter_checkout_free:
--     $0 order, paid_with 'free', no fee, no payout, no refund, then the normal handover (pickup time, both confirm).
--     take_item voids the other open offers on both items exactly as a sale does (they reopen if the hold lapses), and
--     the trigger voids every other open trade naming either item. take_item's own free-claim notices are skipped
--     (the transaction-local declutter.bundle_take setting it already honours) and the trade sends its own.
--   * Lapse: if one side's 48 hours run out (declutter_deadline_sweep marks that line 'missed', no strike, DA-12), this
--     sweep releases the other side's line still in the cart the same way and the trade is 'lapsed'. No strike.
--
-- MONEY: none. Nothing is charged, no order carries a price, no payout row is ever written (a free order).
-- AUTHZ: SECURITY DEFINER, auth.uid() only (declutter_assert_member); require_feature('declutter') and the ban gate on
-- every member RPC; the buyer passes the first-purchase ID gate at the offer. Parties read their own rows (RLS);
-- nobody writes the table directly. REVOKE ... FROM PUBLIC, anon; the sweep and trigger function are service_role only.
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS, cron.schedule by name.
-- PROOF: src/test/pglite/declutterTrades.pglite.mjs (NEW_MIGRATION=skip is red). For verdict: lh-authz-rls.

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS accepts_trades boolean NOT NULL DEFAULT false;
ALTER TABLE public.declutter_seller_defaults ADD COLUMN IF NOT EXISTS accepts_trades boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.declutter_swap_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,          -- the seller's listing
  offered_item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,  -- the buyer's own listing
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',       -- waiting for the seller
    'accepted',   -- both items reserved, each side choosing a pickup
    'declined',   -- the seller said no
    'expired',    -- 48 hours with no answer
    'withdrawn',  -- the buyer took it back
    'voided',     -- one of the two items was sold, removed or hidden meanwhile
    'lapsed'      -- accepted, but one side let its 48-hour pickup choice run out
  )),
  respond_by timestamptz NOT NULL,
  buyer_line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL,   -- the buyer gets item_id
  seller_line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL,  -- the seller gets offered_item_id
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT declutter_swap_offers_not_own CHECK (buyer_id <> seller_id),
  CONSTRAINT declutter_swap_offers_two_items CHECK (item_id <> offered_item_id)
);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_item_idx ON public.declutter_swap_offers (item_id, status);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_offered_idx ON public.declutter_swap_offers (offered_item_id, status);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_buyer_idx ON public.declutter_swap_offers (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_seller_idx ON public.declutter_swap_offers (seller_id, status);
CREATE INDEX IF NOT EXISTS declutter_swap_offers_open_due_idx ON public.declutter_swap_offers (respond_by) WHERE status = 'open';
-- One open trade per buyer per item; an offered item in at most one open trade.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_swap_offers_one_open_per_buyer
  ON public.declutter_swap_offers (item_id, buyer_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS declutter_swap_offers_offered_once
  ON public.declutter_swap_offers (offered_item_id) WHERE status = 'open';

ALTER TABLE public.declutter_swap_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_swap_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_swap_offers TO authenticated;
GRANT ALL ON TABLE public.declutter_swap_offers TO service_role;
DROP POLICY IF EXISTS "declutter swap offers: the two sides read" ON public.declutter_swap_offers;
CREATE POLICY "declutter swap offers: the two sides read" ON public.declutter_swap_offers
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));

-- Q807: an unconfirmed email cannot write these tables either (the same guarded call as 20261104103528).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------------
-- The seller's per-listing switch.
CREATE OR REPLACE FUNCTION public.declutter_set_trade_rules(p_item_id uuid, p_accepts_trades boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_accepts_trades IS NULL THEN
    RAISE EXCEPTION 'invalid_trade_rules' USING ERRCODE = '22023';
  END IF;
  SELECT i.status, i.price_cents INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_accepts_trades AND v_item.price_cents = 0 THEN
    RAISE EXCEPTION 'free_item_no_trades' USING ERRCODE = '22023', HINT = 'Free items are claimed, not traded.';
  END IF;
  UPDATE public.declutter_items SET accepts_trades = p_accepts_trades, updated_at = now() WHERE id = p_item_id;
  -- Turning trades off closes the open trades waiting on this listing (the buyers are told).
  IF NOT p_accepts_trades THEN
    PERFORM public.declutter_void_swaps(p_item_id, 'trades_off');
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Closes every OPEN trade naming an item (as the wanted item or the offered one) and tells the other side.
-- Internal: called by the trigger and the switch, never by a client.
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
     WHERE s.status = 'open' AND (s.item_id = p_item_id OR s.offered_item_id = p_item_id)
    RETURNING s.id, s.item_id, s.offered_item_id, s.buyer_id, s.seller_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title
  LOOP
    v_n := v_n + 1;
    IF r.offered_item_id = p_item_id THEN
      -- The buyer's own item left the market: the seller's inbox entry goes away and the seller is told.
      PERFORM public.declutter_notify(r.seller_id, 'declutter_offers', 'Trade offer closed',
        format('A trade offer for "%s" closed because the item offered is no longer available.', coalesce(r.title, 'your item')),
        '/declutter?tab=selling', r.buyer_id);
    ELSE
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Trade offer closed',
        CASE WHEN p_why = 'trades_off'
             THEN format('The seller stopped taking trades on "%s", so your trade offer closed. Nothing changed hands.', coalesce(r.title, 'this item'))
             ELSE format('"%s" is no longer available, so your trade offer closed. Nothing changed hands.', coalesce(r.title, 'This item')) END,
        '/declutter?tab=buying', r.seller_id);
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

-- A listing that leaves the market (sold, reserved, ended, removed, withdrawn, taken down) or is hidden voids every
-- open trade naming it (lead 11-06). Paused keeps them: the seller can still decline, and accept needs it live.
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
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS declutter_items_void_swaps ON public.declutter_items;
CREATE TRIGGER declutter_items_void_swaps
  AFTER UPDATE OF status, seller_hidden ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_void_swaps();

-- ---------------------------------------------------------------------------
-- The checks both items pass at the offer and again at the accept. Locks both items in id order (callers lock nothing
-- before it), so two trades over the same pair never deadlock.
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
  o_seller_id := v_want.seller_id;
  o_title := v_want.title;
  o_offered_title := v_give.title;
  o_seed := v_want.is_seed OR v_give.is_seed;
  RETURN NEXT;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The buyer's offer.
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
  PERFORM public.declutter_notify(v_ok.o_seller_id, 'declutter_offers', 'New trade offer',
    format('%s offered "%s" in trade for "%s". Accept or decline within 48 hours. No money changes hands.',
           coalesce((SELECT public.member_display_name(p.full_name, 'A buyer') FROM public.profiles p WHERE p.user_id = v_uid), 'A buyer'),
           v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The answer: accept / decline (the seller), withdraw (the buyer).
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
    -- One wording for every decline (B26): never says why.
    PERFORM public.declutter_notify(s.buyer_id, 'declutter_offers', 'Trade offer declined',
      format('Your trade offer for "%s" was declined. Nothing changed hands.',
             (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id)),
      '/declutter/item/' || s.item_id::text, v_uid);
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

  SELECT public.member_display_name(p.full_name, 'The seller') INTO v_name FROM public.profiles p WHERE p.user_id = s.seller_id;
  PERFORM public.declutter_notice_ref(v_buyer_line); -- Q2659
  PERFORM public.declutter_notify(s.buyer_id, 'declutter_sales', 'Trade accepted: choose a pickup within 48 hours',
    format('%s accepted your trade: "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           coalesce(v_name, 'The seller'), v_ok.o_offered_title, v_ok.o_title),
    '/declutter?tab=buying', s.seller_id);
  PERFORM public.declutter_notice_ref(v_seller_line); -- Q2659
  PERFORM public.declutter_notify(s.seller_id, 'declutter_sales', 'Trade set: choose a pickup within 48 hours',
    format('You traded "%s" for "%s". Choose how you''ll pick up their item within 48 hours. No money changes hands.',
           v_ok.o_title, v_ok.o_offered_title),
    '/declutter?tab=selling', s.buyer_id);
  RETURN 'accepted';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Hourly: open offers past 48 hours expire; an accepted trade whose other line ran out (or was released) ends.
CREATE OR REPLACE FUNCTION public.declutter_swap_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_expired integer := 0;
  v_lapsed integer := 0;
  v_line record;
  v_keep uuid;
  v_keep_n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.declutter_swap_offers s SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE s.status = 'open' AND s.respond_by <= now()
    RETURNING s.id, s.buyer_id, s.seller_id, s.item_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = s.item_id) AS title
  LOOP
    v_expired := v_expired + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Trade offer expired',
      format('The seller did not answer your trade offer for "%s" within 48 hours, so it closed. Nothing changed hands.', coalesce(r.title, 'an item')),
      '/declutter/item/' || r.item_id::text, r.seller_id);
  END LOOP;

  -- Lapse: one line no longer waiting or picked up (missed, cancelled), the other still in the cart.
  FOR r IN
    SELECT s.id, s.buyer_id, s.seller_id, s.buyer_line_id, s.seller_line_id
      FROM public.declutter_swap_offers s
      JOIN public.declutter_cart_items b ON b.id = s.buyer_line_id
      JOIN public.declutter_cart_items l ON l.id = s.seller_line_id
     WHERE s.status = 'accepted'
       AND ((b.status NOT IN ('in_cart', 'paid') AND l.status = 'in_cart')
         OR (l.status NOT IN ('in_cart', 'paid') AND b.status = 'in_cart'))
  LOOP
    SELECT c.id INTO v_keep FROM public.declutter_cart_items c
     WHERE c.id IN (r.buyer_line_id, r.seller_line_id) AND c.status = 'in_cart';
    SELECT c.*, i.title INTO v_line FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = v_keep;
    PERFORM 1 FROM public.declutter_items i WHERE i.id = v_line.item_id FOR UPDATE;
    UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now() WHERE id = v_keep AND status = 'in_cart';
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = v_line.item_id AND status = 'reserved';
    PERFORM public.declutter_reopen_voided_offers(v_keep);
    UPDATE public.declutter_swap_offers SET status = 'lapsed', updated_at = now() WHERE id = r.id AND status = 'accepted';
    v_lapsed := v_lapsed + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'Trade ended, no strike',
      'A pickup wasn''t chosen in time, so the trade ended and both items are back up. Nobody gets a strike.',
      '/declutter?tab=buying', r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'declutter_sales', 'Trade ended, no strike',
      'A pickup wasn''t chosen in time, so the trade ended and both items are back up. Nobody gets a strike.',
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;
  -- Both sides let their 48 hours run out (each line released by declutter_deadline_sweep): the trade is over too.
  -- One side picked up while the other's ran out is the handover slice's (slice 4): the trade stays 'accepted' here.
  UPDATE public.declutter_swap_offers s SET status = 'lapsed', updated_at = now()
   WHERE s.status = 'accepted'
     AND EXISTS (SELECT 1 FROM public.declutter_cart_items b WHERE b.id = s.buyer_line_id AND b.status NOT IN ('in_cart', 'paid'))
     AND EXISTS (SELECT 1 FROM public.declutter_cart_items l WHERE l.id = s.seller_line_id AND l.status NOT IN ('in_cart', 'paid'));
  GET DIAGNOSTICS v_keep_n = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_expired, 'lapsed', v_lapsed + v_keep_n);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_trade_rules(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_trade_rules(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_offer_swap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_offer_swap(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_respond_swap(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_swap(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_void_swaps(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_void_swaps(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_items_void_swaps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.declutter_swap_items_ok(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_items_ok(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_swap_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_swap_sweep() TO service_role;

-- The sweep: hourly at :47. Until it runs, a new offer closes a past-due one inline and the answer refuses one past
-- respond_by, so a late sweep never lets a seller accept an expired trade.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-swap-sweep', interval '3 hours',
            'Declutter trades: hourly at :47, expires trade offers past their 48-hour answer window and ends accepted trades whose other side missed its pickup choice.',
            'exempt',
            'While no trade offer is past its 48 hours and no accepted trade is half-missed, a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-swap-sweep', '47 * * * *',
      $c$SELECT public.cron_record_work('declutter-swap-sweep', to_jsonb(public.declutter_swap_sweep()));$c$);
  END IF;
END
$do$;
