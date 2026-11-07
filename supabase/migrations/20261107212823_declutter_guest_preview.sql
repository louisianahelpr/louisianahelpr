-- Q2705 (lead 11-07): a GUEST's /declutter first screen, trimmed to what the first cards draw.
--
-- declutter_guest_first_screen (20261107172400) answers the guest's whole list in one read: measured 11-07, 261
-- items with their descriptions and 300 photo rows, 67 KB gzipped (261 KB raw). On Slow 4G, with the page's own code
-- now starting beside it, that read ended at 5.4 s, and every card photo waited on it.
--
-- declutter_guest_preview(): the top of the same list (live or reserved, newest first) as a PREVIEW, the way a
-- member's declutter_first_screen caps its answer at 24: at most 24 items, only the columns a Browse card and its
-- first-screen tags read (no description: the preview shows only with no search, and the full list replaces it), the
-- drop-state columns (fetchDropStates' read, so the "May drop tonight" tag needs no second round), those items' photo
-- rows (fetchPhotos' columns, by position), and `more` (whether the list goes on past the preview). Browse reads the
-- full list itself once the first photos are in.
--
-- SECURITY INVOKER: anon's own row policies decide exactly as for the REST reads ("declutter items: guests read live":
-- live/reserved, Declutter open to everyone, not hidden, not seed; "declutter photos: guests read with their item"),
-- and it names only columns anon already holds SELECT on (verified on prod 11-07 with has_column_privilege: every one
-- below is granted to anon). Nothing a guest cannot already read with the REST calls. Granted to anon only (a member has
-- declutter_first_screen) and service_role.
--
-- service_role BYPASSES row level security: called as service_role this returns hidden sellers', seed and switched-off
-- listings too; any server caller must filter hidden and seed items itself (as for declutter_guest_first_screen).
--
-- declutter_guest_first_screen stays: a page built before this one still calls it and takes its answer as the whole
-- list.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; REVOKE/GRANT restated.
CREATE OR REPLACE FUNCTION public.declutter_guest_preview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH ranked AS (
    SELECT i.id, i.seller_id, i.status, i.title, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
           i.porch_ok, i.accepts_offers, i.sale_mode, i.last_price_drop_on, i.drop_pct, i.drops_stopped
      FROM public.declutter_items i
     WHERE i.status IN ('live', 'reserved')
     ORDER BY i.live_at DESC
     LIMIT 25
  ),
  items AS (
    SELECT * FROM ranked ORDER BY live_at DESC LIMIT 24
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC) FROM items t), '[]'::jsonb),
    'more', (SELECT count(*) FROM ranked) > 24,
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id IN (SELECT id FROM items)
    ), '[]'::jsonb)
  );
$fn$;

REVOKE ALL ON FUNCTION public.declutter_guest_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_preview() TO anon, service_role;
COMMENT ON FUNCTION public.declutter_guest_preview() IS
  'Q2705: the top 24 of a guest''s /declutter list (card columns only), its photo rows and whether more follow (SECURITY INVOKER: anon''s row policies decide).';
