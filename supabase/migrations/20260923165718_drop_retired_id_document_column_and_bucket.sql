-- Q196: finish removing the retired "upload your ID to us" path.
--
-- Users never send an ID to Helpr: Stripe Identity collects it (owner,
-- 2026-09-23). Q40 (20260923145614) removed every client, admin and edge
-- reader/writer, emptied profiles.id_document_url, pinned it NULL with CHECK
-- profiles_id_document_url_retired and dropped the bucket's four storage
-- policies. It deliberately did NOT drop the column, because pre-Q40 app
-- builds select it on every public profile. The owner confirmed on 2026-09-23
-- that the app has not launched (no installed builds), so that reason does not
-- apply and the leftovers go now.
--
-- Measured on prod 2026-09-23 before this migration (read-only SQL):
--   profiles.id_document_url      0 non-null rows; CHECK (id_document_url IS NULL)
--   readers of the column         0 functions (pg_proc.prosrc), 0 views,
--                                 0 matviews, 0 policies, 0 triggers; the only
--                                 pg_depend entry is the retired CHECK itself
--   bucket id-documents           exists, private, 0 objects, 0 storage policies
--
-- Code: accountPurge.ts stopped listing the bucket in the same commit, as did
-- the storage orphan-sweep scripts. Either deploy order is safe: measured by
-- the Q196 silent-failure review, a service-role list of a bucket that does
-- not exist returns [] with HTTP 200, so old code purging 'id-documents'
-- removes nothing and reports ok.
--
-- Replay-safe: every statement is guarded (IF EXISTS), and the storage
-- deletes are no-ops once their rows are gone.

-- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.profiles.profiles_id_document_url_retired
-- ACK-REASON: the CHECK only pinned a retired column NULL until it could be dropped; the column goes below (Q196).
-- ACK-DATA-LOSS: none; a CHECK holds no data, and the column it constrains held 0 non-null rows on prod.
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_id_document_url_retired;

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.profiles.id_document_url
-- ACK-REASON: the ID upload was retired in Q40 (Stripe Identity collects the ID); no function, view, policy or client reads the column.
-- ACK-DATA-LOSS: none; 0 non-null rows on prod 2026-09-23, pinned NULL by CHECK since 20260923145614.
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS id_document_url;

-- The id-documents bucket: 0 objects and 0 policies on prod. Deleted the way
-- 20260921212141 deleted profile-videos: storage.protect_delete() refuses a
-- direct DELETE unless storage.allow_delete_query is 'true'. SET LOCAL lasts
-- until the end of the TRANSACTION (not the DO block), so the block RESETs it
-- after the two deletes. Objects first (FK).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  SET LOCAL storage.allow_delete_query = 'true';

  DELETE FROM storage.objects
   WHERE bucket_id IN ('id-documents');

  DELETE FROM storage.buckets
   WHERE id IN ('id-documents');

  RESET storage.allow_delete_query;
END $$;
