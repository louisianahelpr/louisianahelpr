-- Hardening of the Declutter photo purge (20261101054258, B63; lead review 11-01, B67).
--
-- declutter_photo_purge_due drops queue entries whose path a photo row still names, but only at claim time: a path
-- attached AGAIN after it was queued (declutter_add_item_photo / declutter_helpr_add_listing_photo name a path by its
-- storage object, so a re-attach of the same object is possible) kept its queue entry, and an entry claimed just
-- before the re-attach was still removed from Storage by the edge function. Not reachable from the app today (every
-- upload gets a fresh random name), closed anyway:
--   1. An AFTER INSERT trigger on declutter_item_photos deletes any queue entry for the path just attached. A trigger,
--      not two restated add RPCs: it covers both add RPCs and any later insert path, and leaves their bodies alone.
--   2. declutter_photo_purge_recheck (service role only): the edge function asks right before each Storage remove
--      which of its claimed paths are STILL queued, claimed and named by no photo row, and removes only those. Any
--      other path in the batch has its entry dropped when a photo row names it.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE TRIGGER; the queue table must exist
-- (20261101054258), so each object is guarded by to_regclass.

CREATE OR REPLACE FUNCTION public.declutter_item_photo_unqueue_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- An attached path is never removed from Storage: its queue entry (if any) goes with the attach, in the same
  -- transaction. No exception handler: if this fails the attach fails, which is the safe side.
  DELETE FROM public.declutter_photo_purge_queue q WHERE q.storage_path = NEW.storage_path;
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

-- Right before the Storage remove: of these claimed paths, which may still go. Row-locked so a concurrent attach of
-- the same path waits for this statement (its trigger's DELETE needs the row) and a path named by a photo row is
-- never returned. Entries for paths a photo row names are dropped here too.
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
     AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.storage_path = q.storage_path)
   ORDER BY q.storage_path
     FOR UPDATE OF q;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photo_purge_recheck(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_photo_purge_recheck(text[]) TO service_role;
