-- Q356: jobs.recurring_helper_id is a hire, so a client cannot write it.
--
-- WHAT WAS BROKEN. charge-recurring-visits (daily cron, service role) reads
-- every series parent with recurrence_days and recurring_helper_id set, charges
-- the poster's saved card off-session for each due visit, and inserts a child
-- job with helper_id = parent.recurring_helper_id, status 'accepted',
-- helper_confirmed_at now(), plus an accepted applications row. It trusts the
-- column completely. And the column was client-writable: authenticated holds
-- INSERT/UPDATE on it, the "Customers can update their own jobs" and "Targeted
-- helper can respond to direct offer" UPDATE policies have no WITH CHECK, and
-- no trigger locked it (Q346's trg_hire_columns_rpc_only covered helper_id,
-- status and offered_to_helper_id, not this).
--
-- MEASURED LIVE 2026-09-24T04:48Z (scripts/probes/recurring-helper-patch.prod.mjs,
-- poster-e2e / helper-e2e, is_seed jobs, all deleted):
--   A  poster PATCH {recurrence_days, recurring_helper_id: <never applied>} -> 200, 1 row
--   B  direct-offer target PATCH {recurring_helper_id: self}               -> 200, 1 row
-- Either way the cron would book that person onto every visit and charge the
-- poster for each one. Exposure today: 0 rows with recurring_helper_id set.
--
-- THE FIX.
--  1. enforce_hire_columns_rpc_only (Q346, SECURITY INVOKER, gate on the
--     request role) also refuses, from a client, recurring_helper_id newly set
--     to a non-NULL value that is not NEW.helper_id. The one legitimate client-
--     context writer is stamp_recurring_series_helper (SECURITY INVOKER; it
--     fires on the hired helper's own helper_confirmed_at PATCH and copies
--     NEW.helper_id). It sorts AFTER trg_hire_columns_rpc_only, so today it
--     writes after this check runs; allowing "= NEW.helper_id" keeps it working
--     even if the order ever changes, and helper_id itself can only have been
--     set by a hire RPC (Q346). Clearing the column stays allowed.
--  2. enforce_jobs_insert_column_lock nulls recurring_helper_id on a client
--     INSERT, next to helper_id (a new job has no standing helper yet). Body
--     otherwise verbatim from live pg_get_functiondef 2026-09-24.
-- The cron's own check (series skipped unless recurring_helper_id = helper_id
-- and the pair is not blocked) ships in the same commit: defence in depth.
--
-- Replay-safe: CREATE OR REPLACE only; triggers already exist (Q346 and
-- 20260915101102) and are not re-created. Grants restated.

CREATE OR REPLACE FUNCTION public.enforce_hire_columns_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.helper_id is set only by the hire flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Use accept_application, accept_group_application or respond_to_direct_offer.';
    END IF;
    IF NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.status becomes accepted only through the hire flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Use accept_application, accept_group_application or respond_to_direct_offer.';
    END IF;
    IF NEW.offered_to_helper_id IS NOT NULL
       AND NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.offered_to_helper_id is set only when the job is posted (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'A direct offer is made at post time; post a new job to offer it to someone else.';
    END IF;
    -- Q356: the standing helper of a recurring series is whoever was hired on
    -- the parent (stamp_recurring_series_helper copies NEW.helper_id); nobody
    -- else, and never by a client naming someone.
    IF NEW.recurring_helper_id IS NOT NULL
       AND NEW.recurring_helper_id IS DISTINCT FROM OLD.recurring_helper_id
       AND NEW.recurring_helper_id IS DISTINCT FROM NEW.helper_id THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.recurring_helper_id is the helper hired on the job, never set directly (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'The standing helper is stamped when the hired helper confirms the first visit.';
    END IF;
    RETURN NEW;
  END IF;

  -- group_job_helpers
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'hire_requires_rpc: a crew member is added only by accept_group_application (job_id=%)', NEW.job_id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'hire_requires_rpc: group_job_helpers.helper_id cannot be re-pointed (job_id=%)', OLD.job_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_hire_columns_rpc_only() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A server context and anyone not inserting their own job pass through
  -- untouched. Same gate as the UPDATE money lock.
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;
  -- Q356: a series' standing helper is stamped from the hire, never posted.
  NEW.recurring_helper_id      := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.helper_arrival_near_miss_at := NULL;
  NEW.helper_arrival_near_miss_ft := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon;
