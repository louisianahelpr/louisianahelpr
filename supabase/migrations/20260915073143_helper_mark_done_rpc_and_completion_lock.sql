-- COMPLETION IS THE SERVER'S CALL: THE HELPR'S DONE RUNS THROUGH AN RPC, AND A
-- DIRECT CLIENT WRITE CAN NEITHER STAMP helper_completed_at NOR PUSH A JOB INTO
-- 'completed'.
--
-- Two PROVEN HIGH holes from the 2026-09-15 authz hole hunt (findings H-001 and
-- H-002), the same class as the dispute-marker fix already live (20260915033734,
-- enforce_dispute_markers_server_owned). Both were reproduced in real Postgres
-- on the prod-shaped fixture with the LATEST completion gates applied, so the
-- caller faced MORE locks than prod, not fewer.
--
--   H-001 (HIGH). The assigned Helpr picks the VALUE of helper_completed_at.
--   enforce_helper_completion_gates (20260915044137) checks THAT proof photos
--   exist, THAT arrival is verified and poster-confirmed, and THAT 30 minutes
--   have passed -- but it never constrains the value written, and no trigger
--   clamps a lifecycle stamp to now(). So a Helpr who does the real work and
--   then, instead of the app's Done button, sends
--     PATCH /rest/v1/jobs { "helper_completed_at": "<now minus 25 hours>" }
--   passes every gate and lands a backdated stamp. auto-release-payment
--   (helper_completed_at <= now()-24h) is then due on the spot, and the
--   poster's entire 24-hour review/revision/dispute window is erased. Escrow is
--   captured at checkout, so the money moves early and once it flips to
--   'completed' open_dispute_as refuses (job_already_completed): one-way, no
--   route back.
--
--   H-002 (HIGH). A poster PATCHes status = 'completed' directly. status is on
--   neither of enforce_poster_jobs_money_lock's locked lists, and
--   enforce_job_status_transition allows in_progress -> completed for any
--   non-admin. payment_status stays 'escrow' (the money lock correctly refuses
--   that), so the row now matches NONE of auto-release-payment's four candidate
--   sets and no sweep ever settles it; and the Helpr's only escape,
--   rpc_open_dispute, raises job_already_completed. The Helpr does the work and
--   is never paid, the poster is not refunded, and only an admin noticing
--   recovers it. (enforce_helper_completion_gates already shut this door for the
--   assigned HELPER in 20260915044137 -- the "status door". This closes it for
--   the poster and every other client seat.)
--
-- THE FIX, IN TWO PARTS.
--
-- (1) public.rpc_helper_mark_done(_job_id) -- a SECURITY DEFINER RPC that runs
--     the SAME gates + write the client did directly, now server-side: only the
--     assigned Helpr, only a live job (accepted / in_progress /
--     revision_requested), only when arrival is established (both the GPS-
--     verified stamp AND the poster's confirmation, per 20260915044137) and any
--     required photo proof is present, and only past the 30-minute work floor.
--     It sets helper_completed_at = now() ONCE (idempotent: a second call keeps
--     the first stamp), and returns poster_completed_at so the client still
--     decides whether to finish the release through create-payment. Because it
--     is SECURITY DEFINER owned by postgres, its UPDATE runs as postgres and so
--     passes the role gate in part (2); the completion gates and the live-job
--     trigger still fire on that UPDATE (auth.uid() is the Helpr inside the
--     definer), so the RPC's own checks are belt-and-suspenders with them.
--     Grants: revoked from anon; EXECUTE to authenticated.
--
-- (2) enforce_job_completion_server_owned -- one BEFORE INSERT OR UPDATE
--     trigger on jobs, modelled EXACTLY on the live
--     enforce_dispute_markers_server_owned. A direct client write (current_user
--     is 'authenticated' or 'anon', and the caller is not an admin):
--       * may not move jobs.status INTO 'completed' (H-002);
--       * may not change helper_completed_at AT ALL -- not the first stamp, not
--         a re-point of an existing one, not a clear (a poster clearing it
--         defeated auto-release-payment from the other side: the KNOWN_OPEN
--         poster/offered:helper_completed_at pairs in
--         src/test/jobsStateColumnGuard.test.ts, closed here). The one
--         sanctioned writer is rpc_helper_mark_done above, which runs as
--         postgres and is admitted by the role gate -- no client exception, no
--         value-clamp, so the stamp can only ever be the server clock (H-001);
--       * on INSERT has helper_completed_at cleared to NULL, the same way
--         enforce_jobs_insert_column_lock clears the lifecycle stamps (status is
--         already forced to 'open' there).
--
-- WHY current_user AND NOT A FLAG, AND WHY THE GUARD IS NOT SECURITY DEFINER:
-- verbatim the reasoning of 20260915033734. The guard is deliberately SECURITY
-- INVOKER so current_user is the role the UPDATE runs as:
--   * PostgREST with a user JWT             -> authenticated   (policed)
--   * inside any SECURITY DEFINER RPC        -> postgres        (allowed)
--   * edge functions with the service key    -> service_role    (allowed)
--   * pg_cron                                -> postgres        (allowed)
-- Every legitimate writer of these two columns is one of the allowed three,
-- read on 2026-09-15 (supabase/functions + pg_proc + src/):
--   helper_completed_at  -- the assigned Helpr's Done, now rpc_helper_mark_done
--     (postgres); create-payment's release re-stamps it (service_role); no
--     other writer.
--   status='completed'   -- auto-release-payment, create-payment (poster
--     release), auto-resolve-disputes, instant-payout, process-scheduled-payouts
--     (all service_role edge functions); rpc_decide_dispute, rpc_withdraw_dispute
--     (SECURITY DEFINER, owner postgres). No client PATCH and no INVOKER RPC.
--
-- WHY zz_ : named so it is the LAST BEFORE trigger on jobs (Postgres fires them
-- in name order), the same reason as zz_jobs_stamp_completed_at. The gate
-- triggers (trg_, ahead of this) still judge the RPC's UPDATE exactly as
-- before; this one only forbids the direct client door those gates never closed.
--
-- NOT CHANGED. The transition matrix keeps in_progress -> completed: the
-- service-role and definer paths still pass through it. The dispute state
-- machine, cancellation, arrival and the money lock are untouched. The poster's
-- own release still runs through create-payment (service_role). The completion
-- gates stay where they are.
--
-- REPLAY-SAFE: CREATE OR REPLACE for both functions; the trigger is skipped
-- when public.jobs does not exist, DROP TRIGGER IF EXISTS runs first, and a jobs
-- table missing status / helper_completed_at / helper_id fails loudly rather
-- than silently shipping no lock.
-- Proof: scripts/probes/job-completion-columns-v2.probe.mjs (PGlite, applied 3x,
-- red on the pre-fix shape, broken copies caught).

-- ── 1. The RPC: the assigned Helpr's Done, server-owned ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_helper_mark_done(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- `record`, not `public.jobs`, so the function body does not bind the jobs
  -- rowtype at CREATE time (keeps this file creatable on a from-scratch replay
  -- before jobs exists, and matches the trigger's skip guard below).
  v_job record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: a double tap must not run two stamps against one row. The
  -- client also guards with a synchronous in-flight ref, but the lock is what
  -- makes the idempotence below sound under real concurrency.
  SELECT * INTO v_job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Only the assigned Helpr.
  IF v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;

  -- Already done: keep the FIRST stamp and report state. A second call (double
  -- tap, a retry after a lost response) is a no-op, so the auto-release clock
  -- does not move -- the same rule trg_completion_on_live_job enforces on the
  -- write. poster_completed_at still comes back so the caller can finish a
  -- release that the poster confirmed in the meantime.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'already_done', true,
      'helper_completed_at', v_job.helper_completed_at,
      'poster_completed_at', v_job.poster_completed_at
    );
  END IF;

  -- Only a live job. The client sends .in("status", [...]) for the same reason;
  -- trg_completion_on_live_job is the DB backstop.
  IF v_job.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active (status=' || v_job.status::text || '), so it cannot be marked done.';
  END IF;

  -- Arrival established: BOTH the server-verified GPS stamp AND the poster's
  -- confirmation (VN-33, owner 2026-09-14; the exact rule
  -- enforce_helper_completion_gates enforces on the write).
  IF v_job.helper_arrival_verified_at IS NULL OR v_job.poster_confirmed_arrival_at IS NULL THEN
    RAISE EXCEPTION 'completion_requires_confirmed_arrival' USING ERRCODE = '23514',
      HINT = 'Both are needed: your location confirmed at the job site, and the poster tapping Confirm They Arrived.';
  END IF;

  -- Required photo proof present. The poster's per-job call (require_photo_proof),
  -- COALESCEd to true so a row that predates the column keeps the historic
  -- always-on behaviour, matching the gate trigger.
  IF COALESCE(v_job.require_photo_proof, true)
     AND (COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0
          OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) = 0) THEN
    RAISE EXCEPTION 'completion_requires_proof_photos' USING ERRCODE = '23514',
      HINT = 'Add before and after photos before marking the job done.';
  END IF;

  -- The 30-minute work floor, off the same anchor the gate trigger reads.
  IF COALESCE(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) IS NOT NULL
     AND v_now - COALESCE(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514',
      HINT = 'A job cannot be marked done within 30 minutes of starting.';
  END IF;

  -- THE STAMP. The server clock, never a client-chosen time. Conditional on the
  -- live status and an unset stamp so a cancel / release / stamp that committed
  -- between the SELECT and here wins the race and this no-ops rather than
  -- reviving a job that moved on.
  UPDATE public.jobs
     SET helper_completed_at = v_now
   WHERE id = _job_id
     AND helper_completed_at IS NULL
     AND status IN ('accepted', 'in_progress', 'revision_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active, so it cannot be marked done.';
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'poster_completed_at', v_job.poster_completed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_helper_mark_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_helper_mark_done(uuid) TO authenticated;

-- ── 2. The table door: completion is server-owned ───────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_job_completion_server_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  -- NOT SECURITY DEFINER, on purpose: current_user is the caller's role. An
  -- UPDATE run inside a SECURITY DEFINER RPC (rpc_helper_mark_done, and the
  -- completion/release RPCs) sees its owner (postgres), the service key sees
  -- service_role, cron sees postgres. Only a direct client write sees
  -- authenticated / anon.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();

  -- Admins keep their direct reach, as in every sibling lock. Nested, not
  -- AND-ed: EXECUTE on has_role is checked when the expression is prepared, and
  -- anon does not hold it.
  IF current_user::text = 'authenticated' AND v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin'::app_role) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A new job is never already completed and never carries a helper-completion
  -- stamp. Cleared, not refused, the same way enforce_jobs_insert_column_lock
  -- clears the lifecycle stamps; status is already forced to 'open' there.
  IF TG_OP = 'INSERT' THEN
    NEW.helper_completed_at := NULL;
    RETURN NEW;
  END IF;

  -- H-002: a client may not push a job INTO 'completed'. Every legitimate
  -- completion runs as a server role (service_role edge functions; postgres
  -- definer RPCs), never a client PATCH.
  IF NEW.status::text = 'completed'
     AND OLD.status::text IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'jobs.status -> completed is set when the escrow is released, not by the client (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'A job completes when its payment is released; it cannot be marked completed by a direct update.';
  END IF;

  -- H-001: helper_completed_at is the event that enters a job into the payout
  -- pipeline, so it is server-owned in full. The assigned Helpr's Done runs
  -- through rpc_helper_mark_done (SECURITY DEFINER, owner postgres -- admitted
  -- by the role gate above), which stamps now(). No direct client change of
  -- this column -- a first stamp, a re-point, or a clear -- is honoured.
  IF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at THEN
    RAISE EXCEPTION 'jobs.helper_completed_at is stamped by the server when the assigned Helpr marks the job done, not by the client (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Mark the job done as the assigned Helpr; the completion time is the server clock and cannot be changed afterward.';
  END IF;

  RETURN NEW;
END;
$function$;

-- A trigger function is run by the trigger machinery, never called by a role.
REVOKE ALL ON FUNCTION public.enforce_job_completion_server_owned() FROM PUBLIC, anon, authenticated;

DO $guard$
DECLARE
  v_cols int;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'jobs'
     AND column_name IN ('status', 'helper_completed_at', 'helper_id');
  -- All three predate this migration. If one is missing the lock would silently
  -- not exist, so fail the deploy instead of skipping.
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'helper_mark_done_rpc_and_completion_lock: expected 3 jobs columns, found %', v_cols;
  END IF;
  DROP TRIGGER IF EXISTS zz_jobs_completion_server_owned ON public.jobs;
  CREATE TRIGGER zz_jobs_completion_server_owned
    BEFORE INSERT OR UPDATE OF status, helper_completed_at
    ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_job_completion_server_owned();
END
$guard$;
