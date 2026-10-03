-- docs/OPEN.md Q1180. The poster's Hire sends the offer; the Helpr's tap on
-- Accept completes it only once their payout setup AND Stripe ID are done, and
-- only then is the poster told (owner, 2026-10-02 and 2026-10-03: "thank you
-- for accepting the offer, in order to fully accept these 2 things must be
-- done before we will notify the poster that you have accepted"; "it's
-- required immediately after they accept"; "if they have any of it done
-- already there is no need to require it again"; "it shouldn't hold up
-- anything").
--
-- What changes, layer by layer:
--   * job_accept_pending: one row per offer whose Helpr tapped Accept while
--     setup was unfinished. Clients can read their own rows and write none;
--     only accept_job_offer() inserts, so nobody can forge an accept.
--   * helper_accept_missing(uid) / helper_accept_block_reason(uid): what is
--     still missing, 'payout_setup' and/or 'stripe_id' (identity_is_verified,
--     the "ID verified by Stripe" fact). Identity gates the ACCEPT only:
--     posting and the poster's Hire stay ungated (20261001222911 holds).
--   * accept_job_offer(job): the Helpr's Accept on a single job. Ready: the
--     accept completes now. Not ready: a pending row, and the app shows the
--     thank-you pop-up listing only what is missing.
--   * complete_job_accept(job): the one completion: helper_confirmed_at, the
--     other applicants closed (reject_other_applications_on_accept's rule),
--     and the poster's "<name> accepted your offer" (none existed before:
--     0 such notifications on prod 2026-10-03).
--   * trg_profiles_complete_pending_accepts: when Stripe reports the Helpr
--     ready (server-written columns; clients cannot change them), every pending
--     accept completes and the Helpr is told.
--   * jobs_award_gate: no Hire is judged; the accept is, and so is every way
--     around it the lh-authz-rls review found (2026-10-03): F1 accepted ->
--     in_progress / revision_requested / completed, or a done stamp, with no
--     accept (mark_helper_arrival, a Helpr or poster PATCH); F2 a confirmation
--     stamped before the Helpr is on the job (direct offers); F3 a confirmed
--     row changing Helpr (a no-show reopen left the stamp behind).
--   * report_helper_no_show: refuses a Helpr who never accepted, and its reopen
--     clears every stamp of the departed booking (as helper_cancel_booking);
--     enforce_poster_jobs_money_lock lets exactly that clear through (the
--     trusted ladder flag, the two acceptance stamps to NULL, with helper_id
--     to NULL), as it already does for the unassign itself.
--   * expire_unanswered_offers / decline_job_offer: no strike while the Helpr's
--     setup is unfinished or their accept is pending (owner: "it shouldn't hold
--     up anything"); the expiry message says so.
--   * trg_jobs_clear_accept_pending: a pending row goes when the offer moves on
--     (new Helpr, accept complete, job no longer 'accepted').
--
-- The four restated functions (expire_unanswered_offers, decline_job_offer,
-- report_helper_no_show, enforce_poster_jobs_money_lock) are their live
-- bodies (md5(prosrc) matched the repo text 2026-10-03) with only the edits
-- marked Q1180.
--
-- REPLAY-SAFETY: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS;
-- plpgsql bodies are not resolved at creation. Proof:
-- src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs (live-identical
-- function bodies, prod's jobs triggers and policies; red on the previous
-- definitions). Guard: src/test/acceptCompletesAfterStripeSetup.test.ts.

CREATE TABLE IF NOT EXISTS public.job_accept_pending (
  job_id       uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_accept_pending_helper_idx ON public.job_accept_pending (helper_id);
ALTER TABLE public.job_accept_pending ENABLE ROW LEVEL SECURITY;
-- Q807: an account whose email is unconfirmed writes nothing; clients cannot
-- write this table anyway, but every new table carries the gate.
SELECT public.attach_unconfirmed_email_gate();
REVOKE ALL ON TABLE public.job_accept_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_accept_pending TO authenticated;
GRANT ALL ON TABLE public.job_accept_pending TO service_role;
DROP POLICY IF EXISTS "Helprs read their own pending accepts" ON public.job_accept_pending;
CREATE POLICY "Helprs read their own pending accepts" ON public.job_accept_pending
  FOR SELECT TO authenticated USING (helper_id = (SELECT auth.uid()));
COMMENT ON TABLE public.job_accept_pending IS
  'Q1180: an offer whose Helpr tapped Accept before their payout setup and Stripe ID were done. Written only by accept_job_offer(); completed by trg_profiles_complete_pending_accepts when Stripe reports both done; removed when the offer moves on.';

-- What the Helpr still has to finish before an accept can complete.
CREATE OR REPLACE FUNCTION public.helper_accept_missing(p_user_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p.user_id IS NULL THEN ARRAY['unknown']
           -- Fixture data stays usable while fixture-shaped (helper_award_block_reason's carve-out).
           WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL THEN ARRAY[]::text[]
           ELSE array_remove(ARRAY[
             CASE WHEN p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE THEN 'payout_setup' END,
             CASE WHEN NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END
           ], NULL)
         END
    FROM (SELECT p_user_id AS uid) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid;
$fn$;

CREATE OR REPLACE FUNCTION public.helper_accept_block_reason(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p_user_id IS NULL OR 'unknown' = ANY (m) THEN 'helper_unknown'
           WHEN 'payout_setup' = ANY (m) THEN 'helper_payout_setup_incomplete'
           WHEN 'stripe_id' = ANY (m) THEN 'helper_identity_unverified'
         END
    FROM (SELECT public.helper_accept_missing(p_user_id) AS m) s;
$fn$;

REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.helper_accept_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_accept_missing(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.helper_accept_block_reason(uuid) TO service_role;

-- The gate. A plain Hire (helper_id set, nothing confirmed) is an offer and is
-- not judged. Everything that makes the job the Helpr's is.
CREATE OR REPLACE FUNCTION public.enforce_helper_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason   text;
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged. An anon request is an end-user
  -- session with no uid, not a server write.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Nothing starts, finishes or is disputed on an offer the Helpr has not
  -- accepted, ready or not: the accept goes through accept_job_offer, which
  -- tells the poster. Refused outright (lh-authz-rls re-review 2026-10-03:
  -- a READY Helpr who never tapped Accept could mark_helper_arrival into
  -- in_progress with no poster notice, and either party could open a dispute
  -- on an offer, freezing the escrow). Server sweeps and system disputes run
  -- in server context and returned above.
  IF TG_OP = 'UPDATE' AND NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NULL
     AND ((OLD.status::text = 'accepted'
           AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed'))
          OR (NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL)) THEN
    RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';
  END IF;

  v_awarding :=
       -- the accept itself, with or without a Helpr on the row (F2: a stamp
       -- before the Helpr is on the job is judged against nobody and refused)
       (NEW.helper_confirmed_at IS NOT NULL
          AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL))
       -- a confirmed row changing Helpr is a new accept (F3)
    OR (NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NOT NULL
          AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id);

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  v_reason := public.helper_accept_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_helper_award_gate() FROM PUBLIC, anon;

-- The one completion of an accept.
CREATE OR REPLACE FUNCTION public.complete_job_accept(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job  record;
  v_name text;
BEGIN
  UPDATE public.jobs
     SET helper_confirmed_at = now(),
         response_deadline = NULL
   WHERE id = p_job_id
     AND status = 'accepted'
     AND helper_id IS NOT NULL
     AND helper_confirmed_at IS NULL
     AND (response_deadline IS NULL OR response_deadline > now())
     -- the server path (the profiles trigger) skips enforce_job_funded_before_award
     AND public.job_payment_is_funded(payment_status::text)
  RETURNING id, helper_id, customer_id, title INTO v_job;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The other applicants learn the spot is taken (reject_other_applications_on_accept's rule).
  UPDATE public.applications
     SET status = 'rejected', updated_at = now()
   WHERE job_id = p_job_id
     AND helper_id IS DISTINCT FROM v_job.helper_id
     AND status = 'pending';

  IF v_job.customer_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Your Helpr') INTO v_name
      FROM public.profiles p WHERE p.user_id = v_job.helper_id;
    v_name := COALESCE(v_name, 'Your Helpr');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      v_name || ' accepted your offer',
      v_name || ' accepted "' || COALESCE(v_job.title, 'your job') || '". You''re all set.',
      'job_updates',
      '/posts?job=' || p_job_id::text,
      p_job_id
    );
  END IF;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_job_accept(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_accept(uuid) TO service_role;

-- The Helpr's Accept on a single job.
CREATE OR REPLACE FUNCTION public.accept_job_offer(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_job    record;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Profile before job: the same lock order as the profiles trigger below, so
  -- a Stripe status write landing mid-accept either completes this pending row
  -- after it commits or is read here fresh, never missed (review #5).
  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR SHARE;

  SELECT j.id, j.helper_id, j.status, j.helper_confirmed_at, j.response_deadline, j.is_group_job,
         j.payment_status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'group_job_not_supported';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  IF v_job.response_deadline IS NOT NULL AND v_job.response_deadline <= now() THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;
  IF NOT public.job_payment_is_funded(v_job.payment_status::text) THEN
    RAISE EXCEPTION 'job_not_funded';
  END IF;

  v_reason := public.helper_accept_block_reason(v_uid);
  IF v_reason IS NULL THEN
    IF NOT public.complete_job_accept(p_job_id) THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN jsonb_build_object('state', 'accepted');
  END IF;
  IF v_reason = 'helper_unknown' THEN
    RAISE EXCEPTION 'helper_unknown';
  END IF;

  INSERT INTO public.job_accept_pending (job_id, helper_id)
  VALUES (p_job_id, v_uid)
  ON CONFLICT (job_id) DO UPDATE
    SET helper_id = EXCLUDED.helper_id, requested_at = now()
    WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
  RETURN jsonb_build_object('state', 'pending_setup', 'missing', to_jsonb(public.helper_accept_missing(v_uid)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.accept_job_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_job_offer(uuid) TO authenticated, service_role;

-- When Stripe reports the Helpr ready, every pending accept completes.
CREATE OR REPLACE FUNCTION public.complete_pending_accepts_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  r        record;
  v_poster text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_accept_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force (is_caller_banned's predicate) completes nothing; the
  -- pending row waits and goes when the offer moves on (review #6: in server
  -- context enforce_ban_gate is skipped, so the poster would hear "accepted").
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    -- seed: a seed job, or a seed/test Helpr (detect_stuck_payments' rule)
    SELECT p.job_id, j.title, j.customer_id,
           coalesce(j.is_seed OR NEW.is_seed, false) AS seed
      FROM public.job_accept_pending p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
       AND j.helper_id = p.helper_id
       AND j.status = 'accepted'
     ORDER BY p.requested_at
       FOR UPDATE OF j
  LOOP
    -- One job that cannot complete never rolls back the Stripe status write
    -- this trigger runs inside (review #3; settle_one_off_jobs_for_banned_account's
    -- pattern): it is logged, and the rest still complete.
    BEGIN
      IF public.complete_job_accept(r.job_id) THEN
        SELECT COALESCE(NULLIF(btrim(pp.full_name), ''), 'the person who posted it') INTO v_poster
          FROM public.profiles pp WHERE pp.user_id = r.customer_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your payout setup and Stripe ID are done, so you''ve accepted "' || COALESCE(r.title, 'the job')
            || '", and ' || COALESCE(v_poster, 'the person who posted it') || ' has been told.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E job logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN r.seed THEN 'info' ELSE 'error' END,
        'pending accept completion failed',
        jsonb_build_object('source', 'complete_pending_accepts_on_setup' || CASE WHEN r.seed THEN '-seed' ELSE '' END,
                           'seed', r.seed, 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_pending_accepts_on_setup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_profiles_complete_pending_accepts ON public.profiles;
CREATE TRIGGER trg_profiles_complete_pending_accepts
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.complete_pending_accepts_on_setup();

-- A pending accept goes when the offer moves on.
CREATE OR REPLACE FUNCTION public.clear_job_accept_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id
     OR NEW.helper_confirmed_at IS NOT NULL
     OR NEW.status::text <> 'accepted' THEN
    DELETE FROM public.job_accept_pending WHERE job_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_job_accept_pending() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_jobs_clear_accept_pending ON public.jobs;
CREATE TRIGGER trg_jobs_clear_accept_pending
  AFTER UPDATE OF helper_id, helper_confirmed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.clear_job_accept_pending();

-- Q1180: live body (20260520204909, md5(prosrc) 77d88013 on prod 2026-10-03)
-- + one predicate. Its "winner" was whoever accept_application put on the
-- job, which is now the Hire: a Helpr whose accept is still pending (or who
-- never tapped Accept) could close every other application, and each one was
-- told "not selected" (lh-authz-rls re-review R6). The winner is the Helpr
-- whose accept is complete; its last client caller, the PGRST202 fallback in
-- useOfferHandlers.ts, confirms first.
CREATE OR REPLACE FUNCTION public.reject_other_applications_on_accept(
  p_job_id uuid,
  p_accepted_application_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_is_winner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.id = p_accepted_application_id
      AND a.job_id = p_job_id
      AND a.helper_id = v_caller
      AND a.status = 'accepted'
      AND j.helper_id = v_caller
      AND j.helper_confirmed_at IS NOT NULL
  ) INTO v_caller_is_winner;

  IF NOT v_caller_is_winner THEN
    RAISE EXCEPTION 'caller is not the accepted helper for this job';
  END IF;

  UPDATE applications
  SET status = 'rejected', updated_at = now()
  WHERE job_id = p_job_id
    AND id <> p_accepted_application_id
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) TO authenticated;

-- Q1180: live body + the no-strike exemption.
CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
  v_no_strike boolean;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    SELECT j.id, j.title, j.customer_id, j.helper_id
      INTO v_locked
      FROM public.jobs j
     WHERE j.id = v_job.id
       AND j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
     FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT a.id INTO v_app_id
      FROM public.applications a
     WHERE a.job_id = v_locked.id
       AND a.helper_id = v_locked.helper_id
       AND a.status = 'accepted'
     LIMIT 1;

    -- ONE ladder for the whole reliability family — see
    -- apply_job_denial_consequence (20260824243000). The literal copy this
    -- replaced is exactly the drift hazard its own comment warned about.
    -- No strike while the Helpr's Stripe setup is unfinished, or after they
    -- tapped Accept and were still finishing it (owner, 2026-10-03: "it
    -- shouldn't hold up anything"; Q1180).
    v_no_strike := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                  WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);
    IF NOT v_no_strike THEN
      PERFORM public.apply_job_denial_consequence(
        v_locked.helper_id, v_locked.id,
        'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');
    END IF;

    IF v_app_id IS NOT NULL THEN
      UPDATE public.applications SET status = 'rejected' WHERE id = v_app_id;
    END IF;

    UPDATE public.jobs
       SET status = 'open',
           helper_id = NULL,
           response_deadline = NULL
     WHERE id = v_locked.id;

    -- Both sides are told, because both sides were waiting on this.
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.customer_id,
      'Offer expired — job reopened',
      'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_locked.id::text,
      v_locked.id
    );

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.helper_id,
      'You lost a job offer',
      'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
        || CASE WHEN v_no_strike
             THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
             ELSE '" and it went back to everyone. Letting an offer expire counts the same as declining it.'
           END,
      'expired',
      '/jobs?job=' || v_locked.id::text,
      v_locked.id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Q1180: live body + the no-strike exemption.
CREATE OR REPLACE FUNCTION public.decline_job_offer(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_customer uuid;
  v_job_status text;
  v_job_confirmed timestamptz;
  v_result jsonb;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title, j.customer_id, j.status::text, j.helper_confirmed_at
    INTO v_job_helper, v_job_title, v_customer, v_job_status, v_job_confirmed
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id), and still be an
  -- OFFER. Q1180: a confirmed booking is cancelled with helper_cancel_booking
  -- and a started job aborted with helper_abort_job, which clear the stamps
  -- and carry their own consequences; this decline reopened both with the
  -- stamps left behind (lh-authz-rls re-review 2026-10-03, R1-R3).
  IF v_job_helper IS DISTINCT FROM auth.uid()
     OR v_job_status IS DISTINCT FROM 'accepted'
     OR v_job_confirmed IS NOT NULL THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  -- No strike while the Helpr's Stripe setup is unfinished, or after they
  -- tapped Accept and were still finishing it (owner, 2026-10-03; Q1180).
  IF public.helper_accept_block_reason(v_app_helper) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                 WHERE p.job_id = v_job_id AND p.helper_id = v_app_helper) THEN
    v_result := jsonb_build_object('action', 'none', 'reason', 'setup_unfinished');
  ELSE
    v_result := public.apply_job_denial_consequence(
      v_app_helper, v_job_id,
      'Declined job offer: "' || COALESCE(v_job_title, 'Unknown') || '"');
  END IF;

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  -- ADDED 2026-09-05. Written HERE, in the same transaction as the reopen,
  -- rather than from the client: the client's own admin fan-out for this event
  -- is structurally dead (RLS), and the notifications INSERT policy is
  -- admin/service-role only, so an ordinary helper's browser cannot write this
  -- row at all. A SECURITY DEFINER RPC is the only seat that can.
  -- customer_id is nullable (account deletion anonymises rather than deletes),
  -- and notifications.user_id is NOT NULL — so guard it rather than throwing
  -- inside a decline that has otherwise already succeeded.
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_customer,
      'Offer declined — job reopened',
      'Your Helpr turned down "' || COALESCE(v_job_title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_job_id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Q1180: live body + GUARD -1 and the full reopen.
CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_arrived_at timestamptz;
  v_helper_completed_at timestamptz;
  v_near_miss_at timestamptz;
  v_confirmed_at timestamptz;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_arrived_at, j.helper_completed_at, j.helper_arrival_near_miss_at, j.helper_confirmed_at
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_arrived_at, v_helper_completed_at, v_near_miss_at, v_confirmed_at
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD -1 (Q1180, lh-authz-rls review 2026-10-03): a Helpr who never
  -- accepted the offer cannot have failed to show for it. Since 20261003193541
  -- an offer can sit unaccepted while the Helpr finishes Stripe setup.
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_never_accepted'
      USING HINT = 'This Helpr never accepted the offer, so it cannot be a no-show. You can pick someone else from your applicants.';
  END IF;

  -- GUARD 0 (20260915044137, VN-33) — a Helpr who ARRIVED did not no-show.
  -- Since that migration an arrival exists only when the server found the
  -- Helpr within 500ft, and a reopen clears the arrival stamps
  -- (zz_jobs_arrival_integrity) — so a no-show report after an arrival would
  -- both strike a Helpr who was there AND erase the evidence that they were.
  -- The app already hides No-Show once helper_arrived_at is stamped; this is
  -- the same rule on the server. A completed Helpr is refused for the same
  -- reason, and because reopening would hand their completion to the next one.
  IF v_arrived_at IS NOT NULL OR v_helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_arrived'
      USING HINT = 'The Helpr marked arrived on this job, so it cannot be reported as a no-show.';
  END IF;

  -- GUARD 0b (20260915074058, VN-33(b)) — a Helpr whose location was recorded
  -- within a mile of the pin in the last 12 hours may be at the real door of a
  -- wrong pin. The reopen below would strike them AND clear the near-miss
  -- record (zz_jobs_arrival_integrity), erasing the only evidence they came.
  -- The poster confirms the arrival or asks support; after 12 hours, with no
  -- confirmation, the report is allowed again.
  IF v_near_miss_at IS NOT NULL AND v_near_miss_at > now() - interval '12 hours' THEN
    RAISE EXCEPTION 'helper_near_miss_pending'
      USING HINT = 'Your Helpr checked in near the job, a little way from its map pin. If they are there, tap Confirm They Arrived; if not, contact support.';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job PER HELPR (DH-006). A no-show reopens the
  -- job and the poster may hire someone else; if that second Helpr also fails
  -- to show, they are a different person and must be reportable. The guard was
  -- job-wide, so the second no-show was refused with a message about the first.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
      AND user_id = v_helper_id  -- DH-006 per-Helpr guard
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never reach the top rung.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  -- The ladder itself is no longer written here. Same core, same policy switch
  -- as the other three wrappers: 'permanent' + p_permanent_requires_review
  -- becomes 'review' — a reversible 7-day restriction plus an admin case.
  v_result := public.apply_consequence_ladder(
    p_user                      => v_helper_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    -- No Helpr-facing copy from the core: the client already sends exactly one
    -- notification for this event (see the header). Casts are required —
    -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept verbatim from the
    -- old direct-ban path so that path stays fully specified if the policy is
    -- ever revisited.
    p_ban_reason                => 'Repeated no-show violations'
  );

  -- ATTRIBUTION. The shared core does not know about `reported_by` — it is a
  -- column only the no-show ladder uses, and it is load-bearing: GUARD 3b
  -- counts DISTINCT reporters, and count(DISTINCT reported_by) ignores NULLs,
  -- so an unstamped row would make every future no-show look like a first
  -- offence and the ladder would never escalate at all. GUARD 3a proved above
  -- that this job had NO no_show row for this Helpr before the core inserted one, so this
  -- matches exactly the row just written.
  UPDATE public.user_violations
     SET reported_by = auth.uid()
   WHERE job_id = p_job_id
     AND violation_type = 'no_show'
     AND user_id = v_helper_id  -- DH-006 this Helpr's row only
     AND reported_by IS NULL;

  -- Reopen the job so the poster can pick another applicant.
  -- Every stamp of the departed Helpr's booking goes with them (as
  -- helper_cancel_booking does): a confirmation left behind made the next
  -- Hire read as an already-accepted re-save (Q1180 review F3).
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = p_job_id;

  -- Return shape unchanged: the core supplies {action, prior_count}, and the
  -- two fields the client reads for its own notifications are merged back on.
  RETURN v_result || jsonb_build_object(
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

-- Q1180: live body + one narrow escape for report_helper_no_show's reopen.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    -- Added 20260915044137 (VN-33). The Helpr arrival stamps are written
    -- only by mark_helper_arrival (helper) and reset by
    -- zz_jobs_arrival_integrity (which sorts after this trigger). A poster
    -- writing the GPS half would satisfy half of the arrival rule for them.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    -- VN-33(b): server-owned near-miss record. A poster writing it would make
    -- their own confirmation count without the Helpr ever being near.
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft',
    -- ADDED 20260925231810 (Q423). The Helpr's own acceptance and day-of
    -- confirmation. poster_cancel_job charges a late-cancel fee (and strikes
    -- the poster) only while helper_confirmed_at is set, so a poster who
    -- cleared it cancelled late for $0. No poster path writes either.
    'helper_confirmed_at',
    'helper_dayof_confirmed_at'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  -- ADDED 20260925231810 (Q423). The fee's clock: hours until
  -- date_needed + start_time. Moving it past 24h before cancelling took the
  -- fee to $0. Free to change while nobody is booked.
  locked_when_booked CONSTANT text[] := ARRAY[
    'date_needed',
    'start_time'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      -- ADDED 20261003193541 (Q1180). report_helper_no_show's reopen clears
      -- the departed Helpr's acceptance stamps together with the unassign.
      -- Same flag and the same narrowness as the helper_id unassign below:
      -- the trusted ladder write, these two columns, cleared to NULL, in the
      -- UPDATE that sets helper_id NULL. A stamp left behind made the next
      -- Hire read as an already-accepted re-save (lh-authz-rls review F3).
      IF changed_col IN ('helper_confirmed_at', 'helper_dayof_confirmed_at')
         AND (CASE changed_col WHEN 'helper_confirmed_at' THEN NEW.helper_confirmed_at
                               ELSE NEW.helper_dayof_confirmed_at END) IS NULL
         AND NEW.helper_id IS NULL AND OLD.helper_id IS NOT NULL
         AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  -- Q423: once a Helpr is booked (a single job's helper_id, or a crew roster
  -- row naming a Helpr) the schedule is the fee's clock.
  IF OLD.helper_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL) THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_booked) THEN
        -- ADDED 20260927012809 (Q407 (8)): a new date / start time the Helpr
        -- ASKED for and this poster ACCEPTED. Its only writer is
        -- respond_job_schedule_change (20260927012807), which sets this
        -- transaction-local flag only after checking that the caller is the
        -- party the request is addressed to and the request is still live,
        -- and clears it right after its one UPDATE. Only the schedule columns
        -- pass; locked_always and locked_when_funded above still apply.
        IF current_setting('app.schedule_change_rpc', true) = '1' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not move jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
          USING ERRCODE = '42501',
                HINT = 'A booked Helpr planned around this time. Message them, or cancel and post the job again for the new time.';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
