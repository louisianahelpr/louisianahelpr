-- b1e review should-fix (lh-authz-rls on 20261112010100, lead 11-11): the seller's list of people asking for a FREE item
-- (declutter_free_requests_for_item) already drops a requester either side blocked (are_users_blocked), but it still
-- showed a BANNED requester's first name + last initial. Like the other Declutter cards since 20261112010100, the name
-- now goes whenever public.declutter_names_hidden(seller, requester) is true (a block either way, or an active ban on
-- either side): the row reads "A neighbor", the fallback it already used for a member with no name. The row itself
-- stays (picking a banned requester is refused elsewhere; this change only narrows what the list shows).
--
-- declutter_free_requests_for_item restated VERBATIM from its newest definition,
-- 20261103044956_shop_settings_declutter_wanted_not_found_is_404.sql, with the change marked "CHANGED 20261112023218".
-- Replay-safe: CREATE OR REPLACE of the same signature; grants restated by role name.
-- Proof: src/test/pglite/declutterFreeRequestsHideBannedName.pglite.mjs. Sensitive: authz (what one member sees of
-- another).

CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(p_item_id uuid)
 RETURNS TABLE(request_id uuid, requester_id uuid, display_name text, avg_rating numeric, review_count integer, created_at timestamptz, pickup_at timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT r.id, r.requester_id,
           -- CHANGED 20261112023218: no name across a block or a ban (either side); the row's own fallback words instead.
           CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor'
                ELSE public.member_display_name(p.full_name, 'A neighbor') END,
           s.avg_rating, s.review_count, r.created_at, r.pickup_at
      FROM public.declutter_free_requests r
      LEFT JOIN public.profiles p ON p.user_id = r.requester_id
      LEFT JOIN LATERAL (SELECT g.avg_rating, g.review_count FROM public.get_public_profile_stats(ARRAY[r.requester_id]) g LIMIT 1) s ON true
     WHERE r.item_id = p_item_id AND r.status = 'open'
       AND NOT public.are_users_blocked(v_uid, r.requester_id)
     ORDER BY r.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_free_requests_for_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_requests_for_item(uuid) TO authenticated, service_role;
