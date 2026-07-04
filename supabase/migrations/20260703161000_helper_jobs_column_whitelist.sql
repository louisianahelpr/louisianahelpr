-- F-MONEY-29: the helper UPDATE policy on jobs (20260312010219) is
-- all-columns (`USING/WITH CHECK (auth.uid() = helper_id)`), so an assigned
-- helper could forge money-bearing columns directly via PostgREST —
-- poster_completed_at (accelerates auto-release), budget, payment_status,
-- platform_fee_amount, tip fields, etc. RLS policies can't do column-level
-- grants per-role-condition, so enforce a column whitelist in a BEFORE
-- UPDATE trigger that only constrains helper-initiated updates.
--
-- Whitelist derived from every client-side helper write path:
--   JobTracking.tsx        -> status, helper_on_the_way_at, helper_arrived_at,
--                             helper_completed_at
--   JobConfirmation.tsx    -> helper_confirmed_at
--   PhotoProof.tsx         -> proof_before_urls, proof_after_urls
--   DisputeDialog.tsx /    -> status, dispute_reason, dispute_evidence_urls,
--   DisputedSection.tsx       disputed_at, dispute_status, dispute_helper_response
--   CancellationDialog.tsx -> status, cancelled_by, cancelled_at,
--                             cancellation_reason, late_cancellation,
--                             cancellation_fee, cancellation_fee_status
--   useOfferHandlers.ts    -> status, helper_id (clear only), response_deadline
--   (decline fallback)
--
-- Service-role writes (edge functions, crons) have auth.uid() = NULL and are
-- untouched; poster and admin sessions don't match the helper condition.

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (service role: uid NULL; poster; admin) passes through — their
  -- access is governed by RLS as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_helper_jobs_column_whitelist ON public.jobs;
CREATE TRIGGER trg_helper_jobs_column_whitelist
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_helper_jobs_column_whitelist();
