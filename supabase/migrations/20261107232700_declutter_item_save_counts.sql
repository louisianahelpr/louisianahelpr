-- Owner 11-07 (after reviewing Vinted): each Browse card's heart shows how many people saved the item. The saves are
-- rows of declutter_watchlist (the item page's and Browse's heart, row 46), which a member may read only for their
-- own rows ("declutter watchlist: member reads own"), so no caller can count anyone else's saves today.
--
-- declutter_item_save_counts(p_item_ids): for the items the caller passes (at most 200, a Browse page), how many
-- members saved each. Only a NUMBER per item, never who saved it, and only for items the caller can already see
-- (rows with no saves are left out; the client reads a missing item as 0):
--   - a guest (no auth.uid()): exactly the anon row policy "declutter items: guests read live" (live or reserved,
--     declutter_open_to_guests(), seller not hidden, not seed);
--   - a member: the listing half of "declutter items: seller or switched-on members read live" (live or reserved,
--     feature_enabled_for('declutter'), seller not hidden, seed only while seed_hidden_in_discovery() is off, not a
--     seller in a block with the caller), plus the caller's own live or reserved items.
-- An id the caller cannot see is left out, exactly like an id with no saves, so a hidden, seed, blocked or ended
-- item's count never leaks. SECURITY DEFINER only to count rows the caller's own policy hides; the visibility rules
-- above are restated here, in the WHERE, and checked by src/test/pglite/declutterItemSaveCounts.pglite.mjs.
--
-- Granted to anon and authenticated: guests land on Browse from Facebook and see the same hearts' numbers.
-- Called AFTER the list has painted (a separate read, never part of the first screen's loading gate).
--
-- Helpers named below exist on prod (pg_proc, 11-07): declutter_open_to_guests(), feature_enabled_for(text),
-- seed_hidden_in_discovery(), declutter_my_block_partners() (all STABLE, SECURITY DEFINER).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; REVOKE/GRANT restated. The helpers come from earlier migrations
-- (20261012031120, 20261031060656 and the block / seed migrations), so a from-scratch replay has them.
CREATE OR REPLACE FUNCTION public.declutter_item_save_counts(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, saves integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_item_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023', HINT = 'Ask about at most 200 items at a time.';
  END IF;
  IF v_uid IS NULL THEN
    IF NOT public.declutter_open_to_guests() THEN
      RETURN;
    END IF;
    RETURN QUERY
      SELECT w.item_id, count(*)::integer
        FROM public.declutter_watchlist w
        JOIN public.declutter_items i ON i.id = w.item_id
       WHERE w.item_id = ANY (p_item_ids)
         AND i.status IN ('live', 'reserved')
         AND NOT i.seller_hidden
         AND NOT i.is_seed
       GROUP BY w.item_id;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.item_id, count(*)::integer
      FROM public.declutter_watchlist w
      JOIN public.declutter_items i ON i.id = w.item_id
     WHERE w.item_id = ANY (p_item_ids)
       AND i.status IN ('live', 'reserved')
       AND (
         i.seller_id = v_uid
         OR (
           public.feature_enabled_for('declutter')
           AND NOT i.seller_hidden
           AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())
           AND NOT (i.seller_id = ANY (COALESCE(public.declutter_my_block_partners(), '{}'::uuid[])))
         )
       )
     GROUP BY w.item_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_item_save_counts(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_save_counts(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_item_save_counts(uuid[]) IS
  'Owner 11-07: how many members saved each passed item (Browse hearts), only for items the caller can see; a number, never who.';
