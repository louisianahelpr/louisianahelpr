-- Retire the liveness expectation of the cron 20260924174847 unscheduled.
--
-- 20260924174847_drop_broadcasts_feature.sql removed the
-- `sweep-pending-broadcast-fan-outs` job from cron.job but left its row in
-- cron_work_expectations. sweep_dead_crons LEFT JOINs expectations to cron.job,
-- so at 2026-09-24 18:53Z it filed "Cron sweep-pending-broadcast-fan-outs is
-- expected to run but does not exist in cron.job" (verdict 'unscheduled',
-- ledger 998885c7) and paged "1 cron(s) need attention" (ledger 66fa774b).
-- Measured live 2026-09-24 22:15Z: that row is the only expectation with no
-- cron.job entry.
--
-- Class guard: src/test/cronLivenessCoverage.test.ts, "a cron a migration
-- unschedules has its expectation retired too".
--
-- Replay-safe: a DELETE of a row that is already gone is a no-op, and the
-- table guard keeps it harmless on a replay that predates the table.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    DELETE FROM public.cron_work_expectations
     WHERE jobname IN ('sweep-pending-broadcast-fan-outs');
  END IF;
END $$;
