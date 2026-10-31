-- declutter_my_reply_listings came through declutter_assert_member for its caller, and rows were always limited to
-- i.seller_id = v_uid, but check-live-privileges (Q1284) reads a definer's own body for the caller and went red on
-- db-deploy 41152862549. It is scoped, so an "unscoped" allowlist entry would be untrue: read auth.uid() here instead.
-- Restated from prod (prosrc md5 d60d33eaec6472f1048c2e50794169c7); one added line; same caller, same rows, same grants.
CREATE OR REPLACE FUNCTION public.declutter_my_reply_listings(p_wanted_id uuid)
 RETURNS TABLE(id uuid, title text, current_price_cents integer, refuses text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO w FROM public.declutter_wanted d WHERE d.id = p_wanted_id;
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT i.id, i.title, i.current_price_cents,
           CASE
             WHEN (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN 'too_far'
             WHEN EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN 'open_offer'
           END
      FROM public.declutter_items i
     WHERE i.seller_id = v_uid
       AND i.status = 'live'
       AND NOT (i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id))
     ORDER BY i.created_at DESC, i.id
     LIMIT 100;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_reply_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_reply_listings(uuid) TO authenticated, service_role;
