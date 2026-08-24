-- The 2026-08-24 two-role E2E caught this within minutes of the feature
-- shipping: the helper's day-before "I'm Still On" tap writes
-- `helper_dayof_confirmed_at` (added in 20260824213000), but the helper
-- column whitelist (20260703161000) predates the column, so the write died
-- with 42501 "Helpers may not modify jobs.helper_dayof_confirmed_at" and the
-- chip stayed "You: Pending" while the confirm dialog closed as if it had
-- worked. Redefine the trigger function with the one new column added; the
-- rest is byte-identical to the shipped version, comments included, so a
-- diff of the two migrations shows exactly one line of change.
--
-- Replay-safe: CREATE OR REPLACE, no trigger re-creation needed (the trigger
-- points at the function by name).

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
    'helper_dayof_confirmed_at',
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
