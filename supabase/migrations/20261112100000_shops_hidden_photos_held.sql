-- Q1957 (lh-authz-rls review of shops slice 1; lead decision 11-12, Builder 1 r4): a hidden or banned shop's photos
-- stayed public. Shop logos, covers, gallery and item photos live in job-photos, a PUBLIC bucket, so a hidden shop
-- (shops.hidden_at) or a shop whose owner is banned (not shop_owner_in_good_standing) disappeared from every read and
-- from the shop-photo proxy (shop_link_visible), but each photo kept serving at its public URL to anyone who had it.
-- DECISION (logged in OWNER-DECISIONS 11-12): move the objects, do not change the readers. While a shop is held its
-- photos sit in the PRIVATE bucket shop-photos-held at the SAME path; when it is shown again they move back. No reader
-- changes (a held shop is shown to nobody but admins anyway), and paths in shop_photos / shop_item_photos never
-- change. A held shop cannot attach a new photo (shops_attach_photo / shops_add_item_photo refuse 'shop_hidden' while
-- shop_photos_held, 20261112095000). A stray object uploaded at a held path in job-photos is removed by the mover
-- before it moves the held one back (authz review note 1).
-- The other approach (every shop photo in a private bucket served by signed URL / the proxy) touches every shop
-- image reader, the upload path, the proxy's render URL and the purge list; this one is one list and one mover.
-- HOW: shop_photos_to_move(limit), service_role only, is STATELESS: every shop photo object that sits in the wrong
-- bucket for its shop's state right now (held -> it should be in shop-photos-held; shown -> in job-photos). The
-- declutter-money cron moves each with Storage's move (destinationBucket) and calls it again next run, so a hide, an
-- unhide, a ban, a ban that times out (temp_banned) and a failed move all settle on their own, in either order.
-- REPLAY-SAFE: INSERT ... ON CONFLICT, CREATE OR REPLACE. The bucket has NO storage policy: members can neither read,
-- write nor list it (service_role only). MONEY: none. AUTHZ: lh-authz-rls.
-- Proof: src/test/pglite/shopsHiddenPhotosHeld.pglite.mjs (3x; NEW_MIGRATION=skip red).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shop-photos-held', 'shop-photos-held', false, 15 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Held: hidden by an admin, or the owner is not in good standing (banned, or a temp ban not yet over).
CREATE OR REPLACE FUNCTION public.shop_photos_held(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT s.hidden_at IS NOT NULL OR NOT COALESCE(public.shop_owner_in_good_standing(s.owner_id), false)
      FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_photos_held(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_photos_held(uuid) TO service_role;

-- Every shop photo object in the wrong bucket for its shop right now: (path, from_bucket, to_bucket).
CREATE OR REPLACE FUNCTION public.shop_photos_to_move(p_limit integer DEFAULT 200)
RETURNS TABLE (storage_path text, from_bucket text, to_bucket text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH paths AS (
    SELECT p.shop_id, p.storage_path FROM public.shop_photos p
    UNION ALL
    SELECT i.shop_id, ip.storage_path FROM public.shop_item_photos ip JOIN public.shop_items i ON i.id = ip.item_id
  ), want AS (
    SELECT DISTINCT ON (x.storage_path) x.storage_path,
           CASE WHEN public.shop_photos_held(x.shop_id) THEN 'shop-photos-held' ELSE 'job-photos' END AS to_bucket
      FROM paths x
     ORDER BY x.storage_path
  )
  SELECT w.storage_path, o.bucket_id, w.to_bucket
    FROM want w
    JOIN storage.objects o
      ON o.name = w.storage_path
     AND o.bucket_id IN ('job-photos', 'shop-photos-held')
     AND o.bucket_id <> w.to_bucket
   ORDER BY w.storage_path
   LIMIT greatest(1, least(COALESCE(p_limit, 200), 500));
$fn$;
REVOKE ALL ON FUNCTION public.shop_photos_to_move(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_photos_to_move(integer) TO service_role;
