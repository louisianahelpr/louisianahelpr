-- A helper could never open a dispute. Every completed job shows them
-- "Something Wrong? Open a Dispute", the dialog is fully built (reason,
-- details, up to 5 evidence photos), and Submit failed 100% of the time with
--
--   403 / 42501  "Helpers may not modify jobs.disputed_by"
--
-- `rpc_open_dispute` writes four columns in one UPDATE:
--     status, disputed_by, disputed_at, dispute_status
-- and `enforce_helper_jobs_column_whitelist` allowed every one of those
-- EXCEPT `disputed_by`. The allow-list already carries five sibling
-- `dispute_*` columns (dispute_reason, dispute_evidence_urls, disputed_at,
-- dispute_status, dispute_helper_response), so letting helpers dispute was
-- plainly the intent — `disputed_by` was simply missed when the guard landed.
--
-- Two things made this survive review. `rpc_open_dispute` is SECURITY DEFINER,
-- which reads as "bypasses row guards" — but this trigger keys off
-- `auth.uid()`, not the current role, so the definer's rights buy nothing and
-- the helper's uid is still what gets checked. And the poster is exempt at the
-- top of the function (`auth.uid() = OLD.customer_id`), so disputes worked
-- perfectly in every poster-side test. Prod bears that out: 2 jobs ever
-- disputed, both opened by the poster, zero by a helper.
--
-- Adding `disputed_by` does not widen a helper's reach beyond the feature they
-- are already meant to have: `rpc_open_dispute` sets it with
-- `COALESCE(disputed_by, _uid)`, so it can only ever be stamped once, only
-- with the caller's own uid, and only on a job where they are the assigned
-- helper (the trigger's own `auth.uid() = OLD.helper_id` precondition).
--
-- Verified live 2026-09-05 by driving the real UI as the seeded Audit Helper:
-- the dialog submitted 403 before, and the same click must now succeed.

-- Attributes deliberately match the live function exactly (checked against
-- pg_proc before writing this): plpgsql, SECURITY INVOKER, search_path=public.
-- A CREATE OR REPLACE that adds SECURITY DEFINER here would silently escalate
-- the trigger — the body's whole guard is `auth.uid()`, so definer's rights
-- buy nothing and cost isolation.
CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
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
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
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
      -- The verified-arrival stamp is deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side and sets this transaction-local flag. A direct
      -- PATCH from the client still hits the RAISE below.
      IF changed_col = 'helper_arrival_verified_at'
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
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
$function$;
