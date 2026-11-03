-- Q2390 packet 22 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for five functions that still raised P0002:
--   shops_order_cancel_quote        (STABLE read: what a cancel would send back; writes nothing)
--   admin_send_team_message         (admin writes to a member's team thread; raise before both INSERTs;
--                                    also called by admin-support-reply)
--   promotions_unsubscribe          (service_role; email-unsubscribe; raise before any write)
--   promotions_resubscribe          (service_role; email-unsubscribe; raise before any write)
--   shop_pickup_addresses_owner_is_shop_owner (BEFORE INSERT OR UPDATE trigger on
--                                    shop_pickup_addresses; the raise refuses the row)
-- admin-support-reply and email-unsubscribe read only error.message from these
-- calls, never the SQLSTATE, so they need no map change; shop-checkout's update
-- of a pickup address (tax-location cache) treats any error as non-fatal. The
-- app maps the member-facing ones by message (rpcErrorCopy, adminRpcErrorCopy,
-- lifecycleErrors). None creates an order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   shops_order_cancel_quote               20261019071055 1cb93eb51cf21e318814ebabe4f40a81
--   admin_send_team_message                20261011161100 699cd9200bb951c629398b7f7b32ef74
--   promotions_unsubscribe                 20261102063312 282adb7b56c5a72dfacebf977c2b755d
--   promotions_resubscribe                 20261102063312 092af73269c17277f52c88dc7b3dcfdf
--   shop_pickup_addresses_owner_is_shop_owner 20261018210400 4b53e436441453ecc6475c8f4d001091
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (5 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.shops_order_cancel_quote(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL
     OR EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RETURN jsonb_build_object('can_cancel', false);
  END IF;
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  -- The free cancel's figures are exactly what shop_write_refund will write.
  SELECT * INTO a FROM public.shop_refund_amounts(o.id, 'buyer_cancelled');
  RETURN jsonb_build_object('can_cancel', true, 'free', v_free,
    'free_until', CASE WHEN v_until IS NULL OR NOT isfinite(v_until) THEN NULL ELSE v_until END,
    'paid_cents', o.total_cents,
    'refund_cents', CASE WHEN v_free THEN a.refund_cents ELSE 0 END,
    'kept_cents', CASE WHEN v_free THEN a.kept_cents + a.tax_kept_cents ELSE o.total_cents END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_order_cancel_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_cancel_quote(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_send_team_message(
  p_user_id uuid,
  p_content text,
  p_client_id uuid DEFAULT NULL
)
 RETURNS public.messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin   uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_row     public.messages;
BEGIN
  -- has_role(NULL, ...) is false, so an anonymous caller lands here too.
  IF NOT COALESCE(public.has_role(v_admin, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_user_id = v_admin THEN
    RAISE EXCEPTION 'cannot_message_self' USING ERRCODE = '22023';
  END IF;
  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.messages (job_id, team_thread_user_id, sender_id, receiver_id, content, client_id)
  VALUES (NULL, p_user_id, v_admin, p_user_id, v_content, p_client_id)
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_admin, 'team_message_sent', p_user_id::text, 'user',
          jsonb_build_object('message_id', v_row.id));

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_send_team_message(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_team_message(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promotions_unsubscribe(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_consent boolean;
  v_saved   jsonb;
  v_promo   boolean;
  v_has_row boolean;
  v_record  jsonb;
BEGIN
  SELECT p.marketing_consent, p.promotions_before_unsubscribe
    INTO v_consent, v_saved
    FROM public.profiles p
   WHERE p.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';
  END IF;

  SELECT np.email_promotions INTO v_promo
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id
     FOR UPDATE;
  v_has_row := FOUND;
  IF NOT v_has_row THEN
    v_promo := true;
  END IF;

  v_record := jsonb_build_object('marketing_consent', v_consent IS TRUE,
                                 'email_promotions', to_jsonb(v_promo));
  -- The first record stands while nothing commercial is on (a second link
  -- press, or one after the first). If the member turned something back on
  -- since, the record is what this opt-out turns off NOW.
  IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS TRUE) THEN
    v_record := v_saved;
  END IF;

  PERFORM set_config('app.promotions_undo_write', '1', true);
  UPDATE public.profiles
     SET marketing_consent = false,
         promotions_before_unsubscribe = v_record
   WHERE user_id = p_user_id;
  INSERT INTO public.notification_preferences (user_id, email_promotions)
  VALUES (p_user_id, false)
  ON CONFLICT (user_id) DO UPDATE SET email_promotions = false;
  PERFORM set_config('app.promotions_undo_write', '0', true);

  RETURN v_record;
END;
$fn$;

REVOKE ALL ON FUNCTION public.promotions_unsubscribe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promotions_unsubscribe(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.promotions_resubscribe(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_consent   boolean;
  v_saved     jsonb;
  v_promo     boolean;
  v_untouched boolean;
BEGIN
  SELECT p.marketing_consent, p.promotions_before_unsubscribe
    INTO v_consent, v_saved
    FROM public.profiles p
   WHERE p.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_saved IS NULL THEN
    RETURN 'nothing_to_undo';
  END IF;

  SELECT np.email_promotions INTO v_promo
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id
     FOR UPDATE;
  -- No row reads as promotions on: not what the opt-out left.
  v_untouched := FOUND AND v_consent IS FALSE AND v_promo IS FALSE;

  PERFORM set_config('app.promotions_undo_write', '1', true);
  IF v_untouched THEN
    UPDATE public.profiles
       SET marketing_consent = (v_saved ->> 'marketing_consent')::boolean IS TRUE,
           promotions_before_unsubscribe = NULL
     WHERE user_id = p_user_id;
    IF (v_saved ->> 'email_promotions')::boolean IS DISTINCT FROM false THEN
      UPDATE public.notification_preferences
         SET email_promotions = CASE WHEN (v_saved ->> 'email_promotions')::boolean THEN true END
       WHERE user_id = p_user_id;
    END IF;
  ELSE
    UPDATE public.profiles
       SET promotions_before_unsubscribe = NULL
     WHERE user_id = p_user_id;
  END IF;
  PERFORM set_config('app.promotions_undo_write', '0', true);

  RETURN CASE WHEN v_untouched THEN 'restored' ELSE 'kept_later_choice' END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.promotions_resubscribe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promotions_resubscribe(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_pickup_addresses_owner_is_shop_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  SELECT s.owner_id INTO NEW.owner_id FROM public.shops s WHERE s.id = NEW.shop_id;
  IF NEW.owner_id IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.line1, NEW.line2, NEW.city, NEW.postal_code)
       IS DISTINCT FROM (OLD.line1, OLD.line2, OLD.city, OLD.postal_code) THEN
    NEW.stripe_tax_location_id := NULL;
    NEW.stripe_tax_location_mode := NULL;
    NEW.updated_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only an address change moves updated_at: the edge function's cache
    -- write (location id + mode) keeps it, so the Stripe idempotency key
    -- (shop-taxloc-<shop>-<mode>-<updated_at>) stays the address's own
    -- (review 2026-10-18, finding 5).
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shop_pickup_addresses_owner_is_shop_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_pickup_addresses_owner_is_shop_owner() TO service_role;

