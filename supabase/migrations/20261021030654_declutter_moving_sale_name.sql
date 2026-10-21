-- Board 164 / Q2269 (owner approved 2026-10-21): a moving sale's NAME and START date ("Moving to Lafayette ·
-- everything goes", Oct 30 – Nov 1). The smallest true version:
--   * Stored per item on declutter_item_private, exactly like move_out_on (moving-out mode keeps the sale on the
--     items; there is no sale row). export_my_data already exports declutter_item_private with to_jsonb, so both go
--     with the member's data. The table stays RPC-only (RLS on, no policy, no grant to anon/authenticated).
--   * declutter_set_moving_sale: the seller sets both on every moving-sale item still open. The name is public text,
--     so it goes through the contact-leak filter; 3 to 60 letters; the start is from 30 days ago up to the move-out
--     date. A blank name or start clears it.
--   * declutter_seller_moving_sale returns them beside move_out_on; declutter_my_moving_sale gives the seller their own
--     saved values (drafts too) for the form.
--   * "Follow sale" needs NO server change: the client watches every item in the sale (declutter_set_watch), and
--     watchers already get the price-drop alert (declutter_price_drop_sweep). Items added later are not followed,
--     and the button says so.
-- declutter_seller_moving_sale restated from 20261016053625 (prod prosrc md5 4987d6bb20dc7ba89e63ffb2c340756e = that
-- file's body, measured 2026-10-21); a new RETURNS TABLE needs DROP + CREATE; grants restated as live.
-- Replay-safe: IF NOT EXISTS, named CHECKs added only when missing, DROP IF EXISTS + CREATE OR REPLACE.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS sale_name text;
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS sale_starts_on date;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_item_private_sale_name_len') THEN
    ALTER TABLE public.declutter_item_private
      ADD CONSTRAINT declutter_item_private_sale_name_len
      CHECK (sale_name IS NULL OR char_length(sale_name) BETWEEN 3 AND 60);
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.declutter_set_moving_sale(p_name text, p_starts_on date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_name text;
  v_move date;
  v_n integer;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  IF char_length(coalesce(p_name, '')) > 500 THEN
    RAISE EXCEPTION 'invalid_sale_name' USING ERRCODE = '22023', HINT = 'Name the sale in 3 to 60 letters.';
  END IF;
  v_name := NULLIF(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  IF v_name IS NOT NULL AND char_length(v_name) NOT BETWEEN 3 AND 60 THEN
    RAISE EXCEPTION 'invalid_sale_name' USING ERRCODE = '22023', HINT = 'Name the sale in 3 to 60 letters.';
  END IF;
  -- The name is public and skips listing review, so it takes the STRONGER shops filter (handles, domains, "at gmail
  -- dot com", social names) and refuses a house number + street (no address on a moving sale) (lh-authz-rls #1).
  IF v_name IS NOT NULL AND (public.contact_leak_reason(v_name) IS NOT NULL
       OR public.shop_contact_leak_reason(v_name) IS NOT NULL
       OR lower(v_name) ~ '\m[0-9]{1,6}\s+([a-z0-9.]+\s+){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|cir|circle|way|hwy|highway|pkwy|parkway|pl|place|trl|trail)\M') THEN
    RAISE EXCEPTION 'sale_name_contact_info' USING ERRCODE = '23514',
      HINT = 'Keep phone numbers, emails and links out of the sale name.';
  END IF;
  SELECT max(p.move_out_on) INTO v_move
    FROM public.declutter_items i
    JOIN public.declutter_item_private p ON p.item_id = i.id
   WHERE i.seller_id = v_uid AND p.seller_id = v_uid
     AND i.in_moving_sale
     AND i.status IN ('draft', 'pending_review', 'live', 'paused', 'reserved');
  IF v_move IS NULL THEN
    RAISE EXCEPTION 'no_moving_sale' USING ERRCODE = '55000', HINT = 'Add your moving-sale items first.';
  END IF;
  IF p_starts_on IS NOT NULL AND (p_starts_on < v_today - 30 OR p_starts_on > v_move) THEN
    RAISE EXCEPTION 'invalid_sale_dates' USING ERRCODE = '22023', HINT = 'The sale starts on or before your move-out date.';
  END IF;
  -- Every moving-sale item of the caller, whatever its status, so a cleared or changed name never comes back
  -- with an item that returns to sale later (lh-authz-rls #3).
  UPDATE public.declutter_item_private p
     SET sale_name = v_name, sale_starts_on = p_starts_on, updated_at = now()
    FROM public.declutter_items i
   WHERE i.id = p.item_id
     AND i.seller_id = v_uid AND p.seller_id = v_uid
     AND i.in_moving_sale;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_moving_sale(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_moving_sale(text, date) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.declutter_seller_moving_sale(uuid);
CREATE OR REPLACE FUNCTION public.declutter_seller_moving_sale(p_seller_id uuid)
RETURNS TABLE(move_out_on date, sale_name text, sale_starts_on date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_date date;
  v_name text;
  v_start date;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_seller_id IS NULL OR public.declutter_seller_hidden(p_seller_id)
     OR (p_seller_id <> v_uid AND public.are_users_blocked(v_uid, p_seller_id)) THEN
    RETURN;
  END IF;
  -- Q2269: the newest name and start set on any of the sale's open items, beside the move-out date.
  SELECT max(p.move_out_on),
         (array_agg(p.sale_name ORDER BY p.updated_at DESC) FILTER (WHERE p.sale_name IS NOT NULL))[1],
         (array_agg(p.sale_starts_on ORDER BY p.updated_at DESC) FILTER (WHERE p.sale_starts_on IS NOT NULL))[1]
    INTO v_date, v_name, v_start
    FROM public.declutter_items i
    JOIN public.declutter_item_private p ON p.item_id = i.id
   WHERE i.seller_id = p_seller_id
     AND i.in_moving_sale
     AND i.status IN ('live', 'reserved')
     -- The declutter_items select rule: a test seller's sale stays hidden from members the seed switch hides it from
     -- (lh-authz-rls #2).
     AND (i.is_seed IS NOT TRUE OR NOT public.seed_hidden_in_discovery() OR p_seller_id = v_uid);
  IF v_date IS NULL OR v_date < v_today THEN
    RETURN;
  END IF;
  move_out_on := v_date;
  sale_name := v_name;
  -- A start after a moved move-out date is not shown (lh-authz-rls #4).
  sale_starts_on := CASE WHEN v_start <= v_date THEN v_start END;
  RETURN NEXT;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_moving_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_moving_sale(uuid) TO authenticated, service_role;

-- The seller's own saved name and start (any status, drafts too), for the move page's form (lh-authz-rls #7).
CREATE OR REPLACE FUNCTION public.declutter_my_moving_sale()
RETURNS TABLE(sale_name text, sale_starts_on date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT (array_agg(p.sale_name ORDER BY p.updated_at DESC) FILTER (WHERE p.sale_name IS NOT NULL))[1],
           (array_agg(p.sale_starts_on ORDER BY p.updated_at DESC) FILTER (WHERE p.sale_starts_on IS NOT NULL))[1]
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.seller_id = v_uid AND p.seller_id = v_uid AND i.in_moving_sale;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_moving_sale() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_moving_sale() TO authenticated, service_role;
