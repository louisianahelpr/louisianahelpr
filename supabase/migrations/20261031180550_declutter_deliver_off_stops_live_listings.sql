-- LEAD-DELIVER-OFF-ALL (owner 2026-10-31, through the lead): unticking "I'll deliver" in Declutter settings also stops
-- delivery on the seller's listings that are already up, not only new ones. Re-ticking it restores the default for
-- new listings only (the client saves the default; nothing here adds a way back).
--
-- New function, no restatement: the ways freeze once listed (declutter_items_handovers_guard, newest CREATE
-- 20261029205908_declutter_edit_listing.sql), and that guard already lets a LIVE item's ways change while
-- declutter.editing_listing names the item, the flag declutter_edit_listing sets (newest 20261031083708). This sets it
-- per item, as that function does, and clears it after.
--
-- Only the caller's own LIVE listings that offer 'seller_delivery' change. Open orders keep the way they chose (it is
-- frozen on declutter_orders.handover). Paused, reserved and sold listings are not touched. A listing whose only way
-- was 'seller_delivery' gets Helpr delivery, which a paid checkout always offers (owner 2026-10-29, DC-4), so it can
-- still be bought. Returns how many listings changed. FOR VERDICT (data change on listings).
CREATE OR REPLACE FUNCTION public.declutter_stop_my_seller_delivery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  r record;
  v_ways text[];
  v_n integer := 0;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  FOR r IN
    SELECT i.id, i.handovers FROM public.declutter_items i
     WHERE i.seller_id = v_uid AND i.status = 'live' AND 'seller_delivery' = ANY (i.handovers)
     ORDER BY i.id
     FOR UPDATE
  LOOP
    v_ways := array_remove(r.handovers, 'seller_delivery');
    IF cardinality(v_ways) < 1 THEN
      v_ways := ARRAY['delivery']::text[];
    END IF;
    PERFORM set_config('declutter.editing_listing', r.id::text, true);
    UPDATE public.declutter_items SET handovers = v_ways, updated_at = now() WHERE id = r.id AND seller_id = v_uid;
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('declutter.editing_listing', '', true);
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_stop_my_seller_delivery() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_stop_my_seller_delivery() TO authenticated, service_role;
