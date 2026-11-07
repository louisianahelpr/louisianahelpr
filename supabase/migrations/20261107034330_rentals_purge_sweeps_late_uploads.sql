-- Q2223 (lead /code-review round 4 of the Q2211 photo pipeline, retention only): an upload that commits while an
-- admin take-down runs is never queued for the purge. The INSERT policy saw the listing open, and the take-down's
-- storage.objects scan (rentals_admin_remove_listing, 20261104175521) could not see the uncommitted row, so the
-- object stayed in the private listing-photos bucket (nothing serves it; its owner can no longer read or delete
-- it) until the account purge removed the owner's folder.
--
-- Fix: rentals_photo_purge_due (restated from 20261019071203, otherwise unchanged) first queues every
-- listing-photos object under a still-taken-down listing's folder (<owner>/rental-listings/<listing>/, the same
-- folder rule the take-down scans) that has no queue entry yet. Such an entry is due 30 days after the property's
-- take-down, like the take-down's own entries, but never before tomorrow: so it is never claimed in the run that
-- created it. A lift that runs at the same moment cannot see an uncommitted entry to lock or drop; by the next run
-- the entry is committed, and either the lift saw (and dropped) it or the listing is no longer taken down and the
-- first DELETE below drops it. The purge vs lift rules (claim, photos_purging) are unchanged.
-- Nothing new is granted: the function stays service_role only.

CREATE OR REPLACE FUNCTION public.rentals_photo_purge_due(p_limit integer DEFAULT 200)
RETURNS TABLE (bucket_id text, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
-- The OUT columns (bucket_id, storage_path) share the queue's column names; ON CONFLICT below names columns.
#variable_conflict use_column
BEGIN
  -- A lift drops its own entries; any left whose listing is no longer taken down are dropped here too.
  DELETE FROM public.rental_photo_purge_queue q
   USING public.rental_listings l
   WHERE q.bucket_id = 'listing-photos'
     AND l.id = public.rentals_photo_path_listing(q.storage_path)
     AND NOT l.removed_by_admin;
  -- Q2223: an object that reached a taken-down listing's folder after the take-down scanned it (an upload that
  -- committed during the take-down) is queued now. Due 30 days after the take-down, never before tomorrow (see the
  -- header: a concurrent lift could not see it yet). ON CONFLICT DO NOTHING keeps an existing entry (and its claim).
  INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason)
  SELECT 'listing-photos', o.name,
         GREATEST(coalesce(p.listings_taken_down_at, now()) + interval '30 days', now() + interval '1 day'),
         'late upload during take-down of listing ' || l.id::text
    FROM storage.objects o
    JOIN public.rental_listings l ON l.id = public.rentals_photo_path_listing(o.name)
    LEFT JOIN public.rental_properties p ON p.id = l.property_id
   WHERE o.bucket_id = 'listing-photos'
     AND split_part(o.name, '/', 1) = l.owner_id::text
     AND l.removed_by_admin
     AND NOT EXISTS (SELECT 1 FROM public.rental_photo_purge_queue q
                      WHERE q.bucket_id = 'listing-photos' AND q.storage_path = o.name)
  ON CONFLICT (bucket_id, storage_path) DO NOTHING;
  -- Round 3 #1: CLAIM what is due, row-locked (SKIP LOCKED: an entry a lift is holding is not handed out), each
  -- re-checked: a listing-photos entry only while its listing is still taken down (or gone with its account).
  -- A lift refuses while a claim is fresh, so nothing handed out here is restored before the cron removes it.
  -- A claim older than 15 minutes (a run that died) is handed out again.
  RETURN QUERY
  WITH pick AS (
    SELECT q.bucket_id AS b, q.storage_path AS sp
      FROM public.rental_photo_purge_queue q
     WHERE q.due_at <= now()
       AND (q.claimed_at IS NULL OR q.claimed_at <= now() - interval '15 minutes')
       AND (q.bucket_id <> 'listing-photos'
            OR NOT EXISTS (SELECT 1 FROM public.rental_listings l
                            WHERE l.id = public.rentals_photo_path_listing(q.storage_path) AND NOT l.removed_by_admin))
     ORDER BY q.due_at, q.storage_path
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
       FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.rental_photo_purge_queue q
     SET claimed_at = now()
    FROM pick
   WHERE q.bucket_id = pick.b AND q.storage_path = pick.sp
  RETURNING q.bucket_id, q.storage_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_purge_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_photo_purge_due(integer) TO service_role;
