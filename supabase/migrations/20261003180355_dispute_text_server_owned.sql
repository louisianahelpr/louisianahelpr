-- THE DISPUTE RECORD'S WORDS ARE NOT THE OTHER PARTY'S TO EDIT (Q966).
--
-- 20260915033734 made the dispute MARKERS server-owned at the table door
-- (status into/out of 'disputed', disputed_at, disputed_by, dispute_status,
-- dispute_deadline, dispute_resolved_at) and left the two text columns
-- client-writable, on the reading that DisputeTimelineDialog and
-- DisputedSection write them. Re-read 2026-10-03 (write-contract AST over src/,
-- every supabase/functions writer, live pg_proc):
--
--   * jobs.dispute_reason has NO client writer. Its writers are open_dispute_as
--     (SECURITY DEFINER, behind rpc_open_dispute), settle_one_off_jobs_for_
--     banned_account (SECURITY DEFINER) and auto-resolve-disputes (service
--     role). Yet policy "Customers can update their own jobs" has no column
--     limit and no trigger names the column for the poster, and
--     enforce_helper_jobs_column_whitelist ALLOWS it to the Helpr. So with a
--     plain PATCH /rest/v1/jobs either party could rewrite the complaint an
--     admin decides the money split from (AdminDisputes and both job cards
--     render jobs.dispute_reason), after it was filed.
--   * jobs.dispute_helper_response has ONE client writer: the assigned Helpr's
--     dispute card (DisputedSection.tsx), once, while the job is disputed and
--     only when they did not file it. The poster could overwrite or blank the
--     Helpr's side with a PATCH, and the Helpr could rewrite it after the admin
--     read it.
--
-- THE FIX, in the same trigger and on the same terms (current_user is the
-- caller's role: authenticated/anon is a direct client write; SECURITY DEFINER
-- RPCs see postgres, edge functions service_role; admins exempt):
--   * dispute_reason: a client may never change it; on INSERT it is cleared.
--   * dispute_helper_response: a client may change it only as the assigned
--     Helpr, on a job that is 'disputed', on a dispute they did not file, and
--     only while no response is on file (the card offers the box only then);
--     on INSERT it is cleared. The condition is tested IS NOT TRUE so a NULL
--     helper_id (crew job, deleted Helpr) refuses instead of skipping.
--   * Both checks run BEFORE the dispute_status branch, which returns early on
--     the Helpr's one allowed status write: after it, a PATCH pairing
--     dispute_status 'helper_responded' with a new dispute_reason would pass.
--   * The trigger's UPDATE OF list gains both columns. A BEFORE UPDATE OF
--     trigger fires only when the statement names a listed column, so a
--     function check on a column the list omits never runs.
--
-- Everything else in the body is 20260915033734's, unchanged.
-- enforce_helper_jobs_column_whitelist still lists dispute_reason; that
-- allow-list only stops OTHER columns, and this trigger now refuses the write
-- for every non-admin session, so it is left as is.
--
-- Live 2026-10-03: 261 jobs, 0 with dispute_reason or dispute_helper_response
-- set, so no stored row is affected.
--
-- REPLAY-SAFE: CREATE OR REPLACE; the trigger is skipped when public.jobs does
-- not exist; DROP TRIGGER IF EXISTS first; a jobs table missing any of the
-- eight columns fails the deploy instead of silently shipping no lock.
-- Proof: src/test/pglite/disputeTextServerOwned.pglite.mjs (live-shaped
-- PGlite, applied 3x; NEW_MIGRATION=skip is red). Class guards:
-- src/test/jobsStateColumnGuard.test.ts (every disputed?_ column, a guard
-- counted only when its trigger fires on an UPDATE of that column) and
-- src/test/disputeMarkersServerOwned.test.ts (the live trigger's columns; no
-- client write of either text outside the Helpr's dispute card).
-- Not changed here (Q-filed follow-up): open_dispute_as does not clear an
-- answer left from a withdrawn dispute when the job is disputed again.

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
    NEW.disputed_at             := NULL;
    NEW.disputed_by             := NULL;
    NEW.dispute_status          := NULL;
    NEW.dispute_deadline        := NULL;
    NEW.dispute_resolved_at     := NULL;
    NEW.dispute_reason          := NULL;
    NEW.dispute_helper_response := NULL;
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

  -- The complaint is filed by rpc_open_dispute and rewritten only by the
  -- server (auto-resolve, the ban settlement). No party edits it afterwards.
  IF NEW.dispute_reason IS DISTINCT FROM OLD.dispute_reason THEN
    RAISE EXCEPTION 'jobs.dispute_reason is set by the dispute RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;

  -- The Helpr's side: written once, by the assigned Helpr, on a live dispute
  -- they did not file (DisputedSection.tsx offers the box only then). Never
  -- by the poster, and never rewritten after it is on file.
  -- IS NOT TRUE, not NOT (...): on a job with no helper_id (a crew job, or a
  -- Helpr whose account is gone: jobs_helper_id_fkey is ON DELETE SET NULL)
  -- `v_uid = OLD.helper_id` is NULL, NOT NULL is NULL, and IF NULL would skip
  -- the RAISE. A condition that cannot be decided refuses.
  IF NEW.dispute_helper_response IS DISTINCT FROM OLD.dispute_helper_response THEN
    IF (OLD.status::text = 'disputed'
        AND v_uid IS NOT NULL
        AND v_uid = OLD.helper_id
        AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id
        AND NULLIF(btrim(COALESCE(OLD.dispute_helper_response, '')), '') IS NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'jobs.dispute_helper_response is written once, by the assigned Helpr answering a dispute they did not file'
        USING ERRCODE = '42501';
    END IF;
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
                         'dispute_deadline', 'dispute_resolved_at',
                         'dispute_reason', 'dispute_helper_response');
  -- All eight predate this migration. If one is missing the lock would
  -- silently not exist, so fail the deploy instead of skipping.
  IF v_cols <> 8 THEN
    RAISE EXCEPTION 'dispute_text_server_owned: expected 8 jobs columns, found %', v_cols;
  END IF;
  DROP TRIGGER IF EXISTS trg_dispute_markers_server_owned ON public.jobs;
  CREATE TRIGGER trg_dispute_markers_server_owned
    BEFORE INSERT OR UPDATE OF status, disputed_at, disputed_by, dispute_status, dispute_deadline, dispute_resolved_at, dispute_reason, dispute_helper_response
    ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_dispute_markers_server_owned();
END
$guard$;
