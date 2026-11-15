-- shops_my_custom_requests reads only (stable). Builder 4b, 2026-11-15, Q1816 (a11y-webkit-prod #2375).
--
-- Measured: A11y in WebKit (prod) 43470000763 (2026-11-13) showed "We couldn't load your custom requests" on
-- /shops/orders for both test accounts at both phone themes. Its log has "[a11y-prod] aborted volatile rpc
-- shops_my_custom_requests": the prod sweep lets through only stable/immutable RPCs (e2e/a11y-prod/readOnlyRpcs.ts),
-- and this read was VOLATILE because it first stored the caller's lapsed quotes as 'expired' (20261106202917).
--
-- That write-on-read also cost the buyer a notice: shop_custom_request_sweep (20261112091830) tells the buyer
-- "Custom order price ended" only for the rows ITS update moves from quoted to expired, so a buyer who opened My
-- orders after the 7 days and before the sweep had the row moved by this read and never got the notice.
--
-- Now the read reports a quote past expires_at as 'expired' without storing it; the sweep stores it and tells the
-- buyer. Every writer that acts on a quote already refuses one past expires_at itself (shops_order_custom_quote,
-- shops_decline_custom_request, the "3 open quotes" count, the reopen), so nothing relied on the stored status.
-- Same columns, same order, same block rule, same 100-row cap; SECURITY DEFINER, search_path and grants unchanged.
CREATE OR REPLACE FUNCTION public.shops_my_custom_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x.j ORDER BY x.created_at DESC)
      FROM (
        SELECT r.created_at, jsonb_build_object(
                 'id', r.id, 'shop_id', r.shop_id, 'shop_name', s.name,
                 'role', CASE WHEN r.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END,
                 'description', r.description, 'wanted_date', r.wanted_date, 'payment_plan', r.payment_plan,
                 -- A quote past its 7 days reads as expired here; shop_custom_request_sweep stores it and tells the buyer.
                 'status', CASE WHEN r.status = 'quoted' AND r.expires_at <= now() THEN 'expired' ELSE r.status END,
                 'quote_cents', r.quote_cents, 'quote_note', r.quote_note,
                 'quoted_at', r.quoted_at, 'expires_at', r.expires_at, 'created_at', r.created_at) AS j
          FROM public.shop_custom_requests r
          JOIN public.shops s ON s.id = r.shop_id
         WHERE (r.buyer_id = v_uid OR s.owner_id = v_uid)
           AND NOT public.are_users_blocked(r.buyer_id, s.owner_id)
         ORDER BY r.created_at DESC
         LIMIT 100) x), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.shops_my_custom_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_custom_requests() TO authenticated, service_role;
