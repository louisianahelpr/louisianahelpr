-- Q2202: a landlord ID photo left behind when the app dies between the upload and the submit RPC is deleted too.
--
-- submitLandlordId (src/lib/rentals/api.ts) uploads the photos to user-documents/<uid>/landlord-id/ and then calls
-- rentals_submit_landlord_id. A closed tab or a crash in between left objects that no landlord_id_reviews row
-- names, so the 30-day sweep (landlord_id_images_due, which walks review rows) never saw them, and only the account
-- purge removed them.
--
-- landlord_id_orphan_photos lists, for the same daily sweep (sweepOrphanLandlordIdImages in
-- supabase/functions/_shared/landlordIdRetention.ts, run by cleanup-abandoned-accounts), every object in a
-- landlord-id folder older than p_min_age_hours that the folder owner's review row does not name (front_path /
-- back_path). The age floor keeps an upload whose submit is a few seconds away. A photo the current review names is
-- never listed: the existing sweep removes it LANDLORD_ID_RETENTION_DAYS after the decision. Storage rows cannot be
-- deleted from SQL (storage.protect_delete), so the edge function removes them through the Storage API.
--
-- service_role only (the cron). Read-only. Replay-safe: CREATE OR REPLACE, grants restated by role name.

CREATE OR REPLACE FUNCTION public.landlord_id_orphan_photos(p_min_age_hours integer DEFAULT 24, p_limit integer DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'user-documents'
     AND split_part(o.name, '/', 2) = 'landlord-id'
     AND split_part(o.name, '/', 3) <> ''
     AND p_min_age_hours IS NOT NULL AND p_min_age_hours >= 1
     AND o.created_at < now() - make_interval(hours => p_min_age_hours)
     AND NOT EXISTS (
       SELECT 1 FROM public.landlord_id_reviews r
        WHERE r.user_id::text = split_part(o.name, '/', 1)
          AND o.name IN (r.front_path, r.back_path))
   ORDER BY o.created_at
   LIMIT greatest(1, least(coalesce(p_limit, 500), 1000));
$fn$;
REVOKE ALL ON FUNCTION public.landlord_id_orphan_photos(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landlord_id_orphan_photos(integer, integer) TO service_role;
