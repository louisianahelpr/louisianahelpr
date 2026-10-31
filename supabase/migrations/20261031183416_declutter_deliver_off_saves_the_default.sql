-- I'll deliver off: the saved default and the live listings change in ONE call (lead review, 2026-10-31).
--
-- What was broken: Declutter settings saved the listing defaults and then called declutter_stop_my_seller_delivery
-- (20261031180550) as a second step. If that second step failed, or the page reloaded between them, the default said
-- "I'll deliver" was off while the seller's live listings still offered it.
--
-- The fix: declutter_stop_my_seller_delivery, restated from 20261031180550 (its only definition), also takes
-- 'seller_delivery' off the caller's own saved default (declutter_seller_defaults, member_id = the caller) in the same
-- transaction. If nothing else is left it becomes 'porch', the column default, as the table's CHECK needs one way.
-- The client calls this FIRST, then saves its other choices, so a failed save can never leave the two disagreeing.
-- Everything else is restated exactly. FOR VERDICT (data change on listings and the saved default).
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; declutter_seller_defaults exists since 20261030144112.
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
  UPDATE public.declutter_seller_defaults d
     SET handovers = CASE WHEN cardinality(array_remove(d.handovers, 'seller_delivery')) < 1 THEN ARRAY['porch']::text[]
                          ELSE array_remove(d.handovers, 'seller_delivery') END,
         updated_at = now()
   WHERE d.member_id = v_uid AND 'seller_delivery' = ANY (d.handovers);
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_stop_my_seller_delivery() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_stop_my_seller_delivery() TO authenticated, service_role;
