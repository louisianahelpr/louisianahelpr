-- DECLUTTER, SLICE 3 (server half): offers, daily price drops, cart + checkout
-- records, missed-checkout / seller-cancel strikes, and hiding a banned or
-- 3-strike seller's listings. Owner rows cited as "row N" and agent build
-- decisions as "B<n>" from docs/specs/declutter-auctions.md (slice 3 adds
-- B25-B37 there). Launch mode = OFFERS (row 55); there is no bidding code.
--
-- OFFERS (rows 57-58, B25-B28). One negotiation thread per (item, buyer):
-- public.declutter_offers holds the CURRENT proposal and whose turn it is
-- ('seller' or 'buyer'); every step is kept in declutter_offer_events. The
-- side whose turn it is has 48 h to accept, decline or counter; counters are
-- unlimited both ways; an unanswered thread expires (sweep). A buyer's offer
-- or counter must be >= 50% of the item's CURRENT price. B26: an offer under
-- the seller's hidden floor is NOT auto-declined: it reaches the seller, who
-- sees it is under their floor. Nothing the server says to a buyer depends on
-- the floor, so the floor cannot be found by lowering offers (the review
-- note's binary-search oracle). Rate limit: at most 3 offer threads per buyer
-- per item per 24 h (B27).
--
-- ACCEPT IS RACE-SAFE (B29). Every path that takes an item off sale (accept by
-- either side, Buy at the current price) runs declutter_take_item(): the
-- caller holds the item row FOR UPDATE; it flips 'live' -> 'reserved' with a
-- status predicate, voids every other open thread, and inserts the cart line.
-- Two backstops make a second winner impossible even if a future path forgets
-- the lock:
--   declutter_offers_one_accepted   unique (item_id) WHERE status='accepted'
--   declutter_cart_one_active       unique (item_id) WHERE status IN ('in_cart','paid')
-- Lock order everywhere: items (by id) -> orders -> cart lines / offers.
-- Proof: src/test/pglite/declutterSlice3.pglite.mjs (serial rules + the two
-- backstops) and scripts/declutter/race-accept.mjs (real concurrent sessions).
--
-- CART + CHECKOUT (rows 13, 20-22, 36, 38, 59, B30-B34). An accepted offer or
-- Buy puts ONE cart line in the buyer's cart with checkout_by = now() + 48 h.
-- declutter_start_checkout(seller, handover) groups the buyer's lines for that
-- seller into ONE order (row 38) and freezes the amounts:
--   items_cents   = sum of the line prices (all of it goes to the seller, row 22)
--   premium_cents = greatest(round(items * 15%), 100) (rows 20/21, one $1
--                   minimum per order)
--   total_cents   = items + premium + tax (the buyer sees one number; the
--                   Stripe card fee comes OUT of our premium, row 20)
--   tax_cents     = 0 (casual sellers, row 54 (1)). THE TAX HOOK (B33): a seller
--                   with declutter_seller_flags.business_like is refused at
--                   checkout ('seller_tax_not_ready') until the tax slice
--                   computes Stripe Tax, so a business sale is never taken untaxed.
-- Nothing here talks to Stripe and NOTHING CHARGES A CARD (rows 6/36/59): slice
-- 3b's edge function creates a Checkout Session for exactly total_cents that
-- the BUYER pays on Stripe's page, and the webhook calls
-- declutter_mark_order_paid(). The money then sits on the platform (separate
-- charges and transfers, the jobs pattern) until slice 4's handover transfers
-- items_cents to the seller. A payment that lands on an order that is no
-- longer payable (superseded, expired, wrong amount) returns 'refund_in_full'
-- so the webhook refunds every cent: our mistake, refunded in full (owner,
-- 2026-10-14 ~3:25 AM CT).
--
-- CARD ON FILE (row 36, B31): offering and Buy need a saved card. No saved-
-- card store exists for members (measured 2026-10-14: only businesses have
-- default_payment_method_id), so declutter_buyer_cards is created here,
-- written ONLY by service_role (slice 3b's SetupIntent webhook). No code path
-- reads payment_method_id to charge it.
--
-- STRIKES (rows 7, 13, 16-19, 59): a cart line not paid by checkout_by gives
-- the buyer a 'missed_checkout' strike and puts the item back on sale; a
-- seller who cancels an accepted, unpaid sale gets 'cancelled_after_offers'.
-- Each strike notifies the member: "You have N of 3 strikes".
--
-- PRICE DROPS (row 56, B35): declutter_price_drop_sweep(), cron
-- 'declutter-price-drops' at 23:00 UTC (6 PM CDT / 5 PM CST), lowers each live
-- item's current price 5% (rounded down to the cent) but never below its
-- floor; idempotent per Louisiana day (last_price_drop_on); an item live less
-- than 12 h is skipped that evening. Watchers get "Price dropped". Both crons
-- are registered in cron_work_expectations (the dead-cron monitor).
--
-- VISIBILITY (open after slice 2, B36): the items read policy hides a listing
-- whose seller is banned or has 3 active Declutter strikes (the seller still
-- sees their own), and every buyer RPC refuses such a seller's item.
--
-- NOTIFICATIONS (row 44): rows in public.notifications (push + bell through
-- fan_out_push_on_notification), the SQL-cron pattern of 20261012195747.
-- Receipt emails (money events) come from slice 3b's webhook.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS; cron and its
-- expectation rows only where those objects exist. Grants by role name,
-- REVOKE ... FROM PUBLIC, anon. Applied 3x by the PGlite proof.

-- ---------------------------------------------------------------------------
-- 0. New columns on items.
ALTER TABLE public.declutter_items
  ADD COLUMN IF NOT EXISTS last_price_drop_on date,
  ADD COLUMN IF NOT EXISTS price_dropped_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Saved cards (row 36). service_role writes; the member reads brand + last4
--    of their own (for the "card on file" line), never the Stripe ids.
CREATE TABLE IF NOT EXISTS public.declutter_buyer_cards (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_'),
  payment_method_id text NOT NULL CHECK (payment_method_id ~ '^pm_'),
  brand text,
  last4 text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_buyer_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_buyer_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT (user_id, brand, last4, saved_at) ON TABLE public.declutter_buyer_cards TO authenticated;
GRANT ALL ON TABLE public.declutter_buyer_cards TO service_role;
DROP POLICY IF EXISTS "declutter cards: member reads own" ON public.declutter_buyer_cards;
CREATE POLICY "declutter cards: member reads own" ON public.declutter_buyer_cards
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Offer threads + their history.
CREATE TABLE IF NOT EXISTS public.declutter_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 1000000),
  awaiting text NOT NULL CHECK (awaiting IN ('seller', 'buyer')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',       -- waiting for `awaiting` to answer
    'accepted',   -- the item went to this buyer (row 57: first accepted wins)
    'declined',   -- the side whose turn it was said no
    'expired',    -- 48 h passed with no answer
    'withdrawn',  -- the buyer took it back
    'voided'      -- the item went to someone else
  )),
  respond_by timestamptz NOT NULL,
  counter_count integer NOT NULL DEFAULT 0 CHECK (counter_count >= 0),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT declutter_offers_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_offers_item_idx ON public.declutter_offers (item_id, status);
CREATE INDEX IF NOT EXISTS declutter_offers_buyer_idx ON public.declutter_offers (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_offers_seller_idx ON public.declutter_offers (seller_id, status);
CREATE INDEX IF NOT EXISTS declutter_offers_open_due_idx ON public.declutter_offers (respond_by) WHERE status = 'open';
-- One open thread per buyer per item; one accepted thread per item (B29).
CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_open_per_buyer
  ON public.declutter_offers (item_id, buyer_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_accepted
  ON public.declutter_offers (item_id) WHERE status = 'accepted';
ALTER TABLE public.declutter_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_offers TO authenticated;
GRANT ALL ON TABLE public.declutter_offers TO service_role;
DROP POLICY IF EXISTS "declutter offers: the two sides read" ON public.declutter_offers;
CREATE POLICY "declutter offers: the two sides read" ON public.declutter_offers
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.declutter_offer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.declutter_offers(id) ON DELETE CASCADE,
  actor_side text NOT NULL CHECK (actor_side IN ('buyer', 'seller', 'system')),
  action text NOT NULL CHECK (action IN ('offer', 'counter', 'accept', 'decline', 'withdraw', 'expire', 'void')),
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents BETWEEN 100 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_offer_events_offer_idx ON public.declutter_offer_events (offer_id, created_at);
ALTER TABLE public.declutter_offer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_offer_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_offer_events TO authenticated;
GRANT ALL ON TABLE public.declutter_offer_events TO service_role;
DROP POLICY IF EXISTS "declutter offer events: the two sides read" ON public.declutter_offer_events;
CREATE POLICY "declutter offer events: the two sides read" ON public.declutter_offer_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_offers o
                  WHERE o.id = offer_id
                    AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));

-- ---------------------------------------------------------------------------
-- 3. Orders (one checkout per buyer per seller, row 38) and cart lines.
CREATE TABLE IF NOT EXISTS public.declutter_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment', -- amounts frozen, Stripe page not paid yet
    'paid',             -- money held on the platform until handover (slice 4)
    'superseded',       -- the buyer restarted checkout; a payment here is refunded in full
    'expired'           -- the deadline passed unpaid / a line left the order
  )),
  handover text NOT NULL CHECK (handover IN ('pickup_home', 'porch')),
  items_cents integer NOT NULL CHECK (items_cents >= 100),
  premium_cents integer NOT NULL CHECK (premium_cents >= 100),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT declutter_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents),
  -- Stripe's per-charge maximum ($999,999.99).
  CONSTRAINT declutter_orders_total_max CHECK (total_cents <= 99999999),
  CONSTRAINT declutter_orders_premium_rule CHECK (premium_cents = greatest(round(items_cents * 0.15)::integer, 100)),
  CONSTRAINT declutter_orders_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_orders_buyer_idx ON public.declutter_orders (buyer_id, status);
CREATE INDEX IF NOT EXISTS declutter_orders_seller_idx ON public.declutter_orders (seller_id, status);
-- At most one payable order per buyer+seller at a time.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_orders_one_awaiting
  ON public.declutter_orders (buyer_id, seller_id) WHERE status = 'awaiting_payment';
ALTER TABLE public.declutter_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_orders FROM PUBLIC, anon, authenticated;
-- The Stripe ids are ours, not the members' (B31): every column but those two.
GRANT SELECT (id, buyer_id, seller_id, status, handover, items_cents, premium_cents, tax_cents, total_cents,
              is_seed, created_at, paid_at, closed_at) ON TABLE public.declutter_orders TO authenticated;
GRANT ALL ON TABLE public.declutter_orders TO service_role;
DROP POLICY IF EXISTS "declutter orders: the two sides read" ON public.declutter_orders;
CREATE POLICY "declutter orders: the two sides read" ON public.declutter_orders
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.declutter_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 1000000),
  source text NOT NULL CHECK (source IN ('offer', 'buy')),
  offer_id uuid REFERENCES public.declutter_offers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'in_cart' CHECK (status IN (
    'in_cart',             -- waiting for checkout (48 h, row 59)
    'paid',                -- its order is paid
    'missed',              -- deadline passed: buyer strike, item back on sale
    'cancelled_by_seller'  -- seller backed out: seller strike
  )),
  checkout_by timestamptz NOT NULL,
  reminded_24h_at timestamptz,
  reminded_2h_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT declutter_cart_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_cart_buyer_idx ON public.declutter_cart_items (buyer_id, status);
CREATE INDEX IF NOT EXISTS declutter_cart_seller_idx ON public.declutter_cart_items (seller_id, status);
CREATE INDEX IF NOT EXISTS declutter_cart_order_idx ON public.declutter_cart_items (order_id);
CREATE INDEX IF NOT EXISTS declutter_cart_offer_idx ON public.declutter_cart_items (offer_id);
CREATE INDEX IF NOT EXISTS declutter_cart_due_idx ON public.declutter_cart_items (checkout_by) WHERE status = 'in_cart';
-- One active sale per item (B29 backstop).
CREATE UNIQUE INDEX IF NOT EXISTS declutter_cart_one_active
  ON public.declutter_cart_items (item_id) WHERE status IN ('in_cart', 'paid');
ALTER TABLE public.declutter_cart_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_cart_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_cart_items TO authenticated;
GRANT ALL ON TABLE public.declutter_cart_items TO service_role;
DROP POLICY IF EXISTS "declutter cart: the two sides read" ON public.declutter_cart_items;
CREATE POLICY "declutter cart: the two sides read" ON public.declutter_cart_items
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));

-- is_seed at birth: a row is seed when either party's profile is (B16's rule).
CREATE OR REPLACE FUNCTION public.declutter_trade_rows_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.buyer_id), false)
              OR COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.seller_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_trade_rows_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_offers_seed ON public.declutter_offers;
CREATE TRIGGER trg_declutter_offers_seed BEFORE INSERT ON public.declutter_offers
  FOR EACH ROW EXECUTE FUNCTION public.declutter_trade_rows_seed();
DROP TRIGGER IF EXISTS trg_declutter_orders_seed ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_seed BEFORE INSERT ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_trade_rows_seed();
DROP TRIGGER IF EXISTS trg_declutter_cart_seed ON public.declutter_cart_items;
CREATE TRIGGER trg_declutter_cart_seed BEFORE INSERT ON public.declutter_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_trade_rows_seed();

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers.

-- B36: a member who is out of Declutter for the OTHER side of a trade:
-- banned (a lapsed temp ban does not count, is_caller_banned's rule) or 3
-- active Declutter strikes. NULL -> false. Service-only: it answers for any id.
CREATE OR REPLACE FUNCTION public.declutter_member_out(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.user_id = p_user
               AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
               AND (p.ban_status <> 'temp_banned'
                    OR p.auto_suspended_until IS NULL
                    OR p.auto_suspended_until > now()))
    OR public.declutter_active_strike_count(p_user) >= 3);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_member_out(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_member_out(uuid) TO service_role;

-- A SELLER who cannot sell right now: out of Declutter (member_out), under 18
-- (row 53: a birthday saved after listing), or flagged business-like (B33:
-- never sold untaxed). Service-only: it answers for any id.
CREATE OR REPLACE FUNCTION public.declutter_seller_out(p_seller uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_seller IS NOT NULL AND (
    public.declutter_member_out(p_seller)
    OR COALESCE(public.member_under_18(p_seller), false)
    OR EXISTS (SELECT 1 FROM public.declutter_seller_flags f WHERE f.user_id = p_seller AND f.business_like));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_out(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_out(uuid) TO service_role;

-- The items read policy's question: is this SELLER's listing hidden from other
-- readers? authenticated needs EXECUTE (the policy runs as the reader), so it
-- answers only for a member who has a live or reserved listing, i.e. only
-- what the policy itself reveals by hiding that listing; for anyone else
-- (any id a client might pass) it says false and reveals nothing about bans
-- or strikes.
CREATE OR REPLACE FUNCTION public.declutter_seller_hidden(p_seller uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_items i
                  WHERE i.seller_id = p_seller AND i.status IN ('live', 'reserved'))
     AND public.declutter_seller_out(p_seller);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_hidden(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_hidden(uuid) TO authenticated, service_role;

-- A bell + push row (row 44). job_id NULL: Declutter is not a job.
-- p_other is the counterpart the notice is about (NULL for the member's own
-- strike / reminder). Q137's rule: a seed (test) counterpart never notifies a
-- real member, so a test account offering on a real seller's item stays silent.
CREATE OR REPLACE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT p_user, p_type, p_title, p_message, p_link
   WHERE p_user IS NOT NULL
     AND (p_other IS NULL
          OR NOT COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
          OR COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) TO service_role;

-- Give a Declutter strike and tell the member their count (rows 7, 17).
CREATE OR REPLACE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.declutter_strikes (user_id, offender_side, reason, item_id, given_at, expires_at)
  VALUES (p_user, p_side, p_reason, p_item, now(), now() + interval '1 year');
  v_n := public.declutter_active_strike_count(p_user);
  PERFORM public.declutter_notify(p_user, 'warning', 'You got a Declutter strike',
    format('%s You have %s of 3 strikes. Each strike goes away 1 year after you got it. At 3 strikes you cannot buy or sell on Declutter until one goes away.',
           p_why, least(v_n, 3)),
    '/declutter?view=offers');
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_give_strike(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_give_strike(uuid, text, text, uuid, text) TO service_role;
-- The buyer-side gates for offering / Buy (rows 36, 48, 53, B36). LOCKS the
-- item row FOR UPDATE, so the status it judged cannot change before the
-- caller writes (the race class). Returns the seller, current price, title.
CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid,
  OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
  v_mode text;
BEGIN
  SELECT i.seller_id, i.current_price_cents, i.title, i.status, i.sale_mode
    INTO o_seller_id, o_price_cents, o_title, v_status, v_mode
    FROM public.declutter_items i
   WHERE i.id = p_item_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(o_seller_id, p_buyer)
     OR public.declutter_seller_out(o_seller_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o_seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = p_buyer) THEN
    RAISE EXCEPTION 'card_required'
      USING ERRCODE = '42501', HINT = 'Save a card first. It is never charged until you check out.';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) TO service_role;

-- THE one path that takes an item off sale (B29). The caller holds the item
-- lock. Flips live -> reserved with a status predicate, marks the winning
-- thread accepted, voids every other open thread (telling those buyers), and
-- creates the cart line.
CREATE OR REPLACE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer,
  p_source text, p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
  v_title text;
  v_line uuid;
  v_price text := to_char(p_price / 100.0, 'FM999990.00');
  r record;
BEGIN
  UPDATE public.declutter_items
     SET status = 'reserved', updated_at = now()
   WHERE id = p_item_id AND status = 'live'
  RETURNING seller_id, title INTO v_seller, v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;

  IF p_offer_id IS NOT NULL THEN
    UPDATE public.declutter_offers
       SET status = 'accepted', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND item_id = p_item_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000';
    END IF;
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item no longer available',
      format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + interval '48 hours')
  RETURNING id INTO v_line;

  PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: check out within 48 hours',
    format('"%s" is in your cart for $%s. Check out within 48 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price),
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for $%s. The buyer has 48 hours to check out and pay.', v_title, v_price),
    '/declutter?view=offers', p_buyer);
  RETURN v_line;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Client RPCs: offers.

-- Make an offer (row 58: >= 50% of the CURRENT price; B26: no floor check).
CREATE OR REPLACE FUNCTION public.declutter_make_offer(p_item_id uuid, p_amount_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid);

  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents >= v_item.o_price_cents THEN
    RAISE EXCEPTION 'invalid_offer_amount'
      USING ERRCODE = '22023', HINT = 'Offer less than the price. To pay the price, use Buy.';
  END IF;
  IF p_amount_cents * 2 < v_item.o_price_cents THEN
    RAISE EXCEPTION 'offer_too_low'
      USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o
              WHERE o.item_id = p_item_id AND o.buyer_id = v_uid AND o.status = 'open') THEN
    RAISE EXCEPTION 'offer_already_open'
      USING ERRCODE = '55000', HINT = 'You already have an offer on this item. Change it from your offers.';
  END IF;
  -- B27: at most 3 threads per buyer per item per 24 h.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.item_id = p_item_id AND o.buyer_id = v_uid
         AND o.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'offer_rate_limited'
      USING ERRCODE = '54000', HINT = 'You can make 3 offers a day on one item.';
  END IF;

  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
  VALUES (p_item_id, v_uid, v_item.o_seller_id, p_amount_cents, 'seller', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'buyer', 'offer', p_amount_cents);
  PERFORM public.declutter_notify(v_item.o_seller_id, 'new_offers', 'New offer',
    format('You got a $%s offer on "%s". Accept, decline or counter within 48 hours.',
           to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.o_title),
    '/declutter?view=offers', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_make_offer(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_make_offer(uuid, integer) TO authenticated, service_role;

-- Answer an open thread when it is your turn: 'accept' | 'decline' |
-- 'counter' (p_amount_cents). The buyer may also 'withdraw' at any time.
-- Accept goes through declutter_take_item (the race-safe path).
CREATE OR REPLACE FUNCTION public.declutter_respond_offer(p_offer_id uuid, p_action text, p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item_id uuid;
  v_side text;
  o record;
  v_item record;
  v_other uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter', 'withdraw') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- Learn the item, then lock ITEM before the thread (lock order item ->
  -- offer): two answers on one item serialize on the item row.
  SELECT f.item_id INTO v_item_id FROM public.declutter_offers f
   WHERE f.id = p_offer_id AND (f.buyer_id = v_uid OR f.seller_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.id, i.status, i.title, i.current_price_cents INTO v_item
    FROM public.declutter_items i WHERE i.id = v_item_id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_offers f WHERE f.id = p_offer_id FOR UPDATE;
  IF o.status <> 'open' THEN
    RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000', HINT = 'This offer is already closed.';
  END IF;
  v_side := CASE WHEN o.buyer_id = v_uid THEN 'buyer' ELSE 'seller' END;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;

  IF p_action = 'withdraw' THEN
    IF v_side <> 'buyer' THEN
      RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;
    UPDATE public.declutter_offers SET status = 'withdrawn', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, 'buyer', 'withdraw');
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'Offer withdrawn',
      format('The buyer took back their offer on "%s".', v_item.title), '/declutter?view=offers', o.buyer_id);
    RETURN 'withdrawn';
  END IF;

  IF o.awaiting <> v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000', HINT = 'Waiting for the other side to answer.';
  END IF;
  IF o.respond_by <= now() THEN
    RAISE EXCEPTION 'offer_expired' USING ERRCODE = '55000', HINT = 'This offer ran out of time.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.declutter_offers SET status = 'declined', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (p_offer_id, v_side, 'decline');
    -- One wording for every decline (B26): never says why.
    PERFORM public.declutter_notify(v_other, 'new_offers', 'Offer declined',
      format('Your offer on "%s" was declined. Nothing was charged.', v_item.title),
      CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?view=offers' END, v_uid);
    RETURN 'declined';
  END IF;

  -- accept / counter: the item must still be for sale, both sides still in.
  IF v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'This item is no longer for sale.';
  END IF;
  IF public.declutter_seller_out(o.seller_id) OR public.are_users_blocked(o.seller_id, o.buyer_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.declutter_member_out(v_other) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'counter' THEN
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > v_item.current_price_cents THEN
      RAISE EXCEPTION 'invalid_offer_amount' USING ERRCODE = '22023';
    END IF;
    IF v_side = 'buyer' AND p_amount_cents * 2 < v_item.current_price_cents THEN
      RAISE EXCEPTION 'offer_too_low' USING ERRCODE = '22023', HINT = 'Offers must be at least half the current price.';
    END IF;
    IF p_amount_cents = o.amount_cents THEN
      RAISE EXCEPTION 'counter_same_amount' USING ERRCODE = '22023', HINT = 'To agree to this amount, accept it.';
    END IF;
    UPDATE public.declutter_offers
       SET amount_cents = p_amount_cents,
           awaiting = CASE WHEN v_side = 'buyer' THEN 'seller' ELSE 'buyer' END,
           respond_by = now() + interval '48 hours',
           counter_count = counter_count + 1,
           updated_at = now()
     WHERE id = p_offer_id AND status = 'open';
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
    VALUES (p_offer_id, v_side, 'counter', p_amount_cents);
    PERFORM public.declutter_notify(v_other, 'new_offers', 'New counteroffer',
      format('You got a $%s counteroffer on "%s". Accept, decline or counter within 48 hours.',
             to_char(p_amount_cents / 100.0, 'FM999990.00'), v_item.title),
      '/declutter?view=offers', v_uid);
    RETURN 'countered';
  END IF;

  -- accept. The buyer pays, so the buyer needs a card on file and to be 18+
  -- (row 53) even when it is the seller who accepts.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = o.buyer_id) THEN
    RAISE EXCEPTION 'card_required' USING ERRCODE = '42501',
      HINT = 'The buyer needs a saved card. It is never charged until checkout.';
  END IF;
  IF public.member_under_18(o.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- B28: an agreed amount above today's price (the price dropped since the
  -- counter) is charged at today's price: accepting never costs more than Buy.
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (p_offer_id, v_side, 'accept', least(o.amount_cents, v_item.current_price_cents));
  PERFORM public.declutter_take_item(o.item_id, o.buyer_id, least(o.amount_cents, v_item.current_price_cents), 'offer', p_offer_id);
  RETURN 'accepted';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_respond_offer(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_respond_offer(uuid, text, integer) TO authenticated, service_role;

-- Buy at the current price = instant accept (rows 57-59).
CREATE OR REPLACE FUNCTION public.declutter_buy_now(p_item_id uuid, p_expected_price_cents integer)
RETURNS uuid
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
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid);
  -- The buyer agreed to the price they SAW; a drop since only helps them.
  IF p_expected_price_cents IS NULL OR v_item.o_price_cents > p_expected_price_cents THEN
    RAISE EXCEPTION 'price_changed' USING ERRCODE = '55000', HINT = 'The price changed. Check it and try again.';
  END IF;
  RETURN public.declutter_take_item(p_item_id, v_uid, v_item.o_price_cents, 'buy', NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buy_now(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buy_now(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Checkout.

-- Freeze the buyer's in-cart lines for one seller into one order (row 38).
-- A previous awaiting order for the pair is marked 'superseded' (a late
-- payment on it is refunded in full) and its Stripe session id returned so
-- slice 3b's edge function expires it.
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    -- Row 24's third option, Helpr delivery, is slice 5.
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose pickup at the seller''s home or porch pickup. Helpr delivery is coming later.';
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse. A
  -- double tap or a second device never supersedes the page the buyer is paying on.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines THEN
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  v_premium := greatest(round(v_items * 0.15)::integer, 100);
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_items + v_premium)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium, v_old_session, NULL::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text) TO authenticated, service_role;

-- Record the Stripe Checkout Session the edge function created (service only).
CREATE OR REPLACE FUNCTION public.declutter_attach_checkout_session(p_order_id uuid, p_session_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.declutter_orders SET stripe_checkout_session_id = p_session_id
   WHERE id = p_order_id AND status = 'awaiting_payment' AND stripe_checkout_session_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '55000';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_attach_checkout_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_attach_checkout_session(uuid, text) TO service_role;

-- The webhook's call when Stripe says the session was paid (service only).
-- Returns 'paid' (lines + items marked, money held on the platform),
-- 'already_paid' (a replayed webhook for the same PaymentIntent: no-op), or
-- 'refund_in_full' (no longer payable: superseded, expired, a line left, or
-- the amount differs; our mistake, refund every cent).
CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  r record;
BEGIN
  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'refund_in_full';
  END IF;
  IF o.status = 'paid' THEN
    RETURN CASE WHEN o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id
                THEN 'already_paid' ELSE 'refund_in_full' END;
  END IF;
  IF o.status <> 'awaiting_payment' OR p_amount_cents IS DISTINCT FROM o.total_cents
     OR p_payment_intent_id IS NULL THEN
    RETURN 'refund_in_full';
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart (none missed / cancelled since),
  -- every item still reserved, and the seller still able to sell to this buyer.
  IF v_lines = 0 OR v_live <> v_lines
     OR EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                 WHERE c.order_id = p_order_id AND i.status <> 'reserved')
     OR public.declutter_seller_out(o.seller_id)
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    UPDATE public.declutter_orders SET status = 'expired', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    RETURN 'refund_in_full';
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent_id
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid $%s. Next: pick up your items at the time you chose.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for $%s of your items. You get paid when the buyer has them.', to_char(o.items_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', o.buyer_id);
  RETURN 'paid';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) TO service_role;

-- Seller backs out of an accepted, UNPAID sale (row 19): seller strike, buyer
-- told, item withdrawn. A paid sale is slice 4 (refund path).
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
  PERFORM public.require_feature('declutter');
  -- Not strike/age-gated: anyone may back out (and takes the strike).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Lock order items (by id) -> orders -> lines: every item of the order this
  -- sale sits in, so the deadline sweep and the webhook never deadlock with it.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = p_item_id
      OR i.id IN (SELECT c2.item_id FROM public.declutter_cart_items c2
                   WHERE c2.order_id = (SELECT c.order_id FROM public.declutter_cart_items c
                                         WHERE c.item_id = p_item_id AND c.status = 'in_cart'))
   ORDER BY i.id FOR UPDATE;
  SELECT i.id, i.status, i.title INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
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
    UPDATE public.declutter_orders SET status = 'expired', closed_at = now()
     WHERE id = v_line.order_id AND status = 'awaiting_payment';
  END IF;
  UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
   WHERE id = v_line.id AND status = 'in_cart';
  IF v_line.order_id IS NOT NULL THEN
    -- The order's other lines go back to plain cart lines (check out again).
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = v_line.order_id AND status = 'in_cart';
  END IF;
  UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
   WHERE id = p_item_id AND status = 'reserved';
  PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
    format('The seller cancelled the sale of "%s". You were not charged.', v_item.title), '/declutter?view=cart', v_uid);
  RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,
    format('You cancelled the sale of "%s" after accepting it.', v_item.title));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_cancel_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_sale(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Sweeps (service_role, cron).

-- Offers past respond_by expire (row 57); checkout reminders at 24 h and 2 h
-- (row 13); lines past checkout_by are missed: buyer strike, item back on sale
-- (rows 7, 59). A line whose order is still awaiting payment gets 1 h of grace
-- past the deadline (a Stripe page opened just before it), then is missed too.
CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
           ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
           ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END,
      '/declutter?view=offers', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
    RETURNING c.buyer_id
  LOOP
    v_r24 := v_r24 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
      'You have an item waiting in your cart. Check out within 24 hours or you get a strike.', '/declutter?view=cart');
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
    RETURNING c.buyer_id
  LOOP
    v_r2 := v_r2 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
      'Check out in the next 2 hours or you get a strike and the item goes back up for sale.', '/declutter?view=cart');
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
    IF v_line.order_id IS NOT NULL THEN
      -- Grace: a payable order gets 1 h past the deadline.
      IF EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                    AND v_line.checkout_by > now() - interval '1 hour') THEN
        CONTINUE;
      END IF;
      UPDATE public.declutter_orders SET status = 'expired', closed_at = now()
       WHERE id = v_line.order_id AND status = 'awaiting_payment';
    END IF;
    -- Who stopped this checkout? A seller who blocked the buyer backed out of
    -- the sale (row 19: seller strike); a seller who can no longer sell
    -- (banned, 3 strikes, under 18, business-like) ends it with no strike for
    -- the buyer; otherwise the buyer missed it (rows 7, 59). Read user_blocks
    -- directly: are_users_blocked() answers only for parties or server context.
    BEGIN
      IF EXISTS (SELECT 1 FROM public.user_blocks b
                  WHERE b.blocker_id = v_line.seller_id AND b.blocked_id = v_line.buyer_id) THEN
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
          format('The seller cancelled the sale of "%s". You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart', v_line.seller_id);
        PERFORM public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers', v_line.item_id,
          format('You blocked the buyer of "%s" after the sale, which cancels it.', v_line.title));
      ELSIF public.declutter_seller_out(v_line.seller_id) THEN
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'ended', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'This sale was cancelled',
          format('"%s" can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart');
      ELSE
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_missed := v_missed + 1;
          -- Back on sale (rows 13/59).
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
            format('You did not check out "%s" within 48 hours.', v_line.title));
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?view=offers', v_line.buyer_id);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad line never stops every other missed checkout; it is retried
      -- on the next run (the line is still in_cart) and filed where ops reads it.
      PERFORM public.log_cron_defect('declutter_deadline_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('offers_expired', v_expired, 'reminded_24h', v_r24,
                            'reminded_2h', v_r2, 'checkouts_missed', v_missed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;

-- Row 56 / B35: the evening 5% drop toward the floor, once per Louisiana day.
CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_n integer := 0;
  r record;
BEGIN
  FOR r IN
    UPDATE public.declutter_items i
       SET current_price_cents = greatest(p.floor_price_cents, floor(i.current_price_cents * 0.95)::integer),
           last_price_drop_on = v_today,
           price_dropped_at = now(),
           updated_at = now()
      FROM public.declutter_item_private p
     WHERE p.item_id = i.id
       AND i.status = 'live'
       AND i.sale_mode = 'offers'
       AND i.live_at IS NOT NULL AND i.live_at <= now() - interval '12 hours'
       AND i.current_price_cents > p.floor_price_cents
       AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)
    RETURNING i.id, i.title, i.current_price_cents, i.is_seed
  LOOP
    v_n := v_n + 1;
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT w.user_id, 'info', 'Price dropped',
           format('"%s" is now $%s.', r.title, to_char(r.current_price_cents / 100.0, 'FM999990.00')),
           '/declutter/item/' || r.id::text
      FROM public.declutter_watchlist w
      LEFT JOIN public.profiles wp ON wp.user_id = w.user_id
     WHERE w.item_id = r.id
       -- Q137: a seed (test) listing never alerts a real watcher.
       AND (NOT r.is_seed OR COALESCE(wp.is_seed, false));
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 7b. Readers for the Offers and Cart screens (B37). The item may no longer be
--     readable through the items policy (sold, withdrawn), so the title comes
--     with the row here. Only the caller's own threads / lines; the floor only
--     on the seller's own rows (B26: a buyer never learns it).
CREATE OR REPLACE FUNCTION public.declutter_my_offers()
RETURNS TABLE (offer_id uuid, item_id uuid, item_title text, my_side text, amount_cents integer,
               awaiting text, status text, respond_by timestamptz, counter_count integer,
               current_price_cents integer, floor_price_cents integer, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.id, o.item_id, i.title,
         CASE WHEN o.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         o.amount_cents, o.awaiting, o.status, o.respond_by, o.counter_count,
         i.current_price_cents,
         CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END,
         o.updated_at
    FROM public.declutter_offers o
    JOIN public.declutter_items i ON i.id = o.item_id
    LEFT JOIN public.declutter_item_private p ON p.item_id = o.item_id
   WHERE (o.buyer_id = v_uid OR o.seller_id = v_uid)
     AND (o.status = 'open' OR o.updated_at > now() - interval '30 days')
   ORDER BY (o.status = 'open') DESC, o.updated_at DESC
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, i.title,
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         c.seller_id, c.price_cents, c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Items read policy: hide a banned / 3-strike seller's listings (B36).
DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT public.declutter_seller_hidden(seller_id))
  );

-- ---------------------------------------------------------------------------
-- 9. Cron + dead-cron expectations.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES
      ('declutter-deadlines', interval '30 minutes',
       'Declutter: expires 48 h offers, sends checkout reminders (24 h, 2 h), gives missed-checkout strikes.',
       'exempt', 'While Declutter is off or quiet, a run that changes nothing is the healthy state.'),
      ('declutter-price-drops', interval '26 hours',
       'Declutter: lowers live items 5% toward their floor once each Louisiana evening (row 56).',
       'exempt', 'While Declutter is off or every item sits at its floor, a run that drops nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-deadlines', '4-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-deadlines', to_jsonb(public.declutter_deadline_sweep()));$c$);
    -- 23:07 UTC = 6:07 PM CDT / 5:07 PM CST: "each evening" in Louisiana.
    PERFORM cron.schedule('declutter-price-drops', '7 23 * * *',
      $c$SELECT public.cron_record_work('declutter-price-drops', to_jsonb(public.declutter_price_drop_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 10. "Download My Data" (B9): export_my_data restated from 20261014200728
--     verbatim, plus the slice 3 sections (offers, orders,
--     cart lines, the saved card's brand/last 4). The no-argument door stays
--     dropped (Q408).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. The catch-up policy (cronCatchUpPolicy, Q30, reads the NEWEST migration
--     that seeds public.cron_catchup_policy as the whole policy): every row of
--     20261012214444 restated verbatim, plus the daily declutter-price-drops
--     job (not catch-up-safe). declutter-deadlines runs every 10 minutes and
--     heals itself on its next run, so it has no row.
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('daily-match-digest',              true,  interval '20 hours', 'Drains the match-digest queue and deletes what it sent (idempotent within a day, per its header), so a late run sends only what is still queued.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;
