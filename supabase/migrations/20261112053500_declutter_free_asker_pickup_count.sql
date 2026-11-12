-- Audit 11-10 F359d, the asker half (owner 11-11 ~5:00 PM: the seller card shows a pickup COUNT, "12 pickups"; lead
-- 11-12: the same under each person asking for a free item). The giver's list of askers
-- (declutter_free_requests_for_item) gains pickup_count: how many Declutter pickups this asker completed AS A BUYER.
-- The same rule as the seller count (20261112002528), from the other side: a declutter_orders row with this buyer and
-- status 'handed_over', not test data (o.is_seed), with a seller who is not a test member and not the asker's own second
-- account (profile_review_same_person). A count only: no dates, items or seller names. No no-show count (decided by
-- recommendation 11-12, OWNER-DECISIONS.md: the owner's ruling was a count of pickups, nothing else).
-- NULL across a block or a ban (declutter_names_hidden, the rule the name already follows), for a test asker and for a
-- deleted (anonymised) account (review should-fix, the seller count's rule).
--
-- Restated VERBATIM from its newest definition, 20261112023218_declutter_free_requests_hide_banned_requester_name.sql,
-- plus that column (marked "CHANGED 20261112053500"). A new OUT column cannot be added by CREATE OR REPLACE, so it is
-- dropped and created again (no SQL object depends on it; the app reads it by name), grants restated by role name.
-- Replay-safe: DROP IF EXISTS + CREATE. Reads only objects that exist before this timestamp (declutter_orders,
-- is_test_member 20261030015205, profile_review_same_person 20261105165059, declutter_names_hidden 20261112010100).
-- Proof: src/test/pglite/declutterFreeAskerPickupCount.pglite.mjs. Sensitive: authz (what one member learns of another).

DROP FUNCTION IF EXISTS public.declutter_free_requests_for_item(uuid);
CREATE FUNCTION public.declutter_free_requests_for_item(p_item_id uuid)
 RETURNS TABLE(request_id uuid, requester_id uuid, display_name text, avg_rating numeric, review_count integer, created_at timestamptz, pickup_at timestamptz,
                pickup_count integer)
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
           s.avg_rating, s.review_count, r.created_at, r.pickup_at,
           -- CHANGED 20261112053500 (F359d): how many Declutter pickups this asker completed as a buyer (handed_over
           -- orders, no test data, no test seller, not from their own second account). A count only. NULL across a
           -- block or a ban, for a test asker and for a deleted (anonymised) account, so the card shows no line.
           CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) OR public.is_test_member(r.requester_id)
                     OR p.anonymized_at IS NOT NULL THEN NULL
                ELSE (SELECT count(*)::integer
                        FROM public.declutter_orders o
                       WHERE o.buyer_id = r.requester_id
                         AND o.status = 'handed_over'
                         AND o.is_seed IS NOT TRUE
                         AND NOT public.is_test_member(o.seller_id)
                         AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) END
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
