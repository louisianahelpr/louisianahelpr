-- Shops custom orders, slice 1a: the shop's setting and the request -> quote -> decline steps (Builder 4, 11-06).
-- Owner 11-05: custom orders at launch. Owner 11-06: the SHOP OWNER chooses, per shop, between the full payment held
-- at accept (today's order flow) and a 50% deposit (the rest at handover). Plan: ~/.lh-shots/handoffs-1106/builder4-shops.md
-- "CUSTOM ORDERS build plan"; data plan builder5-shops.md section 2. Shops stays behind its switch (testers).
-- NO MONEY in this slice: nothing here holds, charges or pays. Accepting a quote (it becomes a one-line order, and
-- the deposit money) is slice 1b/2, each its own branch with lh-money-escrow.
--
-- What this adds:
--   1. shops.custom_orders: 'off' | 'full_hold' | 'deposit_50' (default 'off'), set by shops_set_custom_orders.
--      Public to members like the other order terms (a buyer reads it before asking).
--   2. shop_custom_requests: one buyer's ask to one shop. PERSONAL DATA: buyer_id ON DELETE CASCADE (account deletion
--      purges it; the shop going away purges it too); is_seed from birth (a test account on either side); no member
--      grant on the table, every read and write goes through the RPCs below. The description (1 to 1000 characters)
--      and the shop's quote note (up to 500) are contact-checked (contact_leak_reason), like every Shops text.
--      payment_plan is frozen from the shop's setting when the request is sent, so a later change of the setting
--      never changes what a buyer was offered.
--   3. shops_send_custom_request(shop, description, wanted_by): the buyer asks. The same gates as ordering
--      (shops_request_order, 20261106165310): banned, 3 Shops strikes, under 18, hidden or blocked shop (404), own shop,
--      paused, not selling. Limits: 3 open asks per buyer per shop, 10 asks a day per buyer. wanted_by is optional,
--      1 to 180 days out. The shop is told.
--   4. shops_quote_custom_request(request, cents, note): the shop owner answers with a price ($1 to $5,000, the item
--      price range) and a note. The quote stands 7 days. The buyer is told.
--   5. shops_decline_custom_request(request): the shop declines an open ask or its own quote ('declined'); the buyer
--      withdraws theirs ('withdrawn'). The other side is told.
--   6. shops_my_custom_requests(): the caller's asks, as a buyer and as a shop owner, newest first, 100 at most.
--      A quote past its 7 days reads as 'expired' (and is stored so the next write sees it).
-- AUTHZ: one table (no member grant), one setter, three member writes, one member read (lh-authz-rls). MONEY: no.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP CONSTRAINT IF EXISTS then ADD,
--   DROP TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsCustomRequests.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1. The shop's setting.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS custom_orders text NOT NULL DEFAULT 'off';
DO $do$
BEGIN
  ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_custom_orders_mode;
  ALTER TABLE public.shops ADD CONSTRAINT shops_custom_orders_mode CHECK (custom_orders IN ('off', 'full_hold', 'deposit_50'));
END
$do$;
GRANT SELECT (custom_orders) ON TABLE public.shops TO authenticated;

CREATE OR REPLACE FUNCTION public.shops_set_custom_orders(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'full_hold', 'deposit_50') THEN
    RAISE EXCEPTION 'invalid_custom_orders' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET custom_orders = p_mode, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_mode;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_custom_orders(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_custom_orders(text) TO authenticated, service_role;

-- 2. The requests.
CREATE TABLE IF NOT EXISTS public.shop_custom_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 1000),
  wanted_by date,
  payment_plan text NOT NULL CHECK (payment_plan IN ('full_hold', 'deposit_50')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'quoted', 'declined', 'withdrawn', 'expired', 'accepted')),
  quote_cents integer CHECK (quote_cents IS NULL OR quote_cents BETWEEN 100 AND 500000),
  quote_note text CHECK (quote_note IS NULL OR char_length(quote_note) <= 500),
  quoted_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_custom_requests_quote_shape CHECK (
    (status = 'requested' AND quote_cents IS NULL AND quoted_at IS NULL AND expires_at IS NULL)
    OR (status IN ('quoted', 'expired', 'accepted') AND quote_cents IS NOT NULL AND quoted_at IS NOT NULL
        AND expires_at = quoted_at + interval '7 days')
    OR status IN ('declined', 'withdrawn'))
);
CREATE INDEX IF NOT EXISTS shop_custom_requests_shop_idx ON public.shop_custom_requests (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_custom_requests_buyer_idx ON public.shop_custom_requests (buyer_id, created_at DESC);
ALTER TABLE public.shop_custom_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_custom_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_custom_requests TO service_role;

-- is_seed from birth: a request with a test account on either side is seed data (as shop_orders_seed_from_parties).
CREATE OR REPLACE FUNCTION public.shop_custom_requests_seed_from_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NOT NEW.is_seed AND (
       EXISTS (SELECT 1 FROM public.shops s WHERE s.id = NEW.shop_id AND s.is_seed)
    OR EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.is_seed AND p.user_id IN (NEW.buyer_id, (SELECT s.owner_id FROM public.shops s WHERE s.id = NEW.shop_id))))
  THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_custom_requests_seed_from_parties() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_custom_requests_seed ON public.shop_custom_requests;
CREATE TRIGGER trg_shop_custom_requests_seed BEFORE INSERT ON public.shop_custom_requests
  FOR EACH ROW EXECUTE FUNCTION public.shop_custom_requests_seed_from_parties();

-- 3. The buyer asks.
CREATE OR REPLACE FUNCTION public.shops_send_custom_request(p_shop_id uuid, p_description text, p_wanted_by date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  s public.shops%ROWTYPE;
  v_text text := btrim(COALESCE(p_description, ''));
  v_leak text;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 Shops strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;

  SELECT * INTO s FROM public.shops WHERE id = p_shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023', HINT = 'You cannot order from your own shop.';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  IF s.custom_orders = 'off' OR NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'custom_orders_off' USING ERRCODE = '55000', HINT = 'This shop is not taking custom orders right now.';
  END IF;

  IF char_length(v_text) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023', HINT = 'Describe what you want in 1 to 1,000 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_text);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the request. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  IF p_wanted_by IS NOT NULL AND (p_wanted_by < v_today + 1 OR p_wanted_by > v_today + 180) THEN
    RAISE EXCEPTION 'invalid_wanted_by' USING ERRCODE = '22023', HINT = 'Pick a date from tomorrow to 6 months out.';
  END IF;

  -- Each call writes a row and a notice: bounded per shop and per day.
  IF (SELECT count(*) FROM public.shop_custom_requests r
       WHERE r.buyer_id = v_uid AND r.shop_id = s.id AND r.status IN ('requested', 'quoted')
         AND (r.expires_at IS NULL OR r.expires_at > now())) >= 3 THEN
    RAISE EXCEPTION 'too_many_custom_requests' USING ERRCODE = '54000',
      HINT = 'You have 3 open requests with this shop. Wait for an answer, or withdraw one.';
  END IF;
  IF (SELECT count(*) FROM public.shop_custom_requests r
       WHERE r.buyer_id = v_uid AND r.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'too_many_custom_requests' USING ERRCODE = '54000',
      HINT = 'You have sent a lot of requests today. Try again tomorrow.';
  END IF;

  INSERT INTO public.shop_custom_requests (shop_id, buyer_id, description, wanted_by, payment_plan)
  VALUES (s.id, v_uid, v_text, p_wanted_by, s.custom_orders)
  RETURNING id INTO v_id;

  PERFORM public.declutter_notify(s.owner_id, 'info', 'New custom order request',
    CASE WHEN p_wanted_by IS NULL THEN 'A buyer asked for a custom order. Send a price or decline it.'
         ELSE format('A buyer asked for a custom order by %s. Send a price or decline it.', to_char(p_wanted_by, 'FMMonth FMDD'))
    END,
    '/shops/dashboard', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_send_custom_request(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_send_custom_request(uuid, text, date) TO authenticated, service_role;

-- 4. The shop answers with a price.
CREATE OR REPLACE FUNCTION public.shops_quote_custom_request(p_request_id uuid, p_quote_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  r public.shop_custom_requests%ROWTYPE;
  s public.shops%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_leak text;
  v_now timestamptz := now();
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
  IF r.id IS NULL OR s.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501';
  END IF;
  IF public.are_users_blocked(v_uid, r.buyer_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status <> 'requested' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'This request has already been answered or closed.';
  END IF;
  IF p_quote_cents IS NULL OR p_quote_cents NOT BETWEEN 100 AND 500000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(COALESCE(v_note, ''));
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  UPDATE public.shop_custom_requests
     SET status = 'quoted', quote_cents = p_quote_cents, quote_note = v_note,
         quoted_at = v_now, expires_at = v_now + interval '7 days', updated_at = v_now
   WHERE id = r.id;
  PERFORM public.declutter_notify(r.buyer_id, 'info', 'Your custom order has a price',
    format('%s sent a price of %s for your custom order. It stands for 7 days.', s.name,
           to_char(p_quote_cents / 100.0, 'FM$999,990.00')),
    '/shops/orders', v_uid);
  RETURN jsonb_build_object('request_id', r.id, 'status', 'quoted', 'quote_cents', p_quote_cents,
    'expires_at', v_now + interval '7 days');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_quote_custom_request(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_quote_custom_request(uuid, integer, text) TO authenticated, service_role;

-- 5. Either side closes it: the shop declines, the buyer withdraws.
CREATE OR REPLACE FUNCTION public.shops_decline_custom_request(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  r public.shop_custom_requests%ROWTYPE;
  s public.shops%ROWTYPE;
  v_status text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
  IF r.id IS NULL OR v_uid NOT IN (r.buyer_id, s.owner_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status NOT IN ('requested', 'quoted') OR (r.status = 'quoted' AND r.expires_at <= now()) THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  v_status := CASE WHEN v_uid = r.buyer_id THEN 'withdrawn' ELSE 'declined' END;
  UPDATE public.shop_custom_requests SET status = v_status, closed_at = now(), updated_at = now() WHERE id = r.id;
  IF v_status = 'declined' THEN
    PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order declined',
      format('%s cannot take your custom order. Nothing was charged.', s.name), '/shops/orders', v_uid);
  ELSE
    PERFORM public.declutter_notify(s.owner_id, 'info', 'Custom order request withdrawn',
      'The buyer withdrew their custom order request. There is nothing to do.', '/shops/dashboard', v_uid);
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_decline_custom_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_decline_custom_request(uuid) TO authenticated, service_role;

-- 6. The caller's asks, as a buyer and as a shop owner.
CREATE OR REPLACE FUNCTION public.shops_my_custom_requests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A quote past its 7 days is stored as expired, so every later write sees it.
  UPDATE public.shop_custom_requests r
     SET status = 'expired', closed_at = r.expires_at, updated_at = now()
   WHERE r.status = 'quoted' AND r.expires_at <= now()
     AND (r.buyer_id = v_uid OR r.shop_id IN (SELECT s.id FROM public.shops s WHERE s.owner_id = v_uid));
  RETURN COALESCE((
    SELECT jsonb_agg(x.j ORDER BY x.created_at DESC)
      FROM (
        SELECT r.created_at, jsonb_build_object(
                 'id', r.id, 'shop_id', r.shop_id, 'shop_name', s.name,
                 'role', CASE WHEN r.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END,
                 'description', r.description, 'wanted_by', r.wanted_by, 'payment_plan', r.payment_plan,
                 'status', r.status, 'quote_cents', r.quote_cents, 'quote_note', r.quote_note,
                 'quoted_at', r.quoted_at, 'expires_at', r.expires_at, 'created_at', r.created_at) AS j
          FROM public.shop_custom_requests r
          JOIN public.shops s ON s.id = r.shop_id
         WHERE (r.buyer_id = v_uid OR s.owner_id = v_uid)
           AND NOT public.are_users_blocked(r.buyer_id, s.owner_id)
         ORDER BY r.created_at DESC
         LIMIT 100) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_custom_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_custom_requests() TO authenticated, service_role;
