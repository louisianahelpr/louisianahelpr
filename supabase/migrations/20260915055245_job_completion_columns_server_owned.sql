-- COMPLETION IS THE SERVER'S CALL: A CLIENT CANNOT PICK THE VALUE OF
-- helper_completed_at, AND A CLIENT CANNOT PUSH A JOB INTO 'completed'.
--
-- Two PROVEN HIGH holes from the 2026-09-15 authz hole hunt
-- (docs/audit/holes-2026-09-15/authz-rls.md, findings H-001 and H-002), the
-- same class as the dispute-marker fix already live (20260915033734,
-- enforce_dispute_markers_server_owned). Both were reproduced in real Postgres
-- on the prod-shaped fixture with the LATEST guards applied, so the caller
-- faced MORE locks than prod, not fewer.
--
--   H-001 (HIGH). The assigned Helpr picks the VALUE of helper_completed_at.
--   enforce_helper_completion_gates (20260915044137) checks THAT proof photos
--   exist, THAT arrival is verified and poster-confirmed, and THAT 30 minutes
--   have passed -- but it never constrains the value written, and no trigger
--   clamps a lifecycle stamp to now(). So a Helpr who does the real work and
--   then, instead of the app's Done button (which sends now()), sends
--     PATCH /rest/v1/jobs { "helper_completed_at": "<now minus 25 hours>" }
--   passes every gate and lands a backdated stamp. auto-release-payment
--   (helper_completed_at <= now()-24h) is then due on the spot, and the
--   poster's entire 24-hour review/revision/dispute window is erased. Escrow is
--   captured at checkout (create-payment immediate capture), so the money moves
--   early and once it flips to 'completed' open_dispute_as refuses
--   (job_already_completed): one-way, no route back.
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
-- THE FIX: one BEFORE INSERT OR UPDATE trigger, modelled EXACTLY on the live
-- enforce_dispute_markers_server_owned. A direct client write (current_user is
-- 'authenticated' or 'anon', and the caller is not an admin):
--   * may not move jobs.status INTO 'completed' (H-002);
--   * may set helper_completed_at only as the assigned Helpr's FIRST stamp
--     (OLD NULL -> NEW non-NULL), and even then the VALUE is overwritten with
--     now() -- the client's timestamp is ignored, never trusted (H-001). Every
--     other change to helper_completed_at is refused: a second write that
--     re-points an already-set stamp, and a poster / offered Helpr / stranger
--     setting or CLEARING it (a poster clearing it defeats auto-release-payment
--     from the other side -- the KNOWN_OPEN poster/offered:helper_completed_at
--     pairs in src/test/jobsStateColumnGuard.test.ts, closed by this file).
--   * on INSERT has helper_completed_at cleared to NULL, the same way
--     enforce_jobs_insert_column_lock clears the lifecycle stamps (status is
--     already forced to 'open' there).
--
-- WHY current_user AND NOT A FLAG, and WHY NOT SECURITY DEFINER: verbatim the
-- reasoning of 20260915033734. The function is deliberately SECURITY INVOKER so
-- current_user is the role the UPDATE runs as:
--   * PostgREST with a user JWT            -> authenticated   (policed)
--   * inside any SECURITY DEFINER RPC       -> postgres        (allowed)
--   * edge functions with the service key   -> service_role    (allowed)
--   * pg_cron                               -> postgres        (allowed)
-- Every legitimate writer of these two columns is one of the allowed three,
-- read on 2026-09-15 (supabase/functions + pg_proc + src/):
--   helper_completed_at  -- the assigned Helpr's Done (JobTracking.tsx: a raw
--     PATCH, kept but value-clamped here); no other writer.
--   status='completed'   -- auto-release-payment, create-payment (poster
--     release), auto-resolve-disputes, instant-payout, process-scheduled-payouts
--     (all service_role edge functions); rpc_decide_dispute, rpc_withdraw_dispute
--     (SECURITY DEFINER, owner postgres). No client PATCH and no INVOKER RPC.
-- A flag would have meant re-creating those bodies to set it; current_user
-- needs no change to any of them.
--
-- WHY zz_ : named so it is the LAST BEFORE trigger on jobs (Postgres fires them
-- in name order), the same reason as zz_jobs_stamp_completed_at and
-- zz_jobs_arrival_integrity. The clamp is the server's own write ON TOP of what
-- every column-lock and gate trigger judged, so the value they saw was the
-- client's and the value that lands is now(). enforce_helper_completion_gates
-- (trg_, so ahead of this) still sees a non-NULL NEW.helper_completed_at and
-- fires its photo / arrival / 30-minute checks exactly as before -- the
-- 30-minute floor reads OLD.helper_arrived_at and now(), never this value, so
-- the clamp cannot bypass it.
--
-- NOT CHANGED. The transition matrix keeps in_progress -> completed: the
-- service-role and definer paths still pass through it. The dispute state
-- machine, cancellation, arrival and the money lock are untouched. poster's own
-- release still runs through create-payment (service_role). The completion
-- gates stay where they are.
--
-- REPLAY-SAFE: CREATE OR REPLACE function; the trigger is skipped when
-- public.jobs does not exist, DROP TRIGGER IF EXISTS runs first, and a jobs
-- table missing status / helper_completed_at / helper_id fails loudly rather
-- than silently shipping no lock.
-- Proof: scripts/probes/job-completion-columns.probe.mjs (PGlite, applied 3x,
-- red on the pre-fix shape, broken copies caught).

CREATE OR REPLACE FUNCTION public.enforce_job_completion_server_owned()
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
  -- pipeline, so its VALUE is the server clock, never a client-chosen time.
  IF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at THEN
    -- The assigned Helpr's Done (JobTracking.tsx), setting it from NULL: the
    -- write is kept, but the value is the database clock, not what they sent.
    IF OLD.helper_completed_at IS NULL
       AND NEW.helper_completed_at IS NOT NULL
       AND v_uid IS NOT NULL
       AND v_uid = OLD.helper_id THEN
      NEW.helper_completed_at := now();
    ELSE
      -- Anything else: a second write re-pointing an already-set stamp, or a
      -- poster / offered Helpr / stranger setting or CLEARING it.
      RAISE EXCEPTION 'jobs.helper_completed_at is stamped by the server when the assigned Helpr marks the job done, not by the client (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Mark the job done as the assigned Helpr; the completion time is the server clock and cannot be changed afterward.';
    END IF;
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
    RAISE EXCEPTION 'job_completion_columns_server_owned: expected 3 jobs columns, found %', v_cols;
  END IF;
  DROP TRIGGER IF EXISTS zz_jobs_completion_server_owned ON public.jobs;
  CREATE TRIGGER zz_jobs_completion_server_owned
    BEFORE INSERT OR UPDATE OF status, helper_completed_at
    ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_job_completion_server_owned();
END
$guard$;
