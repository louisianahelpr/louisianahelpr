-- Stripe Identity before a member's first accepted job, first posted job, and
-- before a Helpr heads out (owner, 2026-10-21).
--
-- "ID verified" means ONE thing now: Stripe Identity's photo ID + selfie
-- verdict, profiles.idv_status = 'verified' (an admin-approved ID writes the same
-- value, Q2201). Payout setup (Stripe Connect) is a separate fact and no longer
-- counts as an ID check anywhere: the badges moved in 20261021074131, the gates
-- move here.
--
-- 1. identity_is_verified(): the ONE rule every gate reads (helper_accept_missing
--    -> accept_job_offer, respond_to_direct_offer, claim_series_dates,
--    rpc_group_member_confirm, the pending-accept completers; is_identity_verified
--    -> stripe-idv-start's "already verified", claim_idv_attempt). It drops the
--    Connect arm. The second parameter is kept so no caller changes; it only
--    says a profile row was read (NULL fails closed).
--    The pending-accept triggers already fire on idv_status, so an accept that
--    waits on the ID completes by itself when Stripe Identity says verified.
--
-- 2. Posting: a member's own job INSERT needs Identity (BEFORE INSERT trigger).
--    Only user-initiated posts: server writes (recurring visits, sweeps),
--    admins, and enrolled test accounts are untouched. A poster's EXISTING jobs
--    are never touched: confirm, release and pay run on UPDATE, not INSERT.
--
-- 3. Heading out: a Helpr marking On the way, checking in, or moving a job to
--    in progress needs Identity (BEFORE UPDATE triggers on jobs and on the crew
--    roster), judged only when the acting member IS that Helpr. Accept, the
--    day-of "Confirm you'll be at the job" and schedule-change answers are not
--    gated: a Helpr who accepted before this rule confirms as usual, then verifies,
--    then heads out.
--
-- 4. One notice, once, to the real members this affects today (a Helpr booked
--    on an upcoming job, or a member with an active posted job, without Identity).
--    Idempotent: never a second copy for the same member.
--
-- The poster's $2 first-job setup fee is untouched (charged at the first job's
-- checkout, as before); Helpr absorbs the Stripe Identity cost (stripe-idv-start
-- no longer asks for the fee first).

CREATE OR REPLACE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Stripe Identity only (owner 2026-10-21). p_stripe_identity_verified (Stripe
  -- Connect's KYC flag, a payout-setup fact) no longer counts as an ID check; it
  -- is kept in the signature, and read only as "a profile row was read": the
  -- column is NOT NULL, so NULL means no row (a LEFT JOIN miss) and fails closed
  -- (Q140, null-arg-validators: a NULL argument never says yes).
  SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL;
$fn$;

-- An enrolled test account (is_seed AND in test_accounts) keeps its fixture
-- carve-out, the same membership rule helper_accept_missing uses.
CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
      FROM public.profiles p WHERE p.user_id = p_user_id
  ), false);
$fn$;
REVOKE ALL ON FUNCTION public.identity_check_exempt(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_identity_before_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Server writes (recurring visits, sweeps) are not a member posting.
  IF public.is_server_context() OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only the member's OWN post is judged here; who may insert for whom is the
  -- insert policy's and trg_jobs_insert_column_lock's business.
  IF NEW.customer_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_identity_verified(auth.uid()) THEN
    RAISE EXCEPTION 'identity_required_to_post' USING ERRCODE = '42501',
      HINT = 'Verify your ID with Stripe before you post a job. It takes about 2 minutes, once.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_identity_before_post() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_identity_before_post ON public.jobs;
CREATE TRIGGER trg_jobs_identity_before_post
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_post();

CREATE OR REPLACE FUNCTION public.enforce_identity_before_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_starting boolean;
BEGIN
  IF public.is_server_context() OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Judged only when the acting member is this row's Helpr: the poster's
  -- confirm/release and admin actions are never held by the Helpr's ID.
  IF NEW.helper_id IS NULL OR auth.uid() IS DISTINCT FROM NEW.helper_id THEN
    RETURN NEW;
  END IF;
  v_starting :=
       (NEW.helper_on_the_way_at IS NOT NULL AND OLD.helper_on_the_way_at IS NULL)
    OR (NEW.helper_arrived_at IS NOT NULL AND OLD.helper_arrived_at IS NULL)
    OR (TG_TABLE_NAME = 'jobs' AND OLD.status::text = 'accepted' AND NEW.status::text = 'in_progress');
  IF NOT v_starting THEN
    RETURN NEW;
  END IF;
  IF public.identity_check_exempt(NEW.helper_id) THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_identity_verified(NEW.helper_id) THEN
    RAISE EXCEPTION 'identity_required_to_start' USING ERRCODE = '42501',
      HINT = 'Verify your ID with Stripe before you head out. It takes about 2 minutes, once.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_identity_before_start() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_identity_before_start ON public.jobs;
CREATE TRIGGER trg_jobs_identity_before_start
  BEFORE UPDATE OF helper_on_the_way_at, helper_arrived_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_start();

DROP TRIGGER IF EXISTS trg_crew_identity_before_start ON public.group_job_helpers;
CREATE TRIGGER trg_crew_identity_before_start
  BEFORE UPDATE OF helper_on_the_way_at, helper_arrived_at ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_start();

-- 4. The one notice. Real members only (never a test account), unverified,
-- with a booked upcoming job not yet started, or an active posted job.
INSERT INTO public.notifications (user_id, type, title, message, link)
SELECT DISTINCT x.uid, 'job_updates', 'Verify your ID with Stripe',
       'Before your next job, verify your ID with Stripe. It takes about 2 minutes.',
       '/home?verify_id=1'
  FROM (
    SELECT j.helper_id AS uid FROM public.jobs j
     WHERE j.helper_id IS NOT NULL AND j.status::text IN ('accepted', 'in_progress')
       AND j.helper_on_the_way_at IS NULL
       AND (j.date_needed IS NULL OR j.date_needed >= (now() AT TIME ZONE 'America/Chicago')::date)
    UNION
    SELECT g.helper_id FROM public.group_job_helpers g JOIN public.jobs j ON j.id = g.job_id
     WHERE j.status::text IN ('accepted', 'in_progress') AND g.helper_on_the_way_at IS NULL
       AND (j.date_needed IS NULL OR j.date_needed >= (now() AT TIME ZONE 'America/Chicago')::date)
    UNION
    SELECT j.customer_id FROM public.jobs j WHERE j.status::text IN ('open', 'accepted', 'in_progress')
  ) x
  JOIN public.profiles p ON p.user_id = x.uid
 WHERE p.is_seed IS NOT TRUE
   AND p.idv_status IS DISTINCT FROM 'verified'
   AND NOT EXISTS (
     SELECT 1 FROM public.notifications n
      WHERE n.user_id = x.uid AND n.title = 'Verify your ID with Stripe' AND n.link = '/home?verify_id=1'
   );
