-- "Mark sold elsewhere" is not "Delete" (Declutter audit 2, SE2-1 / lead's A2-5, 2026-10-28).
--
-- WHAT WAS WRONG: Manage listing's "Mark sold elsewhere" and "Delete listing" both called
-- declutter_withdraw_item, so a listing the seller sold elsewhere became 'withdrawn' ("Taken down") like a
-- deleted one, left Selling, and no record of the sale was kept.
--
-- WHAT THIS DOES:
--   1. declutter_items.status gains 'sold_elsewhere' (the CHECK restated from 20261020064354 with it added).
--      Every reader that lists statuses by name (Browse 'live', the sweeps, relist/pause, sale counts) leaves it
--      out by construction; the seller's own reads (RLS: their rows, every status) keep it as history.
--   2. declutter_mark_sold_elsewhere(item) (new): the seller marks a listing that is up, paused, waiting for
--      review or off sale as sold elsewhere. Same rules as declutter_withdraw_item (the seller's own item, not
--      reserved/sold/completed, the listing's open offers close and their buyers are told, watchers dropped,
--      photo rows detached and their paths returned for the client to delete: off-sale photos are not left
--      public by URL, lh-authz-rls should-fix 2 on withdraw), but the item is KEPT as 'sold_elsewhere'.
--      A draft cannot be "sold elsewhere" (it was never listed): use Delete.
-- declutter_withdraw_item is NOT changed: Delete stays a withdraw, and installed app builds keep working.
-- Proof: src/test/pglite/declutterSoldElsewhere.pglite.mjs (applied 3x; red without this migration).
-- REPLAY-SAFETY: DROP CONSTRAINT IF EXISTS + ADD; CREATE OR REPLACE.

-- 1. The status.
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_status_check;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_status_check CHECK (status IN (
  'draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed',
  'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere'
));

-- 2. Mark it sold elsewhere.
CREATE OR REPLACE FUNCTION public.declutter_mark_sold_elsewhere(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_paths text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose (as declutter_withdraw_item): an under-18 or struck member may still
  -- close their own listing.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status = 'sold_elsewhere' THEN
    RETURN ARRAY[]::text[];
  END IF;
  -- Up, paused, waiting for review or off sale. Reserved / sold / completed are an in-app sale; a draft was
  -- never listed; rejected / removed are Louisiana Helpr's.
  IF v_item.status NOT IN ('pending_review', 'live', 'paused', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item no longer available',
      format('"%s" sold elsewhere, so your offer is closed. Nothing was charged.', v_item.title),
      '/declutter?tab=buying', v_uid);
  END LOOP;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
  DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
  UPDATE public.declutter_items SET status = 'sold_elsewhere', updated_at = now() WHERE id = p_item_id;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_sold_elsewhere(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_mark_sold_elsewhere(uuid) TO authenticated, service_role;
