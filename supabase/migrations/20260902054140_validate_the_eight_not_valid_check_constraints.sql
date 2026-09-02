-- Eight CHECK constraints that read stronger than they are.
--
-- Every one of these was added `NOT VALID`, which means Postgres never
-- verified the rows that already existed. New writes ARE checked, so the
-- exposure is historical only — but the constraint reads, in every schema
-- dump and to every reader, exactly like a constraint that has always held.
-- Three consequences worth naming:
--
--   1. Nobody can tell by looking whether the invariant is true of the data.
--   2. The planner will not use a NOT VALID CHECK for constraint exclusion.
--   3. A pg_dump/restore, or a replay onto a fresh environment, carries the
--      unvalidated state forward — so this never self-heals.
--
-- ── Verified against prod before writing (fncmgoasalhdgfwzhsqa, 2026-09-02) ──
-- The reason this migration is safe is not an argument, it is a count. Every
-- constraint was run as a predicate against the live table and returned ZERO
-- violating rows:
--
--   jobs_budget_range             0      pif_credits_design_len      0
--   jobs_recurrence_days_valid    0      pif_credits_occasion_len    0
--   jobs_recurrence_weeks_range   0      tips_amount_positive        0
--   jobs_series_is_not_group      0      tips_payment_status_valid   0
--
-- That order matters. `VALIDATE CONSTRAINT` takes a scan and FAILS if a single
-- row violates — and because db-deploy.yml applies migrations in sequence, one
-- failure here reddens every later migration too. Checking first is what makes
-- this a no-op rather than a gamble. If this migration is ever re-run against a
-- database whose rows do NOT conform, it is supposed to fail loudly: a
-- constraint silently left NOT VALID is the thing being fixed.
--
-- VALIDATE takes only SHARE UPDATE EXCLUSIVE, so it does not block reads or
-- writes; on tables this size it is instant regardless.
--
-- Replay-safe: validating an already-validated constraint is a no-op, and each
-- one is guarded on existence so a replay onto a database that never had it
-- skips rather than errors.

DO $$
DECLARE
  spec   record;
  n_done int := 0;
  n_skip int := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('jobs',        'jobs_budget_range'),
      ('jobs',        'jobs_recurrence_days_valid'),
      ('jobs',        'jobs_recurrence_weeks_range'),
      ('jobs',        'jobs_series_is_not_group'),
      ('pif_credits', 'pif_credits_design_len'),
      ('pif_credits', 'pif_credits_occasion_len'),
      ('tips',        'tips_amount_positive'),
      ('tips',        'tips_payment_status_valid')
    ) AS t(tbl, con)
  LOOP
    IF to_regclass('public.' || quote_ident(spec.tbl)) IS NULL THEN
      RAISE NOTICE 'skip %.% — table absent', spec.tbl, spec.con;
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_class      r ON r.oid = c.conrelid
        JOIN pg_namespace  n ON n.oid = r.relnamespace
       WHERE n.nspname = 'public'
         AND r.relname = spec.tbl
         AND c.conname = spec.con
    ) THEN
      RAISE NOTICE 'skip %.% — constraint absent', spec.tbl, spec.con;
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    -- Already valid on a replay: say so rather than re-scanning.
    IF EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_class      r ON r.oid = c.conrelid
        JOIN pg_namespace  n ON n.oid = r.relnamespace
       WHERE n.nspname = 'public'
         AND r.relname = spec.tbl
         AND c.conname = spec.con
         AND c.convalidated
    ) THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', spec.tbl, spec.con);
    RAISE NOTICE 'validated %.%', spec.tbl, spec.con;
    n_done := n_done + 1;
  END LOOP;

  RAISE NOTICE 'validate pass: % validated, % skipped', n_done, n_skip;
END $$;
