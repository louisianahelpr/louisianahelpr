-- Job status state machine: enforce valid transitions + clean up an
-- orphaned payment_status value.
--
-- Background:
--   `public.jobs.status` is an ENUM (`public.job_status`) with 7 values:
--     open, accepted, in_progress, completed, cancelled,
--     revision_requested, disputed
--   The enum constrains *values*; nothing today constrains *transitions*.
--   That gap is what TODO.md flags as the #1 product hole — without it we
--   silently accept e.g. `cancelled → in_progress` if a future bug ever
--   writes that combo, leaving money flow in an undefined state.
--
--   Separately, `payment_status` is TEXT with a CHECK list of 6 allowed
--   values, but `void-cancelled-payments/index.ts` writes a 7th —
--   `'abandoned'` — for unpaid sessions older than 1h. That insert fails
--   today on the constraint. This migration adds 'abandoned' to the list
--   so the cleanup job can finish.
--
-- Two trigger calls that mutate `jobs.status` are NOT user/admin actions
-- and run as the service role with NULL `auth.uid()`:
--   • auto-expire-jobs       in_progress → open
--   • job-lifecycle-automations  open → cancelled (expired listings)
-- Both transitions are explicitly enumerated below so the trigger lets
-- them through without a special-case escape hatch.
--
-- Apply order doesn't matter — each statement is independent.
-- Existing rows are NOT validated (the trigger only fires on UPDATE OF
-- status going forward). Backfilling weird historical state is out of
-- scope for this PR.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Allowed transition matrix
--
-- ENTRY: any insert is allowed (BEFORE INSERT not gated). Default 'open'.
--
-- open                → accepted, cancelled
-- accepted            → open, in_progress, completed, cancelled, disputed
-- in_progress         → completed, revision_requested, cancelled, disputed,
--                       open  (auto-expire-jobs reset)
-- revision_requested  → in_progress, completed, cancelled, disputed
-- disputed            → completed (admin: helper wins),
--                       cancelled (admin: poster wins, refund)
-- completed           → disputed  (post-completion dispute window)
-- cancelled           → (terminal — no transitions out)
--
-- Admins (has_role(auth.uid(), 'admin')) bypass all checks. Their actions
-- should be logged separately in admin_audit_log; this trigger does not
-- enforce that.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op: trigger fires on UPDATE OF status, but Postgres still invokes
  -- it for UPDATE statements that touch other columns alongside an
  -- unchanged status. Bail early so those updates aren't blocked.
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Admin override. Anyone with the 'admin' app_role can transition a job
  -- to any status — needed for support / dispute resolution / data fixes.
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('open',                'accepted'),
      ('open',                'cancelled'),
      ('accepted',            'open'),
      ('accepted',            'in_progress'),
      ('accepted',            'completed'),
      ('accepted',            'cancelled'),
      ('accepted',            'disputed'),
      ('in_progress',         'completed'),
      ('in_progress',         'revision_requested'),
      ('in_progress',         'cancelled'),
      ('in_progress',         'disputed'),
      ('in_progress',         'open'),
      ('revision_requested',  'in_progress'),
      ('revision_requested',  'completed'),
      ('revision_requested',  'cancelled'),
      ('revision_requested',  'disputed'),
      ('disputed',            'completed'),
      ('disputed',            'cancelled'),
      ('completed',           'disputed')
    ) AS allowed(from_status, to_status)
    WHERE allowed.from_status = OLD.status::text
      AND allowed.to_status   = NEW.status::text
  ) THEN
    RAISE EXCEPTION
      'Invalid job status transition: % -> % (job_id=%)',
      OLD.status, NEW.status, OLD.id
      USING
        ERRCODE = 'check_violation',
        HINT = 'See enforce_job_status_transition() in the migrations for the allowed transition matrix. Admins bypass this check.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_job_status_transition() IS
'Enforces the job status state machine. Fires BEFORE UPDATE OF status on public.jobs. Admins bypass; service-role and authed users must follow the matrix in the function body.';

DROP TRIGGER IF EXISTS trg_enforce_job_status_transition ON public.jobs;
CREATE TRIGGER trg_enforce_job_status_transition
  BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_job_status_transition();

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. payment_status: add 'abandoned' to the constraint.
--
-- void-cancelled-payments writes payment_status='abandoned' for unpaid
-- sessions >1h old. The current CHECK rejects it, so that cleanup path
-- silently fails today. We resolve the constraint name dynamically since
-- it could have been generated by Postgres on a previous ALTER without a
-- consistent name across migrations.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.jobs'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%payment_status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_status_check
  CHECK (payment_status IN (
    'unpaid',
    'escrow',
    'payout_pending',
    'released',
    'refunded',
    'cancelled',
    'abandoned'
  ));

COMMENT ON CONSTRAINT jobs_payment_status_check ON public.jobs IS
'Allowed payment lifecycle values. abandoned = unpaid Stripe session expired before checkout.';
