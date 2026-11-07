-- Q2705 option B (lead 11-07): a GUEST's /declutter first screen in ONE read.
--
-- Option A (ready/b2-q2705-guest-declutter) starts the guest page's own reads from the entry, but the photo rows
-- still wait for the item list (they need its ids): one more Slow 4G round before any card photo can start.
-- declutter_first_screen answers a member's first screen in one read, but it raises not_authenticated for a guest
-- and anon has no EXECUTE on it.
--
-- declutter_guest_first_screen(): the live list fetchLiveItems reads (live or reserved, newest first, at most 500)
-- and those items' photo rows (fetchPhotos' columns, by position), in one answer. SECURITY INVOKER: anon's own row
-- policies decide exactly as for the two REST reads ("declutter items: guests read live": live/reserved, Declutter
-- open to everyone, not hidden, not seed; "declutter photos: guests read with their item"), and it names only
-- columns anon already holds SELECT on (20261031060656_declutter_guest_read.sql). Nothing a guest cannot already read
-- with the two REST calls. Granted to anon only: a member has declutter_first_screen.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; REVOKE/GRANT restated.
CREATE OR REPLACE FUNCTION public.declutter_guest_first_screen()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH items AS (
    SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
           i.porch_ok, i.accepts_offers
      FROM public.declutter_items i
     WHERE i.status IN ('live', 'reserved')
     ORDER BY i.live_at DESC
     LIMIT 500
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC) FROM items t), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id IN (SELECT id FROM items)
    ), '[]'::jsonb)
  );
$fn$;

REVOKE ALL ON FUNCTION public.declutter_guest_first_screen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_first_screen() TO anon, service_role;
COMMENT ON FUNCTION public.declutter_guest_first_screen() IS
  'Q2705: a guest''s /declutter list and its photo rows in one read (SECURITY INVOKER: anon''s row policies decide).';
