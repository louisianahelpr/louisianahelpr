-- A taken-down Declutter listing can be put back (owner 2026-10-28, walkthrough shots 48-49; deep audit SE-1).
--
-- Before: "Take down" (Manage -> Delete listing, or Take down on a listing waiting for review) ran
-- declutter_withdraw_item, which sets the item to 'withdrawn' and deletes its photos. Nothing could
-- move it out of 'withdrawn' again: declutter_relist_listing accepts only 'paused', and the Selling tab
-- hid every withdrawn item. A taken-down listing vanished with no history and no way back.
--
-- After: declutter_reopen_listing(item) moves the caller's OWN 'withdrawn' item back to 'draft' (its
-- title, description, category, price and private lowest price kept; its photos are gone, deleted at
-- take-down). The seller then finishes it in the sell flow, which publishes through
-- declutter_publish_item: every listing rule (photos, pickup times, review of a new seller's first
-- listings, the setup fee, ID, strikes, age) runs again there, so reopening grants nothing a new
-- draft would not. withdrawn -> draft fires no listing trigger (declutter_identity_before_list and
-- declutter_setup_fee_before_list act only on a move INTO pending_review/live).
--
-- Who: the seller only (seller_id = auth.uid()), behind the 'declutter' switch, not banned, and the
-- selling gate (declutter_assert_member(true): strikes, under 18), as relisting. Only 'withdrawn':
-- 'removed' (Louisiana Helpr removed it) and 'rejected' stay where they are.
-- authenticated may execute; PUBLIC and anon may not.

CREATE OR REPLACE FUNCTION public.declutter_reopen_listing(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET status = 'draft', updated_at = now() WHERE id = p_item_id;
  RETURN 'draft';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_reopen_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_reopen_listing(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_reopen_listing(uuid) IS
  'The seller puts their own taken-down (withdrawn) Declutter listing back to a draft to finish and publish again (owner 2026-10-28). Every listing rule runs again at publish.';
