-- Declutter top 5, #2 (owner 11-19, "Do all 5", after the Vinted/Depop audit): SELLING HOME. The top of Selling shows a
-- short to-do list and this week's numbers next to last week's, from ONE read.
--
-- declutter_selling_home() -> jsonb, for the caller's own selling only (auth.uid()):
--   week / last_week   the last 7 days and the 7 before them (rolling, so Monday is never an empty week):
--     sales            the caller's Declutter orders paid in the window that went ahead (status paid or handed_over;
--                      a refunded or expired checkout is not a sale);
--     earnings_cents   those orders' items_cents - bundle_discount_cents: what the items sold for. Sellers keep the
--                      whole price (members never see a fee: owner 2026-10-25), so this is what the seller earns;
--     views            people who opened one of the caller's listings in the window (declutter_item_views, one per
--                      item per person or device, the item page's own unique count);
--     saves            hearts added to the caller's listings in the window (declutter_watchlist.created_at; a heart
--                      taken back is no longer counted, so the number never claims a save that is gone).
--   todo
--     to_relist        the caller's paused listings (they come back with Relist);
--     price_drops      live priced listings 14+ days old with price drops off, not sold or reserved: the "drop the
--                      price?" nudge's own rule (declutter_price_nudge_sweep, 20261030141656);
--     savers_to_offer  live listings of $2 or more with at least one save and no offer to savers in the last 24 hours
--                      (declutter_send_saver_offer, 20261120010630).
--   live_count / live_value_cents   what is for sale now and what it is worth if it all sells at today's prices.
-- Offers to answer and sales to hand over are NOT here: Selling already reads them (useDeclutterTodo), and the to-do list
-- uses that same read, so the two never disagree.
--
-- Reads only; STABLE; SECURITY DEFINER only to count views and saves on the caller's OWN listings (the view and
-- watchlist rows belong to other members). Every count is scoped to i.seller_id = auth.uid(); nothing names a person.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated. Proof: src/test/pglite/declutterSellingHome.pglite.mjs (applied 3x).
CREATE OR REPLACE FUNCTION public.declutter_selling_home()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_week jsonb;
  v_last jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'sales', count(*) FILTER (WHERE o.paid_at > v_now - interval '7 days'),
           'earnings_cents', COALESCE(sum(o.items_cents - o.bundle_discount_cents) FILTER (WHERE o.paid_at > v_now - interval '7 days'), 0)),
         jsonb_build_object(
           'sales', count(*) FILTER (WHERE o.paid_at <= v_now - interval '7 days'),
           'earnings_cents', COALESCE(sum(o.items_cents - o.bundle_discount_cents) FILTER (WHERE o.paid_at <= v_now - interval '7 days'), 0))
    INTO v_week, v_last
    FROM public.declutter_orders o
   WHERE o.seller_id = v_uid
     AND o.status IN ('paid', 'handed_over')
     AND o.paid_at > v_now - interval '14 days';

  v_week := v_week || (
    SELECT jsonb_build_object(
             'views', count(DISTINCT (v.item_id, COALESCE(v.viewer_id::text, v.device_id))) FILTER (WHERE v.created_at > v_now - interval '7 days'))
      FROM public.declutter_item_views v
      JOIN public.declutter_items i ON i.id = v.item_id
     WHERE i.seller_id = v_uid
       AND v.created_at > v_now - interval '14 days');
  v_last := v_last || (
    SELECT jsonb_build_object(
             'views', count(DISTINCT (v.item_id, COALESCE(v.viewer_id::text, v.device_id))) FILTER (WHERE v.created_at <= v_now - interval '7 days'))
      FROM public.declutter_item_views v
      JOIN public.declutter_items i ON i.id = v.item_id
     WHERE i.seller_id = v_uid
       AND v.created_at > v_now - interval '14 days');

  v_week := v_week || (
    SELECT jsonb_build_object('saves', count(*) FILTER (WHERE w.created_at > v_now - interval '7 days'))
      FROM public.declutter_watchlist w
      JOIN public.declutter_items i ON i.id = w.item_id
     WHERE i.seller_id = v_uid AND w.user_id <> v_uid AND w.created_at > v_now - interval '14 days');
  v_last := v_last || (
    SELECT jsonb_build_object('saves', count(*) FILTER (WHERE w.created_at <= v_now - interval '7 days'))
      FROM public.declutter_watchlist w
      JOIN public.declutter_items i ON i.id = w.item_id
     WHERE i.seller_id = v_uid AND w.user_id <> v_uid AND w.created_at > v_now - interval '14 days');

  RETURN jsonb_build_object(
    'week', v_week,
    'last_week', v_last,
    'todo', jsonb_build_object(
      'to_relist', (SELECT count(*) FROM public.declutter_items i WHERE i.seller_id = v_uid AND i.status = 'paused'),
      'price_drops', (
        SELECT count(*)
          FROM public.declutter_items i
          JOIN public.declutter_item_private p ON p.item_id = i.id
         WHERE i.seller_id = v_uid
           AND i.status = 'live'
           AND i.current_price_cents > 0
           AND i.live_at IS NOT NULL
           AND i.live_at + interval '14 days' <= v_now
           AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))),
      'savers_to_offer', (
        SELECT count(*)
          FROM public.declutter_items i
         WHERE i.seller_id = v_uid
           AND i.status = 'live'
           AND i.current_price_cents >= 200
           AND EXISTS (SELECT 1 FROM public.declutter_watchlist w WHERE w.item_id = i.id AND w.user_id <> v_uid)
           AND NOT EXISTS (SELECT 1 FROM public.declutter_saver_offer_sends s
                            WHERE s.item_id = i.id AND s.created_at > v_now - interval '24 hours'))),
    'live_count', (SELECT count(*) FROM public.declutter_items i WHERE i.seller_id = v_uid AND i.status = 'live'),
    'live_value_cents', (SELECT COALESCE(sum(i.current_price_cents), 0) FROM public.declutter_items i
                          WHERE i.seller_id = v_uid AND i.status = 'live'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_selling_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_selling_home() TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_selling_home() IS
  'Declutter top 5 #2 (owner 11-19): the caller''s own Selling home: to-do counts and the last 7 days vs the 7 before.';
