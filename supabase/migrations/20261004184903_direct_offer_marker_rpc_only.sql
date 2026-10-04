-- Q1205 (docs/OPEN.md): a poster could PATCH jobs.direct_offer_status and
-- jobs.direct_offer_expires_at at any time.
--
-- Read live 2026-10-04: authenticated holds table-level UPDATE on jobs
-- (relacl awdxm); "Customers can update their own jobs" has no WITH CHECK and
-- no CHECK bounds either column; neither enforce_poster_jobs_money_lock nor
-- prevent_job_field_escalation nor enforce_hire_columns_rpc_only names them.
-- So a poster could re-arm 'pending' on a booked job (with a NULL expiry the
-- sweep never clears it), and the targeted Helpr could stamp 'declined' or
-- 'accepted' without going through respond_to_direct_offer.
--
-- Fix: enforce_hire_columns_rpc_only (the Q346 "straight from a client" gate:
-- SECURITY INVOKER, so current_user is the PostgREST role only for a direct
-- PATCH and the owner inside a definer RPC) refuses any client change of
-- either column. Every live writer, read from pg_proc on 2026-10-04 by body
-- (prosrc ~ 'direct_offer_(status|expires_at) (:=|=)'), is SECURITY DEFINER
-- except jobs_reopen_retires_direct_offer, whose trigger
-- (zzz_jobs_reopen_retires_direct_offer) fires after trg_hire_columns_rpc_only.
-- The client writes them only at INSERT (jobSubmitHelpers.ts, the posting
-- path), which this UPDATE trigger does not see.
--
-- Restated from its newest definition (20260924044812_recurring_helper_rpc_only,
-- md5(prosrc) live 87474e3cf21e67d47730445ac928d1b6 = that file), plus the two
-- checks. Replay-safe: CREATE OR REPLACE; the trigger is unchanged.

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
