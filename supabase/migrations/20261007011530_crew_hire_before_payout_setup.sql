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
-- RECURRING, the same rule (owner, 2026-10-06: "should also be set this way
-- for recurring"): claim_series_dates' pick-up of a vacated, already-funded
-- visit wrote helper_confirmed_at, so jobs_award_gate refused the whole claim
-- for a Helpr without payouts. Now an unready Helpr's pick-up makes the visit
-- theirs unconfirmed and records the accept in job_accept_pending, which
-- complete_pending_accepts_on_setup already completes (its "a Hire's offer"
-- branch: status accepted, helper_id theirs). The claim answers the date under
-- `pending_setup`. Dates not yet created were never gated (a hold row only).
-- A picked-up visit that is reopened while still unconfirmed (declined,
-- expired at its start, or swept) gives its date back to the series
-- (release_series_hold_on_reopen): without that the picker's hold stayed, so
-- every other Helpr's claim answered `taken` and the funded date was stranded
-- (lh-money-escrow review of this migration, MEDIUM).
--
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
          SELECT COALESCE(NULLIF(btrim(pp.full_name), ''), 'A Helpr') INTO v_name
            FROM public.profiles pp WHERE pp.user_id = NEW.user_id;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            r.customer_id,
            COALESCE(v_name, 'A Helpr') || ' confirmed their spot',
            COALESCE(v_name, 'A Helpr') || ' confirmed their spot on "' || COALESCE(r.title, 'your job') || '".',
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

CREATE OR REPLACE FUNCTION public.claim_series_dates(p_job_id uuid, p_dates date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_offered boolean;
  v_on_series boolean;
  v_d date;
  v_releaser uuid;
  v_child_id uuid;
  v_child_status text;
  v_child_helper uuid;
  v_child_start time;
  v_min_fundable date;
  v_claimed date[] := ARRAY[]::date[];
  v_taken date[] := ARRAY[]::date[];
  v_refused date[] := ARRAY[]::date[];
  v_already date[] := ARRAY[]::date[];
  v_holder uuid;
  v_name text;
  v_list text;
  v_ready boolean;
  v_pending date[] := ARRAY[]::date[];
  v_cutoff timestamptz;
  v_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Authz review LOW: a non-party is refused before the row lock, and with one
  -- answer, so it can neither hold the series' lock nor probe which ids exist.
  IF NOT public.is_series_party(p_job_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- One claim at a time per series: first to commit wins every contested date.
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.recurring_helper_id, j.recurrence_days,
         j.recurrence_weeks, j.parent_job_id, j.date_needed, j.series_ended_on, j.status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.recurrence_days IS NULL OR v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_series';
  END IF;
  IF v_job.status::text = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'series_ended';
  END IF;
  IF v_uid = v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_offered := EXISTS (SELECT 1 FROM public.series_date_offers o
                        WHERE o.parent_job_id = v_job.id AND o.helper_id = v_uid)
               OR (v_job.recurring_helper_id = v_uid AND v_job.helper_id = v_uid);
  v_on_series := v_offered OR EXISTS (
    SELECT 1 FROM public.series_visit_holds h
     WHERE h.parent_job_id = v_job.id AND h.helper_id = v_uid AND h.visit_date >= v_today);
  IF NOT v_on_series THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.are_users_blocked(v_job.customer_id, v_uid) THEN
    RAISE EXCEPTION 'applicant_blocked';
  END IF;

  -- The earliest uncreated date a future charge-recurring-visits run can still
  -- fund (see the check in the loop). Deliberately UTC, not Chicago
  -- (scheduling review LOW-2): it models the cron's own clock (06:06 UTC,
  -- funding dates strictly after its UTC run date), so both sides of the
  -- comparison are in the cron's frame. v_today above stays Chicago.
  v_min_fundable := (now() AT TIME ZONE 'UTC')::date
                    + (CASE WHEN (now() AT TIME ZONE 'UTC')::time < '05:30'::time THEN 1 ELSE 2 END);

  FOREACH v_d IN ARRAY (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::date[]) FROM unnest(p_dates) AS x)
  LOOP
    IF v_d <= v_job.date_needed
       OR NOT EXISTS (SELECT 1 FROM public.series_visit_dates(v_job.date_needed, v_job.recurrence_days, v_job.recurrence_weeks) AS s
                       WHERE s = v_d) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    v_child_id := NULL;
    SELECT c.id, c.status::text, c.helper_id, c.start_time
      INTO v_child_id, v_child_status, v_child_helper, v_child_start
      FROM public.jobs c
     WHERE c.parent_job_id = v_job.id AND c.date_needed = v_d
     FOR UPDATE;
    -- Scheduling review MEDIUM-2: the past is judged by the visit's own local
    -- start, not by the calendar day. A visit vacated this morning for a 5pm
    -- start can still be picked up today; one whose start has passed cannot.
    -- A date with no visit row yet needs a day of lead time (fundability
    -- below), so today is always too late for it.
    IF (v_child_id IS NULL AND v_d <= v_today)
       OR (v_child_id IS NOT NULL AND v_child_status = 'open' AND v_child_helper IS NULL
           AND ((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now()) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    IF v_child_id IS NOT NULL
       AND NOT (v_child_status = 'open' AND v_child_helper IS NULL
                AND ((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago') > now()) THEN
      -- Review LOW-6: a double tap is not "taken" when the visit is yours.
      IF v_child_helper = v_uid THEN
        v_already := v_already || v_d;
      ELSE
        v_taken := v_taken || v_d;
      END IF;
      CONTINUE;
    END IF;
    -- An uncreated date must still be fundable: charge-recurring-visits runs
    -- daily at 06:06 UTC and funds dates strictly after its run date, so a
    -- date claimed after the last run that could fund it would be held and
    -- never booked (money audit 2026-09-25). 05:30 leaves the run its margin.
    IF v_child_id IS NULL
       AND v_d < v_min_fundable THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    -- Someone already holds it (the other claimer of a race committed first):
    -- `taken`, before the pick-up rule below reads the release row that claim
    -- just deleted.
    v_holder := NULL;
    SELECT h.helper_id INTO v_holder
      FROM public.series_visit_holds h WHERE h.parent_job_id = v_job.id AND h.visit_date = v_d;
    IF v_holder IS NOT NULL THEN
      -- Review LOW-6: the caller's own date (a double tap) is already_yours.
      IF v_holder = v_uid THEN
        v_already := v_already || v_d;
      ELSE
        v_taken := v_taken || v_d;
      END IF;
      CONTINUE;
    END IF;
    v_releaser := NULL;
    SELECT r.helper_id INTO v_releaser
      FROM public.recurring_visit_releases r
     WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
    -- The one who gave a date up does not take it back; a Helpr on the series
    -- without an offer picks up only a date someone gave up.
    IF v_releaser = v_uid OR (NOT v_offered AND v_releaser IS NULL) THEN
      v_refused := v_refused || v_d;
      CONTINUE;
    END IF;
    INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id)
    VALUES (v_job.id, v_d, v_uid)
    ON CONFLICT (parent_job_id, visit_date) DO NOTHING;
    IF FOUND THEN
      v_claimed := v_claimed || v_d;
      DELETE FROM public.recurring_visit_releases r
       WHERE r.parent_job_id = v_job.id AND r.visit_date = v_d;
      -- A vacated visit is already funded: the claimer takes over that row
      -- (its escrow and payout follow helper_id), never a public reopening.
      IF v_child_id IS NOT NULL THEN
        -- Anyone can pick a visit up; payout setup comes after (owner,
        -- 2026-10-06, 20261007011530). Payouts ready: the pick-up is the
        -- accept, as before. Not ready: the visit is theirs, unconfirmed, and
        -- the accept is RECORDED (job_accept_pending) and completes when Stripe
        -- reports payouts ready (complete_pending_accepts_on_setup, the same
        -- path as a single job's Accept). Its answer-by time is the offer
        -- cutoff before the visit's start, so unconfirmed then, expire_unanswered_offers reopens it
        -- (complete_job_accept refuses after that time); a reopened visit
        -- releases the date (trg_release_series_hold_on_reopen, below).
        v_ready := public.helper_accept_block_reason(v_uid) IS NULL;
        -- An unready pick-up answers by the offer cutoff (job_offer_cutoff,
        -- the bound every offer deadline uses); a ready one is confirmed now.
        v_cutoff := public.job_offer_cutoff(v_d, v_child_start);
        IF v_ready THEN
          v_deadline := NULL;
        ELSE
          v_deadline := LEAST((v_d + COALESCE(v_child_start, '00:00'::time)) AT TIME ZONE 'America/Chicago', v_cutoff);
        END IF;
        UPDATE public.jobs
           SET helper_id = v_uid,
               status = 'accepted',
               helper_confirmed_at = CASE WHEN v_ready THEN now() END,
               response_deadline = v_deadline
         WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;
        IF FOUND AND NOT v_ready THEN
          INSERT INTO public.job_accept_pending (job_id, helper_id)
          VALUES (v_child_id, v_uid)
          ON CONFLICT (job_id) DO UPDATE SET helper_id = EXCLUDED.helper_id, requested_at = now();
          v_pending := v_pending || v_d;
        END IF;
        -- enforce_application_job_state (C11) lets this one row through: the
        -- visit is 'accepted' by now. The flag is local to this INSERT.
        PERFORM set_config('app.series_claim_rpc', '1', true);
        INSERT INTO public.applications (job_id, helper_id, status, message)
        VALUES (v_child_id, v_uid, 'accepted', NULL)
        ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted';
        PERFORM set_config('app.series_claim_rpc', '0', true);
      END IF;
    ELSE
      v_taken := v_taken || v_d;
    END IF;
  END LOOP;

  IF cardinality(v_claimed) > 0 AND v_job.customer_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.full_name), '') INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_claimed) AS d;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (v_job.customer_id, v_job.id,
            CASE WHEN cardinality(v_claimed) = 1 THEN 'A visit date was picked up' ELSE 'Visit dates were picked up' END,
            format('%s took %s on "%s".', COALESCE(v_name, 'A Helpr'), v_list, COALESCE(v_job.title, 'your series')),
            'job_updates', '/posts?job=' || v_job.id::text);
  END IF;

  RETURN jsonb_build_object('claimed', to_jsonb(v_claimed), 'taken', to_jsonb(v_taken), 'refused', to_jsonb(v_refused),
                            'already_yours', to_jsonb(v_already),
                            -- picked up, confirmed once payouts are set up
                            'pending_setup', to_jsonb(v_pending));
END;
$function$
;

REVOKE ALL ON FUNCTION public.claim_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_series_dates(uuid, date[]) TO authenticated, service_role;

-- A series visit reopened while UNCONFIRMED (the pending pick-up above, the
-- only way a series visit is ever accepted without a confirmation) releases
-- its date: series_release_dates deletes that Helpr's hold and writes the
-- release row, so the next Helpr on the series can take the visit. A booked
-- (confirmed) visit is untouched here: helper_cancel_booking and
-- give_up_series_dates release those themselves, with their own rules.
CREATE OR REPLACE FUNCTION public.release_series_hold_on_reopen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent record;
BEGIN
  SELECT p.title, p.customer_id INTO v_parent FROM public.jobs p WHERE p.id = NEW.parent_job_id;
  PERFORM public.series_release_dates(NEW.parent_job_id, OLD.helper_id, ARRAY[NEW.date_needed],
                                      'unconfirmed pick-up reopened', v_parent.title, v_parent.customer_id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_series_hold_on_reopen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_series_hold_on_reopen() TO service_role;

DROP TRIGGER IF EXISTS trg_release_series_hold_on_reopen ON public.jobs;
CREATE TRIGGER trg_release_series_hold_on_reopen
  AFTER UPDATE OF helper_id ON public.jobs
  FOR EACH ROW
  WHEN (NEW.parent_job_id IS NOT NULL AND OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
        AND OLD.helper_confirmed_at IS NULL)
  EXECUTE FUNCTION public.release_series_hold_on_reopen();
