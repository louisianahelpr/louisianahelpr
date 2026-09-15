-- DONE IS FINAL, THE TABLE DOOR: A CLIENT CANNOT WRITE THE DISPUTE MARKERS.
--
-- 20260915025607 made open_dispute_as refuse a dispute on a completed job
-- (owner, 2026-09-14: "if the job is done, it's done. Period."). That closed
-- the RPC door only. The money review of that migration found the table door
-- still open, read from the live definitions on 2026-09-14:
--
--   * policy "Customers can update their own jobs" is USING (auth.uid() =
--     customer_id) with no WITH CHECK, and "Helpers can update their assigned
--     jobs" is the same for helper_id;
--   * `authenticated` holds column UPDATE on status, disputed_at,
--     disputed_by, dispute_status, dispute_deadline, dispute_resolved_at;
--   * enforce_poster_jobs_money_lock and prevent_job_field_escalation list
--     none of them, and enforce_helper_jobs_column_whitelist ALLOWS the helper
--     status, disputed_at, disputed_by and dispute_status;
--   * enforce_job_status_transition allows completed -> disputed.
--
-- So with a session and a plain PATCH /rest/v1/jobs:
--   1. a poster stamps disputed_at on a completed payout_pending job.
--      process-scheduled-payouts pays only `disputed_at IS NULL`, so the
--      Helpr's payout stalls forever, with no disputes row and nothing in the
--      admin queue (AdminDisputes lists status = 'disputed');
--   2. adding status: 'disputed' also escapes auto-resolve-disputes;
--   3. on a live dispute, a helper re-points disputed_by at the poster (or
--      flips dispute_status 'escalated' back to 'helper_responded'), and
--      auto-resolve-disputes, which escalates a helper-filed dispute and skips
--      an escalated one, pays the helper the full escrow at the deadline;
--   4. either party moves status OUT of 'disputed' (disputed -> in_progress,
--      or -> completed for the helper) and the job leaves the admin queue and
--      the auto-resolve sweep with its money still frozen;
--   5. a poster pushes dispute_deadline out and the sweep never fires;
--   6. (the INSERT door, found in review) a poster creates a job with
--      disputed_at already set: enforce_jobs_insert_column_lock clears the
--      lifecycle stamps but not the dispute markers, so the job funds, is
--      hired and completed, and process-scheduled-payouts never pays it.
-- DisputeDialog.tsx's PGRST202 fallback was write 1+2 verbatim (removed in the
-- same commit; rpc_open_dispute is deployed, so it was unreachable).
--
-- THE FIX: one BEFORE INSERT OR UPDATE trigger. A direct client write
-- (current_user is `authenticated` or `anon`, and the caller is not an admin):
--   * on UPDATE may not move jobs.status INTO or OUT OF 'disputed', may not
--     change disputed_at, disputed_by, dispute_deadline, dispute_resolved_at,
--     and may not change dispute_status, with ONE exception below;
--   * on INSERT has those five markers cleared to NULL (cleared, not refused,
--     matching enforce_jobs_insert_column_lock; status is already forced to
--     'open' there).
--
-- WHY current_user AND NOT A FLAG. The function is deliberately NOT SECURITY
-- DEFINER, so current_user is the role the UPDATE runs as:
--   * PostgREST with a user JWT            -> authenticated   (refused)
--   * inside any SECURITY DEFINER RPC       -> postgres        (allowed)
--   * edge functions with the service key   -> service_role    (allowed)
--   * pg_cron                               -> postgres        (allowed)
-- Every legitimate writer of these columns is one of the allowed three, read
-- on 2026-09-14 (live pg_proc + supabase/functions + src/):
--   open_dispute_as / rpc_open_dispute, helper_abort_job, rpc_escalate_dispute,
--   rpc_withdraw_dispute, rpc_decide_dispute, purge_user_data (all SECURITY
--   DEFINER, owner postgres);
--   create-payment (admin release/refund), auto-resolve-disputes,
--   stripe-webhook chargeDisputeCreated / chargeDisputeClosed /
--   transferReversed (all service_role);
--   AdminDisputes.tsx's legacy fallback (an admin session: exempt below).
-- A flag would have meant re-creating six long RPC bodies to set it, and
-- every future RPC that forgets it would break at runtime. No SECURITY
-- DEFINER function executable by authenticated writes a caller-chosen column
-- (checked: none runs a dynamic EXECUTE; the format() calls build notification
-- text), so trusting the definer boundary adds no path a flag would close.
--
-- THE ONE CLIENT WRITE KEPT. DisputedSection.tsx: the assigned Helpr answers
-- a dispute with { dispute_helper_response, dispute_status: 'helper_responded' },
-- and only while the dispute is 'open' (the client treats NULL as 'open').
-- Allowed exactly: OLD.status = 'disputed' and unchanged, OLD.dispute_status
-- NULL or 'open', NEW 'helper_responded', caller is OLD.helper_id and did not
-- file it (the card offers the response only to the other party). It moves
-- no money: auto-resolve-disputes, rpc_escalate_dispute and the chargeback
-- hold treat 'open' and 'helper_responded' identically. Escalated, resolved
-- and every other value cannot be written back.
--
-- NOT CHANGED. The transition matrix keeps ('completed','disputed'): the
-- service-role and definer paths still pass through it, and the human RPC
-- door is already refused by 20260915025607. dispute_reason,
-- dispute_evidence_urls and dispute_helper_response stay client-writable
-- (DisputeTimelineDialog, DisputedSection write them; they move no money).
--
-- REPLAY-SAFE: the function is CREATE OR REPLACE; the trigger is skipped when
-- public.jobs does not exist, DROP TRIGGER IF EXISTS runs first, and a jobs
-- table missing any of the six (older) columns fails loudly rather than
-- silently shipping no lock.
-- Proof: scripts/probes/dispute-table-door.probe.mjs (PGlite, applied 3x,
-- red on the live shape, broken copies caught).

CREATE OR REPLACE FUNCTION public.enforce_dispute_markers_server_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  -- NOT SECURITY DEFINER, on purpose: current_user is the caller's role. An
  -- UPDATE run inside a SECURITY DEFINER RPC sees its owner (postgres), the
  -- service key sees service_role, cron sees postgres. Only a direct client
  -- write sees authenticated / anon.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();

  -- Admins keep their direct reach, as in every sibling lock
  -- (AdminDisputes.tsx's legacy fallback closes a dispute this way). Nested,
  -- not AND-ed: EXECUTE on has_role is checked when the expression is
  -- prepared, and anon does not hold it.
  IF current_user::text = 'authenticated' AND v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin'::app_role) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A new job has no dispute. Cleared, not refused, the same way
  -- enforce_jobs_insert_column_lock clears the lifecycle stamps: a poster who
  -- creates a job with disputed_at already set would otherwise have a job that
  -- process-scheduled-payouts (disputed_at IS NULL) never pays, that
  -- has_active_dispute reads as clean, and that no admin queue lists. status is
  -- not handled here: the insert column lock forces it to 'open'.
  IF TG_OP = 'INSERT' THEN
    NEW.disputed_at         := NULL;
    NEW.disputed_by         := NULL;
    NEW.dispute_status      := NULL;
    NEW.dispute_deadline    := NULL;
    NEW.dispute_resolved_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND 'disputed' IN (NEW.status::text, OLD.status::text) THEN
    RAISE EXCEPTION 'jobs.status % -> % is set by the dispute RPCs, not by the client (job_id=%)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = '42501',
            HINT = 'Open a dispute with rpc_open_dispute; it closes through rpc_withdraw_dispute or an admin decision.';
  END IF;

  IF NEW.disputed_at IS DISTINCT FROM OLD.disputed_at THEN
    RAISE EXCEPTION 'jobs.disputed_at is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.disputed_by IS DISTINCT FROM OLD.disputed_by THEN
    RAISE EXCEPTION 'jobs.disputed_by is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.dispute_deadline IS DISTINCT FROM OLD.dispute_deadline THEN
    RAISE EXCEPTION 'jobs.dispute_deadline is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.dispute_resolved_at IS DISTINCT FROM OLD.dispute_resolved_at THEN
    RAISE EXCEPTION 'jobs.dispute_resolved_at is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.dispute_status IS DISTINCT FROM OLD.dispute_status THEN
    -- The one client write: the assigned Helpr answering an open dispute
    -- somebody else filed (the poster, or the platform with disputed_by NULL).
    IF NEW.dispute_status = 'helper_responded'
       AND COALESCE(OLD.dispute_status, 'open') = 'open'
       AND OLD.status::text = 'disputed'
       AND v_uid IS NOT NULL
       AND v_uid = OLD.helper_id
       AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'jobs.dispute_status is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- A trigger function is run by the trigger machinery, never called by a role.
REVOKE ALL ON FUNCTION public.enforce_dispute_markers_server_owned() FROM PUBLIC, anon, authenticated;

DO $guard$
DECLARE
  v_cols int;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'jobs'
     AND column_name IN ('status', 'disputed_at', 'disputed_by', 'dispute_status',
                         'dispute_deadline', 'dispute_resolved_at');
  -- All six predate this migration. If one is missing the lock would silently
  -- not exist, so fail the deploy instead of skipping.
  IF v_cols <> 6 THEN
    RAISE EXCEPTION 'dispute_markers_server_owned: expected 6 jobs columns, found %', v_cols;
  END IF;
  DROP TRIGGER IF EXISTS trg_dispute_markers_server_owned ON public.jobs;
  CREATE TRIGGER trg_dispute_markers_server_owned
    BEFORE INSERT OR UPDATE OF status, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_resolved_at
    ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_dispute_markers_server_owned();
END
$guard$;
