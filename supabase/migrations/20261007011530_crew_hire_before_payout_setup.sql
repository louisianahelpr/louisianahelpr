-- A crew hire is an OFFER, like a single job's Hire, and anyone can be offered
-- one: the Helpr sets up payouts after accepting (owner, 2026-10-06: "you can
-- offer job to anyone, they would set it up after accepting. this is not an
-- exception, it's the rule").
--
-- Before: group_job_helpers_award_gate refused the roster INSERT when the Helpr
-- had no payout account (helper_award_block_reason), so accept_group_application
-- raised helper_payout_setup_incomplete and a poster could not hire a crew
-- member who had not finished Stripe setup (measured live 2026-10-07 01:05Z on
-- the owner's crew job: both hires refused). A single job never worked that
-- way: its Hire is an offer, and the Helpr's Accept is RECORDED and completes by
-- itself once Stripe reports payouts ready (job_accept_pending +
-- complete_pending_accepts_on_setup, 20261003193541, Q1180).
--
-- Now, the same rule for a crew:
--   * the hire lands whatever the Helpr's Stripe state (the roster row's
--     funding check stays exactly as it was);
--   * the member's Confirm (rpc_group_member_confirm) with payouts not ready
--     is RECORDED in crew_confirm_pending and answers
--     {action: 'pending_setup', missing: ['payout_setup']} (accept_job_offer's
--     shape), so the app opens the Set Up Payouts pop-up;
--   * when Stripe reports the payout account ready, the profiles trigger
--     complete_pending_crew_confirms_on_setup stamps every recorded Confirm on a
--     spot that is still theirs on a live job, and tells the Helpr.
-- Nothing is worked or paid without a payout account: on-the-way, arrival and
-- done all need a confirmed spot (helper_not_confirmed); an unconfirmed spot
-- expires at the start with no fee (expire_unanswered_offers); an under-filled
-- crew starts with CONFIRMED members only (start_underfilled_crews, Q1460).
--
-- RECURRING: future series dates were already accept-first (claiming one only
-- records a hold; charge-recurring-visits books it later), so nothing changes
-- there. Taking over an already-created VACATED visit stays gated on payouts:
-- that path writes the visit's confirmation as the Helpr, and the Helpr column
-- whitelist refuses the answer-by time a pending pick-up would need (lead,
-- 2026-10-07, measured against the live enforce_helper_jobs_column_whitelist).

-- crew_confirm_pending is server-only: RLS on, no policies, no client grants.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE; triggers dropped and
-- recreated; grants restated as they are on prod.

CREATE TABLE IF NOT EXISTS public.crew_confirm_pending (
  slot_id      uuid PRIMARY KEY REFERENCES public.group_job_helpers(id) ON DELETE CASCADE,
  job_id       uuid NOT NULL,
  helper_id    uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_confirm_pending_helper_idx ON public.crew_confirm_pending (helper_id);
ALTER TABLE public.crew_confirm_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_confirm_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crew_confirm_pending TO service_role;
-- Every public table carries the unconfirmed-email write gate (db-smoke).
DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_group_roster_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment text;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- The funding gate (enforce_job_funded_before_award) used to judge a crew
  -- through the first hire's jobs.helper_id write. A crew has no lead now, so
  -- it is judged here, on every member: same predicate, same message.
  -- FOR SHARE: a refund or cancel_escrow claim cannot move the job out of
  -- funding between this read and the roster row landing. accept_group_application
  -- already holds the row FOR UPDATE, so this adds no wait on the hire path.
  SELECT j.payment_status INTO v_payment FROM public.jobs j WHERE j.id = NEW.job_id FOR SHARE;
  IF NOT public.job_payment_is_funded(v_payment) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released before a crew member is added. See enforce_group_roster_award_gate().';
  END IF;
  -- The Helpr's payout setup is NOT judged at the hire: a crew hire is an
  -- offer, and the member's Confirm waits on it (rpc_group_member_confirm,
  -- 20261007011530).
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_group_roster_award_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_group_roster_award_gate() TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_group_member_confirm(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text INTO v_status FROM public.jobs j WHERE j.id = _job_id;

  -- `in_progress` is admitted here and is NOT admitted by the single-helper
  -- `enforce_confirm_on_live_job`, on purpose. `jobs.status` on a crew job is a
  -- CREW-WIDE aggregate: the first member to set out flips it to in_progress
  -- (rpc_group_member_on_the_way, below). Judging a member's own confirmation
  -- against it would mean a slower crew member is locked out of confirming
  -- their slot by a colleague's departure — the same class of deadlock the
  -- 2026-09-19 arrival reversal removed. A member's confirmation is judged
  -- against their OWN slot; the job only has to still be live.
  IF v_status IS NULL OR v_status NOT IN ('open', 'accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_confirmable' USING ERRCODE = '23514',
      HINT = 'This job is no longer live (status=' || COALESCE(v_status, 'null') || ').';
  END IF;

  -- Payouts not ready: the Confirm is RECORDED and completes when Stripe says
  -- they are (complete_pending_crew_confirms_on_setup), as a single job's
  -- Accept does (accept_job_offer's pending_setup). A spot already confirmed
  -- stays confirmed.
  IF v_row.helper_confirmed_at IS NULL
     AND public.helper_award_block_reason(v_uid) IS NOT NULL THEN
    INSERT INTO public.crew_confirm_pending (slot_id, job_id, helper_id)
    VALUES (v_slot, _job_id, v_uid)
    ON CONFLICT (slot_id) DO NOTHING;
    RETURN jsonb_build_object('action', 'pending_setup', 'missing', jsonb_build_array('payout_setup'));
  END IF;

  UPDATE public.group_job_helpers
     SET helper_confirmed_at = COALESCE(helper_confirmed_at, v_now)
   WHERE id = v_slot
   RETURNING helper_confirmed_at INTO v_stamp;

  RETURN jsonb_build_object('helper_confirmed_at', v_stamp);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_group_member_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_group_member_confirm(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_pending_crew_confirms_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crew_confirm_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  IF public.helper_award_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force completes nothing (complete_pending_accepts_on_setup's
  -- predicate); the recorded Confirm waits.
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT p.slot_id, p.job_id, j.title, j.customer_id, g.helper_id = NEW.user_id AS still_theirs,
           j.status::text IN ('open', 'accepted', 'in_progress') AS live,
           g.helper_confirmed_at
      FROM public.crew_confirm_pending p
      JOIN public.group_job_helpers g ON g.id = p.slot_id
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
     ORDER BY p.requested_at
       FOR UPDATE OF g
  LOOP
    BEGIN
      IF r.still_theirs AND r.live AND r.helper_confirmed_at IS NULL THEN
        UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = r.slot_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your payout setup is done, so your spot on "' || COALESCE(r.title, 'the job') || '" is confirmed.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
        -- The poster hears it as from any member's Confirm-after-setup, as a
        -- single job's completed accept tells them (complete_job_accept).
        IF r.customer_id IS NOT NULL THEN
          SELECT COALESCE(NULLIF(btrim(pp.full_name), ''), 'Someone') INTO v_name
            FROM public.profiles pp WHERE pp.user_id = NEW.user_id;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            r.customer_id,
            COALESCE(v_name, 'Someone') || ' confirmed their spot',
            COALESCE(v_name, 'Someone') || ' confirmed their spot on "' || COALESCE(r.title, 'your job') || '".',
            'job_updates',
            '/posts?job=' || r.job_id::text,
            r.job_id
          );
        END IF;
      END IF;
      DELETE FROM public.crew_confirm_pending WHERE slot_id = r.slot_id;
    EXCEPTION WHEN OTHERS THEN
      -- seed-policy: no seed branch needed: a seed Helpr is never payout-blocked
      -- (helper_award_block_reason's fixture carve-out), so a seed account never
      -- has a pending crew Confirm and never reaches this log.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        'pending crew confirm completion failed',
        jsonb_build_object('source', 'complete_pending_crew_confirms_on_setup', 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'slot_id', r.slot_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_pending_crew_confirms_on_setup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_crew_confirms_on_setup() TO service_role;

DROP TRIGGER IF EXISTS trg_profiles_complete_pending_crew_confirms ON public.profiles;
CREATE TRIGGER trg_profiles_complete_pending_crew_confirms
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.complete_pending_crew_confirms_on_setup();
