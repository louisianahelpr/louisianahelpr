-- A HELPER WHO OPENS A DISPUTE CANNOT CLOSE IT — and closing it regressed the job.
--
-- Two defects in one path, both reproduced against production on 2026-09-07
-- (job 67e8ccfe-fa63-45ca-87c3-b231cb46bc73, helper-opened, status `disputed`,
-- payment_status `payout_pending`, payout_scheduled_at set):
--
--  1. THE WITHDRAWAL IS A DEAD CALL FOR THE OPENER-HELPER. `rpc_withdraw_dispute`
--     (20260825190000) is opener-only by design, and its closing statement is
--
--         UPDATE public.jobs SET status=…, dispute_status='resolved',
--                                dispute_resolved_at = now()
--
--     `enforce_helper_jobs_column_whitelist` does not list `dispute_resolved_at`,
--     and the RPC being SECURITY DEFINER buys nothing because that guard keys on
--     `auth.uid()`, not the current role. Impersonated as the opener-helper
--     against prod, inside a rolled-back subtransaction:
--
--         42501 | Helpers may not modify jobs.dispute_resolved_at
--
--     This is the FOURTH instance of the shape jobsGuardRpcParity.test.ts was
--     written for — a complete feature refused by one missing entry in a list in
--     another file, with no error anywhere but the caller's toast. The poster
--     half of the same pair was the 2026-09-06 `decided_at` bug (20260907034644);
--     this is the same statement's other table.
--
--  2. WITHDRAWING REGRESSED AN APPROVED JOB AND STRANDED THE PAYOUT. The RPC set
--     `status = 'in_progress'` unconditionally. That is right for a dispute filed
--     mid-job and wrong for one filed AFTER the poster approved: the job was
--     `completed` / `payout_pending` with `payout_scheduled_at` set, and
--     process-scheduled-payouts only picks up `status = 'completed'`. A withdrawal
--     would have quietly moved the job out of the batch's reach and left escrow
--     held with nothing scheduled to release it.
--
-- ── FIX 1: a transaction-local flag, not a wider whitelist ───────────────────
--
-- `dispute_resolved_at` stays OFF the helper allow-list. Adding it would let any
-- helper PATCH `jobs` directly and stamp their own job resolved, outside the
-- RPC's opener check. Instead the exemption is keyed on `app.dispute_withdraw_rpc`,
-- set with `is_local => true` inside `rpc_withdraw_dispute` AFTER it has proven
-- the caller is the opener of a live dispute — the same shape `app.arrival_rpc`
-- already uses two lines above for `helper_arrival_verified_at`, and the least
-- privilege available here: one column, one function, one transaction.
--
-- ── FIX 2: restore the PRE-DISPUTE status, derived ───────────────────────────
--
-- Nothing records it. `disputes` has no previous-status column (checked live:
-- id, job_id, opener_id, reason, evidence_urls, status, created_at, decided_at,
-- decided_by, decision_text, payout_split, execution_*), and `rpc_open_dispute`
-- writes none — so even if one were added now, every dispute already open would
-- still have to be derived. It is derived, and the derivation is two-valued:
--
--     poster_completed_at IS NOT NULL          →  'completed'
--     OR payout_scheduled_at IS NOT NULL
--     OR payment_status IN (payout_pending, released)
--     otherwise                                →  'in_progress'
--
-- Checked against every non-terminal job in prod on 2026-09-07: all 15 rows at
-- `completed` carry poster_completed_at AND payout_scheduled_at; no row at
-- `in_progress` or `revision_requested` carries either. The three-way OR is
-- belt-and-braces in the direction that matters — a job whose money has already
-- been scheduled must never come back as anything but `completed`, because that
-- is the only status the payout batch can see.
--
-- WHY `revision_requested` AND `accepted` COLLAPSE TO `in_progress` rather than
-- being restored exactly. Two independent server rules forbid it, and both were
-- read live rather than assumed:
--   · `enforce_job_status_transition`'s matrix allows `disputed` → completed /
--     cancelled / in_progress and nothing else. Restoring `revision_requested`
--     raises check_violation for every non-admin.
--   · `set_revision_deadline` fires BEFORE this guard (alphabetically
--     `set_revision_deadline_trigger` < `trg_helper_jobs_column_whitelist`) and,
--     on any transition INTO `revision_requested`, RESETS revision_deadline and
--     NULLS revision_completed_at — so an "exact" restore would silently restart
--     the revision clock and erase a fix the helper had already delivered.
-- `revision_requested` → `in_progress` is a transition the matrix already sanctions
-- (it is what "helper accepts the revision" does), and it loses no money state.

-- ─────────────────────────────────────────────────────────────────────────────
-- Both bodies below are CREATE OR REPLACE from the LIVE production definitions
-- (pg_get_functiondef, 2026-09-07), not from the migration files, so nothing
-- applied out of band is reverted. CREATE OR REPLACE preserves ACLs; the grants
-- are restated at the foot anyway, naming the roles (a `FROM PUBLIC` alone does
-- not revoke `anon` — see CLAUDE.md). Replay-safe: both statements are
-- CREATE OR REPLACE and carry no DDL that a re-apply could collide with.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
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

CREATE OR REPLACE FUNCTION public.rpc_withdraw_dispute(_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _opener uuid;
  _dispute_id uuid;
  _restored text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id, opener_id INTO _dispute_id, _opener
    FROM public.disputes
   WHERE job_id = _job_id AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1
     FOR UPDATE;

  IF _dispute_id IS NULL THEN
    RAISE EXCEPTION 'no open dispute for this job';
  END IF;

  -- Only whoever raised it may withdraw it. The other party's route out is
  -- the admin decision path, not a unilateral close.
  IF _opener IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'only the party who opened this dispute may withdraw it';
  END IF;

  -- The status this job held before the dispute froze it. See the header for
  -- why it is derived rather than read, and why only two values are reachable.
  -- Read under the same FOR UPDATE lock the dispute row is holding, so a
  -- concurrent approval cannot land between this read and the write below.
  SELECT CASE
           WHEN j.poster_completed_at IS NOT NULL
             OR j.payout_scheduled_at IS NOT NULL
             OR COALESCE(j.payment_status, '') IN ('payout_pending', 'released')
           THEN 'completed'
           ELSE 'in_progress'
         END
    INTO _restored
    FROM public.jobs j
   WHERE j.id = _job_id
     FOR UPDATE;

  UPDATE public.disputes
     SET status = 'withdrawn',
         decided_at = now()
   WHERE id = _dispute_id;

  -- Transaction-local, and set only here — after the opener check above.
  -- enforce_helper_jobs_column_whitelist reads it to let THIS statement stamp
  -- jobs.dispute_resolved_at when the opener is the assigned helper.
  PERFORM set_config('app.dispute_withdraw_rpc', '1', true);

  UPDATE public.jobs
     SET status = _restored::job_status,
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;

  -- Closed immediately rather than left to the end of the transaction: the
  -- flag must not still be open for whatever the caller does next in the same
  -- statement batch.
  PERFORM set_config('app.dispute_withdraw_rpc', '0', true);
END;
$function$;

-- Grants, restated with the roles NAMED. `REVOKE ... FROM PUBLIC` alone leaves
-- the explicit `anon` grant that Supabase's ALTER DEFAULT PRIVILEGES hands to
-- every new public function; this matches the live proacl
-- ({postgres,authenticated,service_role}) and removes anon explicitly.
REVOKE ALL ON FUNCTION public.rpc_withdraw_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_dispute(uuid) TO authenticated, service_role;
