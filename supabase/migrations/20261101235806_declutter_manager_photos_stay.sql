-- Manager mode, lead condition (1) on the phase 1 verdict (b756003900 / cad66565e9): a photo a manager uploaded stays
-- on the seller's listing, visible to buyers, and the manager cannot delete it, even after the grant ends.
--
-- The problem: a manager's photo lives in the MANAGER's own folder (job-photos/<manager>/declutter/<item>/...;
-- declutter_manage add_item_photo, 20261101181005). The only policy that lets anyone delete there, "Sellers delete own
-- unattached declutter photos" (20261015042253), lets the folder's owner delete an object once NO declutter_item_photos
-- row names it. But that NOT EXISTS ran as the caller, under the photo table's RLS: a manager cannot read the seller's
-- photo rows (drafts are seller-only, and nothing at all once the grant ends), so to the manager every one of their
-- uploads looked unattached, and they could delete it from under the seller's live listing.
--
-- The fix: the attached check reads declutter_item_photos without RLS, in a SECURITY DEFINER function that answers
-- only "is this path named by a listing photo" (no row data). Same rule for the seller (she sees her own rows anyway);
-- for a manager, an attached object can no longer be deleted. Overwrites were already impossible: no UPDATE policy on
-- job-photos covers a <uid>/declutter/ path (only job folders), read on prod 11-01 from pg_policies.
-- Buyers: job-photos is a PUBLIC bucket (storage.buckets.public = true on prod, 11-01), and listing photos are shown by
-- public URL (src/lib/declutter/api.ts photoPublicUrl / photoCardUrl), so a photo in the manager's folder is shown the
-- same as one in the seller's. Nothing moves when the grant ends.
-- Removing a photo from a listing stays the seller's (or, while the grant is on, the manager's remove_item_photo); the
-- detached object goes through the purge queue (20261101054258) as every other Declutter photo.
--
-- Replay-safe: CREATE OR REPLACE; DROP POLICY IF EXISTS before CREATE POLICY. The helper is EXECUTE for authenticated
-- only (the policy runs as the caller); REVOKE FROM PUBLIC, anon.
-- Proof: src/test/pglite/declutterManagerPhotosStay.pglite.mjs. Guard: src/test/declutterManagerPhotosStay.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_photo_object_attached(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = p_name);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photo_object_attached(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_photo_object_attached(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Sellers delete own unattached declutter photos" ON storage.objects;
CREATE POLICY "Sellers delete own unattached declutter photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'declutter'
    AND (storage.foldername(name))[3] NOT IN ('handover', 'problem')
    AND NOT public.declutter_photo_object_attached(objects.name)
  );
