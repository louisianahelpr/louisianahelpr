-- Hardening of the Declutter photo purge (20261101054258, B63; lead review 11-01, B67).
--
-- declutter_photo_purge_due drops queue entries whose path a photo row still names, but only at claim time: a path
-- attached AGAIN after it was queued (declutter_add_item_photo / declutter_helpr_add_listing_photo name a path by its
-- storage object, so a re-attach of the same object is possible) kept its queue entry, and an entry claimed just
-- before the re-attach was still removed from Storage by the edge function. Not reachable from the app today (every
-- upload gets a fresh random name), closed anyway:
--   1. An AFTER INSERT trigger on declutter_item_photos guards every attach (both add RPCs and any later insert
--      path; a trigger leaves their bodies alone). An UNCLAIMED queue entry for the path is deleted with the attach.
--      A CLAIMED one (a purge run may be removing that object right now) makes the attach FAIL with
--      photo_not_uploaded, which the app shows as "try again". Only claimed entries are ever removed from Storage, so
--      no attached path can be removed: the window between a run's checks and its Storage remove is closed here,
--      not by a lock (each edge-function RPC is its own transaction, so no lock spans the remove).
--   2. declutter_photo_purge_recheck (service role only): the edge function asks right before each Storage remove
--      which of its claimed paths are still queued and named by no photo row, and removes only those (a cheap
--      second check, not the protection; 1 is). Entries for paths a photo row names are dropped.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE TRIGGER; the queue table must exist
-- (20261101054258), so each object is guarded by to_regclass.

CREATE OR REPLACE FUNCTION public.declutter_item_photo_unqueue_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_claimed_at timestamptz;
  v_found boolean;
BEGIN
  -- Lock the path's entry FIRST, with no filter on claimed_at: a claim UPDATE still in flight is waited for, and the
  -- committed row is read after it (a filter in the locking statement would read the old NULL and skip the lock).
  -- A claimed entry may be mid-removal in Storage: refuse the attach (the caller tries again once the run is done).
  SELECT q.claimed_at, true INTO v_claimed_at, v_found
    FROM public.declutter_photo_purge_queue q
   WHERE q.storage_path = NEW.storage_path
     FOR UPDATE;
  IF v_found AND v_claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023',
      HINT = 'This photo is being removed. Try adding it again in a minute.';
  END IF;
  -- An unclaimed entry (locked above) goes with the attach, in the same transaction. No exception handler: if this
  -- fails the attach fails, which is the safe side.
  IF v_found THEN
    DELETE FROM public.declutter_photo_purge_queue q WHERE q.storage_path = NEW.storage_path;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_photo_unqueue_purge() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.declutter_photo_purge_queue') IS NOT NULL
     AND to_regclass('public.declutter_item_photos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS declutter_item_photo_unqueue_purge ON public.declutter_item_photos;
    CREATE TRIGGER declutter_item_photo_unqueue_purge
      AFTER INSERT ON public.declutter_item_photos
      FOR EACH ROW EXECUTE FUNCTION public.declutter_item_photo_unqueue_purge();
  END IF;
END
$do$;

-- Right before the Storage remove: of these claimed paths, which may still go (still queued, named by no photo row).
-- Its lock ends with this call, so it is a second check only; the attach trigger above is what keeps a claimed path
-- from being attached. A claim older than the in-flight window (15 minutes, as declutter_photo_purge_due) is refused:
-- the run that holds it stalled, and the path may already be handed to another run. Entries for paths a photo row names are dropped here too.
CREATE OR REPLACE FUNCTION public.declutter_photo_purge_recheck(p_paths text[])
RETURNS TABLE (storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  DELETE FROM public.declutter_photo_purge_queue q
   WHERE q.storage_path = ANY (COALESCE(p_paths, '{}'::text[]))
     AND EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.storage_path = q.storage_path);
  RETURN QUERY
  SELECT q.storage_path
    FROM public.declutter_photo_purge_queue q
   WHERE q.storage_path = ANY (COALESCE(p_paths, '{}'::text[]))
     AND q.claimed_at IS NOT NULL
     -- A claim past the 15-minute window has expired (a stalled run; it may be handed out again): never removed on it.
     AND q.claimed_at > now() - interval '15 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.storage_path = q.storage_path)
   ORDER BY q.storage_path
     FOR UPDATE OF q;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photo_purge_recheck(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_photo_purge_recheck(text[]) TO service_role;
