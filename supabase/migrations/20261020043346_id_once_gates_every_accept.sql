-- ID ONCE, AT EVERY ACCEPT (owner, 2026-10-20: "it's required but only once
-- they are offered and accept a job"). A Helpr's ID is judged at the moment
-- they accept, by ONE helper, public.helper_accept_block_reason (payout setup
-- and the one identity rule, identity_is_verified, 20261019051407), on every
-- path by which a Helpr becomes booked. The poster's offer stays ungated
-- (accept_application, accept_group_application, book_accepted_quote): an
-- offer is not a booking, and the Helpr's accept that follows it is judged.
--
-- Measured live 2026-10-20 (pg_get_functiondef, md5(prosrc) of every body
-- below equal to its newest migration): the single-job accept
-- (accept_job_offer, respond_to_direct_offer, quote_job_funded_hires_quoter,
-- complete_pending_accepts_on_setup, and jobs_award_gate on every
-- helper_confirmed_at stamp from a user session) already read the helper.
-- Three paths did not:
--   * CREW: rpc_group_member_confirm and complete_pending_crew_confirms_on_setup
--     read helper_award_block_reason (payout setup ONLY), so an unverified
--     crew member's Accept My Spot booked them. Now the shared helper; the
--     recorded Confirm answers what is missing (helper_accept_missing) and
--     completes when both are done (the profiles trigger also fires on the
--     identity columns now).
--   * SERIES: claim_series_dates recorded holds on future dates with no
--     readiness read, and charge-recurring-visits books a hold in server
--     context (jobs_award_gate skips server context). Future dates stay
--     accept-first (owner 2026-10-06, 20261007011530: "should also be set this
--     way for recurring"); the answer now names what is missing, a vacated
--     visit (booked on the spot) is answered needs_setup instead of aborting
--     the claim, and charge-recurring-visits decides at booking time (an
--     unready holder's due dates are released with a notice, never booked).
--   * complete_direct_offer_accept trusted its callers; it now asks the helper
--     itself (defence in depth; every caller already did).
--   * the helper's own test-account carve-out read is_seed alone, which any
--     fixture-shaped signup email sets; it now also needs test_accounts
--     membership (section 0 below).
--
-- Bodies are the live ones with only the marked edits. Replay-safe: CREATE OR
-- REPLACE, the trigger dropped and recreated, grants restated as on prod.
-- Guard: src/test/everyAcceptReadsTheIdHelper.test.ts. Proof:
-- src/test/pglite/idOnceEveryAccept.pglite.mjs (3x replay).

-- (0) THE HELPER'S TEST-ACCOUNT CARVE-OUT (lh-authz-rls review, 2026-10-20,
-- finding 1). helper_accept_missing answered "nothing missing" for ANY
-- is_seed profile with no Stripe account, and is_seed is set at signup for any
-- fixture-shaped email (profiles_seed_from_fixture_email: @mailinator.com,
-- @helpr.test, eli.test.* on any domain), so a stranger signing up with such an
-- address skipped the ID at every accept. The carve-out now also needs the
-- account to be enrolled in public.test_accounts (service_role-only writes, no
-- function enrols anyone), the membership seed_hidden_for already requires.
-- Measured 2026-10-20: every shared CI account is enrolled; 2 is_seed profiles
-- with no Stripe account are not, and are judged like anyone else from now on.
CREATE OR REPLACE FUNCTION public.helper_accept_missing(p_user_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p.user_id IS NULL THEN ARRAY['unknown']
           -- Fixture data stays usable while fixture-shaped AND an enrolled test
           -- account (seed_hidden_for's membership rule).
           WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[]
           ELSE array_remove(ARRAY[
             CASE WHEN p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE THEN 'payout_setup' END,
             CASE WHEN NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END
           ], NULL)
         END
    FROM (SELECT p_user_id AS uid) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid;
$fn$;

REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_accept_missing(uuid) TO service_role;

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
  v_reason text;
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

  -- Payouts or ID not ready: the Confirm is RECORDED and completes when both
  -- are (complete_pending_crew_confirms_on_setup), as a single job's Accept
  -- does (accept_job_offer's pending_setup), judged by the SAME helper
  -- (helper_accept_block_reason: payout setup AND the one identity rule;
  -- owner 2026-10-20, ID once at the accept). A spot already confirmed stays
  -- confirmed.
  IF v_row.helper_confirmed_at IS NULL THEN
    v_reason := public.helper_accept_block_reason(v_uid);
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.crew_confirm_pending (slot_id, job_id, helper_id)
      VALUES (v_slot, _job_id, v_uid)
      ON CONFLICT (slot_id) DO NOTHING;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(v_uid)));
    END IF;
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
  -- Payout setup AND the identity rule, the one helper every accept reads.
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
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
          'Your setup is done, so your spot on "' || COALESCE(r.title, 'the job') || '" is confirmed.',
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
      -- seed-policy: no seed branch needed: a seed Helpr is never setup-blocked
      -- (helper_accept_missing's fixture carve-out), so a seed account never
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

-- The recorded crew Confirm now also waits on the ID, so the trigger fires on
-- the identity verdict columns too (complete_pending_accepts_on_setup's list).
DROP TRIGGER IF EXISTS trg_profiles_complete_pending_crew_confirms ON public.profiles;
CREATE TRIGGER trg_profiles_complete_pending_crew_confirms
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public.profiles
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
  v_needs_setup date[] := ARRAY[]::date[];
  v_block text;
  v_holder uuid;
  v_name text;
  v_list text;
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
  -- ID once (owner 2026-10-20): the claimer's readiness, from the one helper
  -- every accept reads. A future date stays accept-first (the hold records the
  -- yes; charge-recurring-visits books it only for a ready holder and
  -- otherwise releases it with a notice). A vacated visit is booked on the
  -- spot below, so an unready claimer is never put on it: that date is
  -- answered needs_setup, and the answer names what is missing.
  v_block := public.helper_accept_block_reason(v_uid);
  IF v_block = 'helper_unknown' THEN
    RAISE EXCEPTION 'helper_unknown';
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
    IF v_child_id IS NOT NULL AND v_block IS NOT NULL THEN
      v_needs_setup := v_needs_setup || v_d;
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
        -- Q1214 (2): this UPDATE is the claimer's accept of the vacated
        -- visit, so jobs_award_gate lets it confirm (app.accept_rpc), as
        -- complete_job_accept does. On for this one statement only.
        PERFORM set_config('app.accept_rpc', '1', true);
        UPDATE public.jobs
           SET helper_id = v_uid,
               status = 'accepted',
               helper_confirmed_at = now()
         WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;
        PERFORM set_config('app.accept_rpc', '0', true);
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
                            'already_yours', to_jsonb(v_already), 'needs_setup', to_jsonb(v_needs_setup),
                            'missing', CASE WHEN v_block IS NULL THEN '[]'::jsonb
                                            ELSE to_jsonb(public.helper_accept_missing(v_uid)) END);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_series_dates(uuid, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_series_dates(uuid, date[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_customer uuid;
  v_app_id   uuid;
BEGIN
  -- Locked here too (both callers already hold it; re-taking it is free), so
  -- this function is race-safe on its own reading (scripts/check-race-class.mjs).
  SELECT j.customer_id INTO v_customer FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF public.are_users_blocked(p_helper, v_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  -- Everything else the applications gates would have refused in a user
  -- session, checked here because this runs in a server context too.
  IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- ID once (owner 2026-10-20): payout setup and the identity rule, from the
  -- one helper every accept reads. Every caller already asked it
  -- (respond_to_direct_offer, quote_job_funded_hires_quoter,
  -- complete_pending_accepts_on_setup); asked again here so no future caller
  -- can book an unready Helpr through this completion.
  IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- The real applications row the synthetic 'direct-<id>' card stood in for.
  -- ON CONFLICT covers a Helpr who also applied before the offer landed.
  INSERT INTO public.applications (job_id, helper_id, message, status)
  VALUES (p_job_id, p_helper, NULL, 'accepted')
  ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
  RETURNING id INTO v_app_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = p_helper,
         direct_offer_status = 'accepted',
         response_deadline = NULL,
         direct_offer_expires_at = NULL
   WHERE id = p_job_id
     AND status = 'open'
     AND helper_id IS NULL
     AND offered_to_helper_id = p_helper
     AND direct_offer_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_active';  -- undoes the applications row above
  END IF;

  IF NOT public.complete_job_accept(p_job_id) THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) TO service_role;
