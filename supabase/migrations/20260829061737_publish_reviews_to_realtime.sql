-- Add public.reviews to the realtime publication.
--
-- WHY: useActivityData's realtime channel binds postgres_changes on six
-- table/filter pairs, one of which is `reviews` (INSERT, reviewee_id=eq.me).
-- `reviews` was never in `supabase_realtime`, and Supabase Realtime rejects a
-- channel containing ANY binding on an unpublished table — the whole channel
-- errors and NONE of its bindings deliver. That silently killed live updates
-- for the entire Activity feed (jobs, applications, job_tracking included):
-- a poster watching My Posts never saw the helper's progression (proven live
-- 2026-08-28, job db21c20d-82ad-4016-9c7e-5a79051b4c8f).
--
-- Replay-safe + idempotent: guarded on the table existing and not already
-- being in the publication.
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reviews'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews';
  END IF;
END $$;
