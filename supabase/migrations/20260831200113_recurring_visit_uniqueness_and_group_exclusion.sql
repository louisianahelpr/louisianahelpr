-- Recurring series: one visit per date, and never also a group job.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ONE VISIT PER (SERIES, DATE)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `charge-recurring-visits` protects against generating the same visit twice
-- with an application-level read (index.ts:172-184):
--
--     const [{ data: existing }, ...] = await Promise.all([
--       supabase.from("jobs").select("date_needed")
--         .eq("parent_job_id", parent.id).in("date_needed", due),
--       ...
--     const alreadyThere = new Set((existing ?? []).map((r) => r.date_needed));
--     ...
--     if (alreadyThere.has(visitDate)) { results.skippedExisting++; continue; }
--
-- That is SELECT-then-INSERT with nothing in between. It is correct for serial
-- runs and wrong for overlapping ones: two invocations both read "not there"
-- and both insert. The only unique constraint anywhere near this is on
-- `recurring_visit_releases (parent_job_id, visit_date)` (20260820010000:103);
-- `jobs` has only the NON-unique partial index `idx_jobs_parent_job_id`
-- (20260504164121:23-25).
--
-- WHY THAT COSTS MONEY. The Stripe call is keyed
-- `recurring-visit:${parent.id}:${visitDate}` (index.ts:370), so the poster is
-- charged exactly ONCE no matter how many runs collide — Stripe replays the
-- same PaymentIntent. The DB has no such key. So the outcome of a collision is
-- one charge and TWO `jobs` rows carrying the SAME
-- `stripe_payment_intent_id`, each `payment_status='escrow'`, each
-- individually eligible for auto-release-payment. Both walk to
-- `payout_pending` and both pay the helper. One escrow, two payouts: the
-- platform funds the difference out of its own balance, and nothing in
-- reconciliation is looking for two job rows on one intent.
--
-- Overlap is not hypothetical. The cron fires daily (`6 6 * * *`), but the
-- function is also invokable by hand, `net.http_post` can be re-driven, and a
-- long run (up to MAX_CHARGES_PER_RUN = 200 sequential Stripe calls) has a
-- wide window.
--
-- The index makes the race resolvable instead of silent: one inserter wins,
-- the other gets 23505. The paired change in
-- `charge-recurring-visits/index.ts` recognises 23505 as "a concurrent run
-- already created this visit" and skips WITHOUT refunding — critical, because
-- the loser holds the winner's PaymentIntent, and the pre-existing
-- insert-failed branch would have refunded it out from under a live booked
-- visit.
--
-- PARTIAL, on `parent_job_id IS NOT NULL`: every non-series job and every
-- series PARENT has a NULL `parent_job_id`, and there are tens of them per
-- date. Only child visits are constrained.
--
-- SAFE AGAINST EXISTING DATA: verified read-only against production
-- 2026-08-31 — `jobs` holds 67 rows and ZERO have a non-null `parent_job_id`
-- (no recurring series has ever run; `charge-recurring-visits` has reported
-- `seriesConsidered: 0` on every daily run in the retained cron log). So there
-- is nothing to deduplicate and the index builds clean. It is created
-- unguarded-but-IF-NOT-EXISTS rather than CONCURRENTLY because
-- `supabase db push` runs migrations in a transaction, which forbids
-- CONCURRENTLY, and on a table this size a brief lock is immaterial.

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_visit_per_series_date
  ON public.jobs (parent_job_id, date_needed)
  WHERE parent_job_id IS NOT NULL;

COMMENT ON INDEX public.jobs_one_visit_per_series_date IS
  'A recurring series may have at most one child visit per date. Turns an overlapping charge-recurring-visits run into a 23505 (handled as skippedExisting) instead of two job rows sharing one PaymentIntent, which would pay the helper twice out of one escrow.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. A SERIES IS NEVER ALSO A GROUP JOB
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The two features answer opposite questions — a series books ONE standing
-- helper across MANY dates (`recurring_helper_id`, "the standing helper who
-- holds every visit in this series", 20260820010000:42), a group job splits ONE
-- date across MANY helpers (`group_job_helpers`, one escrow divided N ways,
-- 20260804122000 header). Their money models are incompatible.
--
-- The product treats them as exclusive, but only in the UI: LogisticsSection
-- renders one three-way radio and clears the other flag on every pick
-- (`setIsRecurring(opt.key === "recurring"); setIsGroupJob(opt.key ===
-- "group");`, LogisticsSection.tsx:298-299). The DATABASE has never enforced
-- it, and everything below the form is written as if the combination cannot
-- occur:
--
--   * `charge-recurring-visits` never reads `is_group_job` or `helpers_needed`
--     on the parent (its select is index.ts:107-113) and never copies either
--     onto the child (insert, index.ts:392-436). Children therefore default to
--     `is_group_job = false, helpers_needed = 1`.
--   * `auto-release-payment` DOES branch on them (index.ts:264, 394), as does
--     `release-payout` (index.ts:160) and `process-scheduled-payouts`
--     (index.ts:121).
--
-- So a parent with both flags set would spawn single-helper children from a
-- multi-helper definition, and the parent and its own children would then
-- settle under different payout rules — the parent refused by release-payout
-- as a group job, the children paid as ordinary jobs at the full per-visit
-- budget. A seed script, an import, an admin edit or a future API caller is
-- all it takes; the form is the only thing standing in the way.
--
-- NOT VALID, following the precedent of this table's own recurrence CHECKs
-- (20260820010000:50-77): the constraint governs new and updated rows without
-- demanding a full-table verification pass inside the migration. Production
-- has zero rows that violate it (2 group jobs, both `is_seed`, both with
-- `recurrence_days IS NULL`; 0 recurring rows at all), so it could be
-- validated later at leisure with `VALIDATE CONSTRAINT`.
--
-- REPLAY-SAFETY: `ADD CONSTRAINT` has no IF NOT EXISTS, so it is guarded on
-- `pg_constraint`. Both `is_group_job` (20260311041556) and `recurrence_days`
-- (20260820010000) are created by far earlier migrations.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND conname = 'jobs_series_is_not_group'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_series_is_not_group
      CHECK (NOT (COALESCE(is_group_job, false) AND recurrence_days IS NOT NULL))
      NOT VALID;
  END IF;
END $$;
