-- Retire the last of the business-approval scaffolding.
--
-- WHAT THE OWNER SAW: a panel on their own posted job reading "Waiting on your
-- team's approver. This post is over your team's approval limit." There is no
-- team. There never was one for this account.
--
-- WHY IT RENDERED: `jobs.status = 'pending_approval'` on exactly two rows.
-- Both are `is_seed = true` fixtures with `business_id IS NULL`; one of them is
-- owned by the app owner's own account, which is how it reached their screen.
-- Nothing in the product can produce that status:
--
--   * `businesses` / `business_members` were dropped in 20260828011811.
--     Confirmed against prod today: both return PGRST205 "Could not find the
--     table". `businesses.require_approval_above` — the threshold that was
--     supposed to gate this — went with them.
--   * The one code path that could write the status was
--     `buildJobInsertPayload({ initialStatus: 'pending_approval' })` in
--     src/pages/postjob/jobSubmitHelpers.ts. `grep -rn "initialStatus:" src/`
--     returned zero call sites — it was never once set. That parameter is
--     deleted in the same change as this migration.
--   * The jobs INSERT policy (rewritten by 20260828011811) now requires
--     `business_id IS NULL`, so the trigger's own guard
--     (`business_id IS NOT NULL`) can never be satisfied again either.
--
-- So the status was unreachable going forward and incoherent on the two rows
-- that had it. This migration cleans up what is left.
--
-- THE `pending_approval` ENUM VALUE IS DELIBERATELY KEPT. Dropping an enum
-- label is a heavy, non-transactional migration, and the app's exhaustiveness
-- guards (src/lib/assertNever.ts, src/test/jobStatusExhaustive.test.ts,
-- statusLabels/statusColors, the transition matrix in 20260828020000) all still
-- handle it on purpose so a stray row can never again render as a blank card.
-- Leave the type alone.
--
-- REPLAY-SAFETY: every drop is IF EXISTS; the data fix is guarded on the enum
-- label existing, on the columns existing, and matches on status so a replay
-- after the first run updates zero rows.

-- ---------------------------------------------------------------------------
-- 1. The approver notification trigger — REMOVE, don't repoint the link.
--
-- `notify_business_approvers()` fired AFTER INSERT ON jobs and, when a row
-- landed in 'pending_approval' with a non-null business_id, INSERTed a
-- notification for every active owner/approver/admin in `business_members`
-- pointing at '/business/team?tab=approvals' (20260609170000, line ~536).
-- That route does not exist in the router — a tap on the notification is a
-- dead end.
--
-- DECISION: remove the trigger and the function rather than fix the link.
-- Notifying business approvers is the function's *only* purpose; with
-- `business_members` dropped its FROM clause references a table that is gone,
-- so it could not execute even if it fired, and there is no approver left to
-- notify and no approvals surface to send them to. Repointing the link would
-- leave a trigger on the hot path of every job INSERT whose entire body is
-- unreachable. Deleting it is strictly less code and strictly less risk.
--
-- 20260828011811 already dropped both, and prod confirms it (the tables from
-- that same transaction are gone). These statements are re-asserted here so
-- the intent is recorded at the site of the decision and so a replay against a
-- database restored from an older backup converges to the same place. They are
-- no-ops on current prod.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_notify_business_approvers ON public.jobs';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.notify_business_approvers();

-- ---------------------------------------------------------------------------
-- 2. Sweep any notification row the trigger already wrote.
--
-- Prod count today: 0 (`/notifications?link=like./business*` returns an empty
-- set with `count=exact`). No real user has one. Kept as a guarded sweep so a
-- replay against an older snapshot — where the trigger may have fired before
-- the tables went away — does not leave a user holding a notification whose
-- only action is a 404. Matches '/business%' so it also catches the older
-- '/business-team' link shape from 20260425235407 / 20260824070000.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_deleted integer;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications
     WHERE link LIKE '/business%';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'retire_business_approval_residue: deleted % dead /business notification(s)', v_deleted;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The two stranded seed jobs -> 'in_progress'.
--
-- WHY 'in_progress' AND NOT 'open'. These rows are not fresh listings. Both
-- carry, today:
--
--   helper_id                   set (a helper is assigned)
--   payment_status              'escrow' (the poster's money is held)
--   poster_confirmed_at         set
--   helper_confirmed_at         set
--   helper_on_the_way_at        set
--   helper_arrived_at           set
--   poster_confirmed_arrival_at set
--   helper_completed_at         set (the helper marked the work done)
--   date_needed                 2026-08-26 (in the past)
--
-- Writing 'open' onto that would be worse than the bug being fixed: an "open"
-- job with an assigned helper and funded escrow re-enters the Browse feed for
-- other helpers to apply to, and contradicts every timestamp on the row.
-- 'cancelled' — the one edge the transition matrix actually allows out of
-- 'pending_approval' — is wrong for a different reason: it strands escrow on a
-- job whose work was completed, which is exactly the shape
-- money-reconciliation exists to flag.
--
-- 'in_progress' + escrow + a past `helper_completed_at` is a state a real
-- poster reaches every day (helper marked done, poster hasn't confirmed yet)
-- and is the same fixture shape supabase/seed.sql already ships deliberately
-- as "Job 5: escrow past the auto-release window". Both rows keep `is_seed`,
-- so the live money crons still skip them and only a deliberate
-- `?include_seed=1` audit run touches them.
--
-- WHY THE TRIGGERS COME OFF FOR THIS STATEMENT. `enforce_job_status_transition`
-- has no `pending_approval -> in_progress` edge and only bypasses for an
-- authenticated admin; inside a migration `auth.uid()` is NULL, so the UPDATE
-- would raise. Rather than widen the transition matrix — which would grant that
-- edge to clients forever for the sake of a two-row one-time fix — the user
-- triggers on `jobs` are disabled for the length of this one statement. That
-- also keeps the other status-change triggers quiet, which is what we want:
-- nobody should get a "your job status changed" push about a data repair, and
-- no admin-override audit row should be logged for a migration.
--
-- DISABLE TRIGGER USER leaves foreign-key/system triggers armed (only
-- DISABLE TRIGGER ALL would touch those) and needs table ownership, not
-- superuser. The whole file runs in one transaction, so a failure anywhere
-- rolls the disable back with it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_updated integer := 0;
BEGIN
  -- Guard: the enum label and the columns this depends on must exist.
  IF to_regclass('public.jobs') IS NULL THEN
    RAISE NOTICE 'retire_business_approval_residue: public.jobs absent, skipping data fix';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'job_status'
       AND e.enumlabel = 'pending_approval'
  ) THEN
    RAISE NOTICE 'retire_business_approval_residue: job_status has no pending_approval label, nothing to migrate';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'jobs'
       AND column_name  = 'helper_completed_at'
  ) THEN
    RAISE NOTICE 'retire_business_approval_residue: jobs.helper_completed_at absent, skipping data fix';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs WHERE status = 'pending_approval'::public.job_status
  ) THEN
    RAISE NOTICE 'retire_business_approval_residue: no pending_approval rows, nothing to migrate';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.jobs DISABLE TRIGGER USER';

  -- Assigned + funded + helper marked done -> in_progress, the state those
  -- timestamps actually describe.
  UPDATE public.jobs
     SET status     = 'in_progress'::public.job_status,
         updated_at = now()
   WHERE status = 'pending_approval'::public.job_status
     AND helper_id IS NOT NULL
     AND helper_completed_at IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Defensive tail: any pending_approval row that is NOT assigned-and-completed
  -- is a plain unstarted listing, so 'open' is the honest state for it. Zero
  -- rows match on prod today; this exists so a replay against a different
  -- snapshot cannot leave the status behind.
  UPDATE public.jobs
     SET status     = 'open'::public.job_status,
         updated_at = now()
   WHERE status = 'pending_approval'::public.job_status;

  EXECUTE 'ALTER TABLE public.jobs ENABLE TRIGGER USER';

  RAISE NOTICE 'retire_business_approval_residue: moved % pending_approval job(s) to in_progress', v_updated;
END
$$;
