-- crew_dispute_member_outcomes.decided_by gets the FK its precedent has.
--
-- 20260927012240 left decided_by without a FK "as disputes.decided_by does".
-- disputes.decided_by DOES have one: live pg_constraint (2026-09-27) shows
-- disputes_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id)
-- ON DELETE SET NULL. SET NULL is exactly the stated intent: the outcome row
-- (a money record) outlives a deleted admin, only the pointer is cleared, and
-- a decided_by can never name a user who does not exist.
-- userIdForeignKeys.test.ts (Q282/Q331) fails without it.
--
-- NOT VALID: existing rows are not re-scanned under a lock; new and updated
-- rows are checked. Replay-safe: guarded on the table and the constraint.

DO $$
BEGIN
  -- Nested, not AND: the ::regclass cast below is evaluated even when the
  -- table is absent, and errors (PGlite replay, 2026-09-27).
  IF to_regclass('public.crew_dispute_member_outcomes') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.crew_dispute_member_outcomes')
          AND conname = 'crew_dispute_member_outcomes_decided_by_fkey'
     ) THEN
    ALTER TABLE public.crew_dispute_member_outcomes
      ADD CONSTRAINT crew_dispute_member_outcomes_decided_by_fkey
      FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
