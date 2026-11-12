-- S2-020 (Shops audit 2, 11-12): a custom request reopens when the order it became closes without a charge.
--
-- WHY
--   A request reads "Ordered" (status 'accepted', order_id set) as soon as the buyer's card is held
--   (shop_orders_custom_request_accepted, 20261106205852). If the shop then declines, lets its 24 hours to accept run
--   out, or the buyer cancels before the shop accepts, the order closes and the card hold is released (nothing was
--   charged), but the request still said "Ordered" and its price could never be ordered again.
--
-- WHAT
--   shop_orders_custom_request_reopen(): AFTER UPDATE OF status on shop_orders. When an order goes from 'held' (card
--   held, not charged) to 'declined', 'expired' or 'cancelled', every request that became it goes back to:
--     - 'quoted' (order_id cleared, closed_at cleared) while its price is still good (expires_at in the future), so
--       the buyer can order it again or withdraw it; or
--     - 'expired' (closed_at = expires_at, as the request sweep stores it) once the 7 days have passed.
--   Only orders that left 'held': a charged order (accepted, handed over, refunded later) never reopens its request.
--   No notice while the price is good: the order's own decline / expiry / cancel notice already told the buyer; the
--   request card says "The shop sent a price" again. Past its 7 days the buyer gets the sweep's "Custom order price
--   ended" notice (money review should-fix 2), never across a block.
--
-- S2-021 (the rest): the shop's "New custom order request" notice now names the day to answer by.
--   shops_send_custom_request restated from its NEWEST CREATE (20261106202917); only the notice words change.
--
-- Money: none moves here. The order's own close path releases the hold, as before. Replay-safe: CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.shop_orders_custom_request_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  r record;
  v_name text;
  v_owner uuid;
BEGIN
  IF OLD.status = 'held' AND NEW.status IN ('declined', 'expired', 'cancelled') THEN
    FOR r IN
      UPDATE public.shop_custom_requests cr
         SET status = CASE WHEN cr.expires_at > now() THEN 'quoted' ELSE 'expired' END,
             order_id = NULL,
             closed_at = CASE WHEN cr.expires_at > now() THEN NULL ELSE cr.expires_at END,
             updated_at = now()
       WHERE cr.order_id = NEW.id
         AND cr.status = 'accepted'
      RETURNING cr.buyer_id, cr.shop_id, cr.status
    LOOP
      -- Money review should-fix 2: past its 7 days the price ends; say so as the request sweep does (never across a
      -- block). A price still good needs no notice: the order's own close notice told the buyer.
      CONTINUE WHEN r.status <> 'expired';
      SELECT s.name, s.owner_id INTO v_name, v_owner FROM public.shops s WHERE s.id = r.shop_id;
      CONTINUE WHEN v_owner IS NULL OR public.are_users_blocked(r.buyer_id, v_owner);
      PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order price ended',
        format('The price from %s for your custom order ended after 7 days. You can ask the shop again.', v_name),
        '/shops/orders', v_owner);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_custom_request_reopen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shop_orders_custom_request_reopen ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_custom_request_reopen AFTER UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_custom_request_reopen();

-- ---------------------------------------------------------------------------
-- S2-021. The new-request notice names the answer-by day (words only; every rule unchanged).
CREATE OR REPLACE FUNCTION public.shops_send_custom_request(p_shop_id uuid, p_description text, p_wanted_date date)
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
  IF p_wanted_date IS NOT NULL AND (p_wanted_date < v_today + 1 OR p_wanted_date > v_today + 180) THEN
    RAISE EXCEPTION 'invalid_wanted_date' USING ERRCODE = '22023', HINT = 'Pick a date from tomorrow to 6 months out.';
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

  INSERT INTO public.shop_custom_requests (shop_id, buyer_id, description, wanted_date, payment_plan)
  VALUES (s.id, v_uid, v_text, p_wanted_date, s.custom_orders)
  RETURNING id INTO v_id;

  PERFORM public.declutter_notify(s.owner_id, 'info', 'New custom order request',
    -- CHANGED (S2-021, 20261112224850): the notice names the day the request ends unanswered (the request sweep,
    -- 20261112091830: the day after its wanted date, or 7 days after it was sent, whichever comes first).
    CASE WHEN p_wanted_date IS NULL
         THEN format('A buyer asked for a custom order. Send a price or decline it by %s.',
                     to_char(v_today + 7, 'FMMonth FMDD'))
         ELSE format('A buyer asked for a custom order by %s. Send a price or decline it by %s.',
                     to_char(p_wanted_date, 'FMMonth FMDD'), to_char(LEAST(p_wanted_date, v_today + 7), 'FMMonth FMDD'))
    END,
    '/shops/dashboard', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_send_custom_request(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_send_custom_request(uuid, text, date) TO authenticated, service_role;
