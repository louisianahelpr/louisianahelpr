-- Q105 (2): drop the two realtime-published tables no client subscribes to.
--
-- Live 2026-09-23: pg_publication_tables for supabase_realtime held 10 tables;
-- the client's postgres_changes bindings (src/test/realtimeChannelInventory.test.ts)
-- cover 8 of them. `job_checkins` (published 20260322230556) and
-- `platform_settings` (published 20260609160000) have no binding anywhere in
-- src/, supabase/functions, e2e or scripts. A published table still costs WAL
-- decoding in realtime.list_changes on every write, for nobody.
--
-- Replay-safe: each DROP runs only while the table is still a member, so a
-- second or third apply (or a later migration that already dropped it) is a
-- no-op. Guarded by src/test/realtimePublication.test.ts ("every published
-- table has a subscriber").
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_checkins'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.job_checkins';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'platform_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.platform_settings';
  END IF;
END
$$;
