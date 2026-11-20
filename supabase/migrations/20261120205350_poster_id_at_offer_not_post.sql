-- The job poster's ID check moves from POSTING to SENDING AN OFFER (owner 2026-11-20). Helprs are unchanged (ID when
-- hired / heading out / first payout, never at apply); the $2 poster fee stays with the first job payment (no fee
-- code here).
--
--   1. Posting needs no ID: trg_jobs_identity_before_post and enforce_identity_before_post (20261021081258,
--      'identity_required_to_post' on every jobs INSERT by its poster) are dropped.
--   2. NEW enforce_poster_identity_before_offer, 'identity_required_to_offer' (42501), when the ACTING member is the
--      job's poster and is not ID-verified (admins and identity_check_exempt -- enrolled test accounts, and everyone
--      while the identity_check switch is off for them -- pass, as at every other ID gate). It fires on every write
--      that puts a Helpr on the poster's job, whatever RPC makes it:
--        * jobs INSERT naming offered_to_helper_id or helper_id: a direct offer posted from a profile / Book again /
--          rpc_hire_target_by_handle, and book_accepted_quote -> quote_insert_job (booking an agreed quote);
--        * jobs UPDATE that sets a new helper_id or offered_to_helper_id: accept_application,
--          accept_application_at_suggested_time, rpc_instant_book;
--        * group_job_helpers INSERT: accept_group_application (a crew seat);
--        * series_date_offers INSERT: offer_series_dates (open series dates offered to an applicant).
--      Not judged: a server context (webhooks, sweeps: e.g. quote_job_funded_hires_quoter, recurring visits), or a
--      write by anyone who is not the job's poster (a Helpr answering a direct offer, claiming series dates or
--      taking a crew seat they were offered). Those follow an offer the poster already sent through this gate.
--   3. The Helpr never sees the job's address until the poster is verified: user_may_see_job_address (the jobs
--      SELECT policy, get_jobs_for_my_applications, get_my_pending_direct_offers, export_my_data) keeps every
--      existing branch and adds, for everyone but the poster, poster_id_cleared(customer_id) (verified, an admin or
--      identity_check_exempt), or an ownerless job (a deleted poster; CLAUDE.md "a job can outlive its poster").
--      poster_id_cleared(NULL) is FALSE (Q140: a NULL never says yes); the ownerless case is the caller's own test.
--      Measured on prod 2026-11-20 (read-only): 11 in_progress and 123 open jobs, 0 with an uncleared poster, so no
--      booked Helpr loses a job they hold today.
-- Restated in full from the effective definitions; grants restated. Replay-safe (DROP ... IF EXISTS,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS before CREATE TRIGGER).
-- Guard: src/test/posterIdAtOffer.test.ts; proof: src/test/pglite/posterIdAtOffer.pglite.mjs.

-- 1. Posting: no ID.
DROP TRIGGER IF EXISTS trg_jobs_identity_before_post ON public.jobs;
DROP FUNCTION IF EXISTS public.enforce_identity_before_post();

-- Whether a poster's ID no longer stands between a Helpr and the job's address. Not client-callable.
-- NULL is FALSE, never NULL (Q140, scripts/ci/null-arg-validators.sql).
CREATE OR REPLACE FUNCTION public.poster_id_cleared(p_poster uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_poster IS NOT NULL AND COALESCE(
       public.is_identity_verified(p_poster)
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_poster AND r.role = 'admin')
    OR public.identity_check_exempt(p_poster), false);
$fn$;
REVOKE ALL ON FUNCTION public.poster_id_cleared(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poster_id_cleared(uuid) TO service_role;

-- 2. The poster's ID at the offer.
CREATE OR REPLACE FUNCTION public.enforce_poster_identity_before_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_poster uuid;
  v_offering boolean := false;
BEGIN
  IF public.is_server_context() OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'jobs' THEN
    v_poster := NEW.customer_id;
    IF TG_OP = 'INSERT' THEN
      v_offering := NEW.offered_to_helper_id IS NOT NULL OR NEW.helper_id IS NOT NULL;
    ELSE
      v_offering := (NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id)
                 OR (NEW.offered_to_helper_id IS NOT NULL AND NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'group_job_helpers' THEN
    SELECT j.customer_id INTO v_poster FROM public.jobs j WHERE j.id = NEW.job_id;
    v_offering := true;
  ELSIF TG_TABLE_NAME = 'series_date_offers' THEN
    SELECT j.customer_id INTO v_poster FROM public.jobs j WHERE j.id = NEW.parent_job_id;
    v_offering := true;
  END IF;
  -- Only the poster's own offer is judged (a Helpr's answer never is).
  IF NOT v_offering OR v_poster IS NULL OR v_uid IS DISTINCT FROM v_poster THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_uid, 'admin') OR public.identity_check_exempt(v_uid) OR public.is_identity_verified(v_uid) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'identity_required_to_offer' USING ERRCODE = '42501',
    HINT = 'Verify your ID with Stripe before you send an offer. It takes about 2 minutes, once.';
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_poster_identity_before_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_poster_identity_before_offer ON public.jobs;
CREATE TRIGGER trg_jobs_poster_identity_before_offer
  BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();

DROP TRIGGER IF EXISTS trg_crew_poster_identity_before_offer ON public.group_job_helpers;
CREATE TRIGGER trg_crew_poster_identity_before_offer
  BEFORE INSERT ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();

DROP TRIGGER IF EXISTS trg_series_offer_poster_identity_before_offer ON public.series_date_offers;
CREATE TRIGGER trg_series_offer_poster_identity_before_offer
  BEFORE INSERT ON public.series_date_offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_identity_before_offer();

-- 3. The address: every existing branch, plus the poster's ID for everyone but the poster.
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(_job_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
    AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context())
    AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (
          j.customer_id = _user_id
          OR (
            -- CHANGED (owner 2026-11-20): a Helpr sees the address only once the poster is ID-verified.
            (j.customer_id IS NULL OR public.poster_id_cleared(j.customer_id))
            AND (
              j.helper_id = _user_id
              OR (
                j.offered_to_helper_id = _user_id
                AND j.direct_offer_status = 'pending'
                AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at > now())
              )
            )
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
      WHERE g.job_id = _job_id AND g.helper_id = _user_id
        AND (j.customer_id IS NULL OR public.poster_id_cleared(j.customer_id))
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
      WHERE a.job_id = _job_id AND a.helper_id = _user_id AND a.status = 'accepted'
        AND (j.customer_id IS NULL OR public.poster_id_cleared(j.customer_id))
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_may_see_job_address(uuid, uuid) TO authenticated, service_role;
