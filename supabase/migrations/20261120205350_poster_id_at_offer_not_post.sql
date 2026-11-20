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
--   3. The address (owner 2026-11-20): a Helpr gets the job's street address and exact location only once the
--      poster is ID-verified AND the Helpr has ACCEPTED (jobs.helper_confirmed_at, set by complete_job_accept for a
--      hire, a direct offer and an instant booking alike; group_job_helpers.helper_confirmed_at for a crew seat).
--      The offer gate above makes "accepted" imply "the poster was verified when they sent it", so a later reset of
--      the poster's ID never hides a job a Helpr is already booked on. An offered, not-yet-accepted Helpr still sees
--      what they need to answer (title, price, day, masked area: get_jobs_for_my_applications and
--      get_my_pending_direct_offers mask location to town + 2-dp coordinates whenever user_may_see_job_address is
--      false), never the street address. Every server path that handed a not-yet-accepted Helpr the row:
--        * user_may_see_job_address (policy "Selected helpers can view their job", and the unmask switch of the two
--          masked RPCs and export_my_data): the poster, a Helpr who accepted, a crew member who confirmed. The pending
--          direct-offer branch and the accepted-application branch (an application is 'accepted' when the poster
--          OFFERS) are gone;
--        * policy "Users can view their own jobs": the poster, or the Helpr once they accepted (was: helper_id alone,
--          which is set when the poster offers);
--        * policy "Targeted helper can view direct offer": dropped (the offeree reads get_my_pending_direct_offers);
--        * can_read_job_access_notes (gate codes, parking): the poster, or a Helpr / crew member who accepted, or the
--          standing Helpr of a series.
--      Measured on prod 2026-11-20 (read-only): every job with a helper_id (220) has helper_confirmed_at; 0 live
--      accepted applications or pending direct offers rely on the removed branches; 2 unconfirmed crew seats on open
--      jobs move to the masked view until their Helpr confirms.
-- Restated in full from the effective definitions; grants restated. Replay-safe (DROP ... IF EXISTS,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS before CREATE TRIGGER).
-- Guard: src/test/posterIdAtOffer.test.ts; proof: src/test/pglite/posterIdAtOffer.pglite.mjs.

-- 1. Posting: no ID.
DROP TRIGGER IF EXISTS trg_jobs_identity_before_post ON public.jobs;
DROP FUNCTION IF EXISTS public.enforce_identity_before_post();

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

-- 3. The address: only once the Helpr has accepted (and the poster was verified to send the offer).
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
          -- CHANGED (owner 2026-11-20): the hired Helpr only once they ACCEPTED (an offer sets helper_id first).
          OR (j.helper_id = _user_id AND j.helper_confirmed_at IS NOT NULL)
        )
    )
    OR EXISTS (
      -- CHANGED (owner 2026-11-20): a crew member only once they confirmed their seat.
      SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = _job_id AND g.helper_id = _user_id AND g.helper_confirmed_at IS NOT NULL
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_may_see_job_address(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view their own jobs" ON public.jobs;
CREATE POLICY "Users can view their own jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = customer_id
    OR ((SELECT auth.uid()) = helper_id AND helper_confirmed_at IS NOT NULL)
  );

-- The offeree reads get_my_pending_direct_offers (location masked until they accept).
DROP POLICY IF EXISTS "Targeted helper can view direct offer" ON public.jobs;

CREATE OR REPLACE FUNCTION public.can_read_job_access_notes(_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = _job_id
       AND (j.customer_id = auth.uid()
            OR (j.status::text NOT IN ('completed', 'cancelled')
                -- CHANGED (owner 2026-11-20): only once the Helpr accepted / the crew member confirmed.
                AND ((j.helper_id = auth.uid() AND j.helper_confirmed_at IS NOT NULL)
                     OR j.recurring_helper_id = auth.uid()
                     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                                 WHERE g.job_id = j.id AND g.helper_id = auth.uid() AND g.helper_confirmed_at IS NOT NULL))))
  );
$fn$;
REVOKE ALL ON FUNCTION public.can_read_job_access_notes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_job_access_notes(uuid) TO authenticated, service_role;
