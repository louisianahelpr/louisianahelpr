-- Q2390 packet 27 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   declutter_set_auto_free_days, declutter_set_auto_free (seller's "make it
--        free after N days" switch; app: src/lib/declutter/api.ts. Each raises
--        at the locked item read, before any write, or after its one UPDATE
--        matched no row, so nothing is written. The app maps by message.)
--   declutter_delivery_raise_status (STABLE reader for the buyer's "Raise the
--        pay" panel; src/lib/declutter/deliveryRaise.ts maps by message.)
--   shops_create_item (shop owner adds an item; raises at the locked shop read,
--        before the INSERT. src/lib/shops/items.ts maps by message.)
--   bill_helpr_card_fee_debt (service_role; _shared/helprFaultFee.ts, called by
--        charge-recurring-visits. Raises at the FOR SHARE read, before the
--        INSERT. The caller turns ANY rpc error into a "problem" string and
--        retries the bill on the next run: identical for PT404.)
--   declutter_set_handovers (seller's handover ways on a draft; app api.ts and
--        declutter_manage's 'set_handovers', whose EXCEPTION WHEN OTHERS
--        handler only restores the JWT claims and re-RAISEs, so the SQLSTATE
--        passes through. Raises at the locked item read, before the UPDATE.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_set_auto_free_days           20261030030408 81559d26326b4e7146914da75f13e0b5
--   declutter_delivery_raise_status        20261021185418 03144fec29f37285a56fb73c4e30822f
--   shops_create_item                      20261017061157 c41b58f2226753e6cfd2fc768cfaf46c
--   bill_helpr_card_fee_debt               20261102072106 53018a21eb51a216e40300e5a3f48166
--   declutter_set_handovers                20261028235247 f2106f58a81e4c17778c7517dc533d7e
--   declutter_set_auto_free                20261030030408 379529a69394ff8f9a03ec79bd072b74
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (8 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_set_auto_free_days(p_item_id uuid, p_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NOT NULL AND p_days NOT IN (7, 14, 21, 30) THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Choosing a day count is a selling choice (the member gate); choosing Never never is, so a seller who
  -- can no longer sell (3 strikes, under 18) can still stop it.
  IF p_days IS NOT NULL THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';
  END IF;
  UPDATE public.declutter_item_private SET auto_free_days = p_days, auto_free_day12 = false, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_days;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_auto_free_days(p_item_id uuid, p_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_free_days(p_item_id uuid, p_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_status(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  t public.helpr_tasks;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders x WHERE x.id = p_order_id AND x.buyer_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT tk.* INTO t FROM public.declutter_order_deliveries od JOIN public.helpr_tasks tk ON tk.id = od.task_id
   WHERE od.order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'task_status', t.status,
    'open_until', t.open_until,
    'delivery_cents', o.delivery_cents,
    'raised_cents', COALESCE(t.raised_cents, 0),
    'can_raise', public.declutter_delivery_raise_open(o, t, 60) AND COALESCE(t.raised_cents, 0) + 500 <= 15000,
    'room_cents', greatest(15000 - COALESCE(t.raised_cents, 0), 0),
    'rules', public.declutter_delivery_raise_rules(),
    'raises', COALESCE((SELECT jsonb_agg(jsonb_build_object('raise_cents', r.raise_cents, 'card_fee_cents', r.card_fee_cents,
                          'total_cents', r.total_cents, 'refund_cents', r.refund_cents, 'status', r.status, 'refund_reason', r.refund_reason,
                          'paid_at', r.paid_at) ORDER BY r.created_at)
                          FROM public.declutter_delivery_raises r
                         WHERE r.order_id = o.id AND r.status IN ('applied', 'refunding', 'refunded')), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delivery_raise_status(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_status(p_order_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_create_item(
  p_kind text,
  p_subtype text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_lead_time_days integer,
  p_stock_count integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop public.shops%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_shop.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501', HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  IF NOT v_shop.offers_selling THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '22023', HINT = 'Turn on selling for your shop first.';
  END IF;
  PERFORM public.shops_check_item_fields(p_kind, p_subtype, p_title, p_description, p_price_cents, p_lead_time_days, p_stock_count);
  -- D6: at most 100 items a shop keeps (withdrawn ones do not count).
  IF (SELECT count(*) FROM public.shop_items i WHERE i.shop_id = v_shop.id AND i.status <> 'withdrawn') >= 100 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023', HINT = 'A shop can list up to 100 items.';
  END IF;

  INSERT INTO public.shop_items (shop_id, owner_id, kind, subtype, title, description, price_cents, lead_time_days, stock_count)
  VALUES (v_shop.id, v_uid, p_kind, p_subtype, btrim(p_title), COALESCE(btrim(p_description), ''),
          p_price_cents, p_lead_time_days, p_stock_count)
  RETURNING id INTO v_id;
  INSERT INTO public.shop_item_private (item_id, owner_id) VALUES (v_id, v_uid);
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_create_item(p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer, p_lead_time_days integer, p_stock_count integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_create_item(p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer, p_lead_time_days integer, p_stock_count integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bill_helpr_card_fee_debt(
  p_visit_payment_id uuid,
  p_card_fee_cents integer,
  p_refund_ref text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row record;
  v_cents integer;
  v_id uuid;
BEGIN
  IF p_visit_payment_id IS NULL OR p_card_fee_cents IS NULL OR p_card_fee_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_debt' USING ERRCODE = '22023';
  END IF;
  -- FOR SHARE: the visit row (and its series, for is_seed) cannot change under the bill.
  SELECT v.id, v.helper_id, v.parent_job_id, v.amount_cents, v.stripe_payment_intent_id, j.is_seed
    INTO v_row
    FROM public.recurring_visit_payments v
    JOIN public.jobs j ON j.id = v.parent_job_id
   WHERE v.id = p_visit_payment_id
   FOR SHARE OF v, j;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit_payment_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Only a visit that was paid has a card fee, and only its own Helpr owes it.
  IF v_row.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'visit_payment_not_paid' USING ERRCODE = '22023';
  END IF;
  IF v_row.helper_id IS NULL THEN
    RAISE EXCEPTION 'visit_payment_no_helper' USING ERRCODE = '22023';
  END IF;
  -- Never more than the visit's charge.
  v_cents := least(p_card_fee_cents, v_row.amount_cents);
  INSERT INTO public.helpr_card_fee_debts
    (helper_id, source, recurring_visit_payment_id, job_id, card_fee_cents, remaining_cents, refund_ref, is_seed)
  VALUES
    (v_row.helper_id, 'series_visit_lapsed', v_row.id, v_row.parent_job_id, v_cents, v_cents,
     NULLIF(btrim(COALESCE(p_refund_ref, '')), ''), v_row.is_seed)
  ON CONFLICT (recurring_visit_payment_id) DO NOTHING
  RETURNING id INTO v_id;
  -- A replay (the visit already billed) bills nothing.
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE v_cents END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bill_helpr_card_fee_debt(p_visit_payment_id uuid, p_card_fee_cents integer, p_refund_ref text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_helpr_card_fee_debt(p_visit_payment_id uuid, p_card_fee_cents integer, p_refund_ref text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_handovers(p_item_id uuid, p_handovers text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_ways text[];
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- The set, each way once, in one order; NULLs dropped.
  SELECT COALESCE(array_agg(DISTINCT w ORDER BY w), ARRAY[]::text[]) INTO v_ways
    FROM unnest(COALESCE(p_handovers, ARRAY[]::text[])) AS w WHERE w IS NOT NULL;
  IF cardinality(v_ways) < 1 OR NOT (v_ways <@ ARRAY['porch', 'seller_delivery', 'meetup', 'delivery']::text[]) THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
      HINT = 'Tick at least one way buyers can get it: porch pickup, you deliver, a safe meeting spot or Helpr delivery.';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- A free item is claimed through the free checkout, which takes porch pickup only (of these four).
  IF v_item.price_cents = 0 AND v_ways <> ARRAY['porch']::text[] THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
      HINT = 'A free item is picked up from your porch.';
  END IF;

  UPDATE public.declutter_items
     SET handovers = v_ways, porch_ok = ('porch' = ANY (v_ways)), updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  RETURN v_ways;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_handovers(p_item_id uuid, p_handovers text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_handovers(p_item_id uuid, p_handovers text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_auto_free(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Turning it ON is a selling choice (the member gate); turning it OFF never is, so a seller who can
  -- no longer sell (3 strikes, under 18) can still stop it, as pausing a listing works (review #2).
  IF p_on THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';
  END IF;
  -- ON keeps a day count already chosen, else 14 (lead decision 1); OFF is Never.
  UPDATE public.declutter_item_private
     SET auto_free_days = CASE WHEN p_on THEN COALESCE(auto_free_days, 14) END, auto_free_day12 = false, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_on;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_auto_free(p_item_id uuid, p_on boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_free(p_item_id uuid, p_on boolean) TO authenticated, service_role;

