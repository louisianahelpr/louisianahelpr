-- Q1324 (docs/OPEN.md; found by the lh-authz-rls review of Q1283, 2026-10-05,
-- prod dry run by the lead: rows=1): a poster could PATCH
-- jobs.offered_to_helper_id from a Helpr to NULL. enforce_hire_columns_rpc_only
-- refused only a change TO a non-NULL id, so the clear landed and left
-- direct_offer_status 'pending' with no target.
--
-- Now any client change of offered_to_helper_id is refused, NULL included.
-- Its writers after posting are all SECURITY DEFINER (respond_to_direct_offer,
-- expire_pending_direct_offers, block_user_and_settle,
-- settle_one_off_jobs_for_banned_account: current_user is their owner, so they
-- never reach this branch) or the later-sorting trigger
-- zzz_jobs_reopen_retires_direct_offer; no client code in src/ updates it
-- (the posting INSERT is its one client writer, governed by
-- enforce_jobs_insert_column_lock).
--
-- Restated from its newest definition, 20261004184903 (md5(prosrc) live
-- 2026-10-05 8c09ba2d9b2221988970ee8292ea306a = that file), with the one
-- condition widened. Replay-safe: CREATE OR REPLACE; the trigger is unchanged.
-- Guard: src/test/directOfferMarkerRpcOnly.test.ts (the offered_to_helper_id
-- case) + src/test/pglite/offeredHelperNotClearedByClient.pglite.mjs.

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
    -- Q1324: ANY client change, clearing it included. Clearing it left
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
