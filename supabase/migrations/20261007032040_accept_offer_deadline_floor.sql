-- Q1391 (lh-authz-rls review of the crews lane, 2026-10-05): a poster could
-- hand a single Helpr an answer-by a few minutes out (or, before 20261005184940,
-- in the past) and the hourly expire_unanswered_offers would close the offer,
-- unanswered, before the Helpr saw it. 20261005184940 refused a deadline
-- already past but stored one minutes ahead as sent. This floors every
-- deadline (past ones included) at 55 minutes from now, the crew twin's rule
-- (accept_group_application, 20261005172453), still capped by the job's start
-- and 48 hours. The invalid_deadline check stays as a backstop; job_starts_too_soon
-- (start within 15 minutes) is what refuses a hire now.
--
-- Restated from 20261005184940 (identical to prod's pg_get_functiondef,
-- 2026-10-07) with only the v_deadline line changed. Replay-safe: CREATE OR
-- REPLACE with the same signature; grants restated.

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid, p_deadline timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_helper_id uuid;
  v_app_status text;
  v_job_status text;
  v_job_customer uuid;
  v_date_needed date;
  v_start_time time;
  v_cutoff timestamptz;
  v_deadline timestamptz;
BEGIN
  -- Resolve the application and the job it belongs to. The job is
  -- derived from the application itself, so a poster can only ever
  -- accept against a job that application actually belongs to.
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here.
  SELECT j.status, j.customer_id, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- Authorize: only the job's poster may accept an applicant.
  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction. After not_authorized,
  -- so only the job's own poster ever learns this refusal.
  IF public.are_users_blocked(v_helper_id, v_job_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  -- Race guard: the job must still be open. The second of two
  -- concurrent accepts hits this and is rejected.
  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  -- The answer-by time: never past the job's start, never more than 48 h,
  -- and never what a client says alone (header note).
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;
  -- Q1391: never sooner than the shortest window the app offers (1 hour,
  -- less 5 minutes of clock skew), as accept_group_application already does
  -- (20261005172453). A deadline minutes ahead was stored as sent, and
  -- expire_unanswered_offers then ended the offer before the Helpr could read
  -- the push. The job's start still wins: a job starting sooner keeps its
  -- start as the answer-by (and a lapse the start caused is never a strike).
  v_deadline := LEAST(
    GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'),
    v_cutoff);
  IF v_deadline <= now() THEN
    RAISE EXCEPTION 'invalid_deadline';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = v_helper_id,
         response_deadline = v_deadline
   WHERE id = v_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application(uuid, timestamp with time zone, text) TO authenticated, service_role;

-- And no client writes the deadline around the RPC (lh-authz-rls review of
-- this migration, 2026-10-07). The poster's own lock
-- (enforce_poster_jobs_money_lock) cannot hold it: it also runs inside the
-- poster's definer RPCs (auth.uid() is still the poster there), so it would
-- refuse accept_application's own write. enforce_hire_columns_rpc_only checks
-- current_user instead, so definer RPCs pass. Restated from its newest
-- definition, 20261005063441 (body identical to prod's pg_get_functiondef,
-- 2026-10-07), plus the one check (any client change, a clear included). The crew roster's response_deadline is
-- already server-owned (enforce_group_member_lifecycle_server_owned).

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
    -- Q1325: ANY client change, clearing it included. Clearing it left
    -- direct_offer_status 'pending' with no target: the job went public in
    -- open_jobs_browse while the poster's card said "offer out", and the
    -- expiry sweep later told them the offer "was not accepted".
    IF NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id THEN
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
    -- Q1205: the direct-offer marker is the server's after posting. Its
    -- writers are respond_to_direct_offer / complete_direct_offer_accept,
    -- expire_pending_direct_offers, block_user_and_settle and
    -- settle_one_off_jobs_for_banned_account (all SECURITY DEFINER, so they
    -- never reach this branch) and zzz_jobs_reopen_retires_direct_offer
    -- (a BEFORE trigger that fires AFTER this one, so this one never sees its
    -- write). A client's PATCH re-arming 'pending' on a booked job, or a
    -- target Helpr marking it 'declined' or 'accepted' by hand, is refused.
    IF NEW.direct_offer_status IS DISTINCT FROM OLD.direct_offer_status THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.direct_offer_status is written only by the direct-offer flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Answer the offer with respond_to_direct_offer; an offer is made when the job is posted.';
    END IF;
    -- Q1391 (lh-authz-rls review, 2026-10-07): the reply deadline is the hire
    -- RPCs' alone. accept_application / accept_group_application set it (and
    -- floor it, above); every other writer clears it; all are SECURITY
    -- DEFINER, so none reaches this branch. A poster's PATCH of it was
    -- accepted (measured live on a seed job: HTTP 200), so a poster could
    -- backdate a booked Helpr's deadline and the hourly
    -- expire_unanswered_offers sweep would strike them. A clear is refused
    -- too: expire_unanswered_offers skips a NULL deadline, so the offered
    -- Helpr clearing it (enforce_helper_jobs_column_whitelist still allows a
    -- clear) would hold the poster's job forever. Every clearing writer is a
    -- definer function (review, 2026-10-07).
    IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.response_deadline is set only by the hire flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'The reply deadline is picked when the Helpr is hired.';
    END IF;
    IF NEW.direct_offer_expires_at IS DISTINCT FROM OLD.direct_offer_expires_at THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.direct_offer_expires_at is set only when the job is posted (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'An offer''s window is picked when the job is posted.';
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

REVOKE ALL ON FUNCTION public.enforce_hire_columns_rpc_only() FROM PUBLIC, anon, authenticated;
