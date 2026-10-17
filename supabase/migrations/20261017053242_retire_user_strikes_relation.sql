-- Q1682: 20261015000241_drop_unused_user_strikes DROPs public.user_strikes.
-- A stale client build that still names it gets PGRST205 (relation not
-- found); public.retired_client_relations is how the error logger tells that
-- apart from a real missing-table bug (20260925234342), so the dropped table
-- is listed here (src/test/retiredRelationReadsAreNotNoise.test.ts requires
-- every relation a migration retires to be listed).
--
-- Replay-safe: ON CONFLICT DO NOTHING; the table exists since 20260925234342.

INSERT INTO public.retired_client_relations (relation, retired_by) VALUES
  ('user_strikes', '20261015000241')
ON CONFLICT DO NOTHING;
