-- Q2292 HIGH: server-built notifications showed another member's FULL name.
--
-- Owner rule (2026-10-21): a member never sees another member's last name, only its first letter
-- ("Andre L."). The app already formats names with formatName (src/lib/utils.ts), but eight SQL
-- producers built notification text straight from profiles.full_name, so the bell, the push and the
-- email (both carry the notification's own title and message) said "Andre Landry has arrived".
-- Measured on prod 2026-10-21: 184 such member notifications in 30 days (transit_updates 56,
-- job_updates 55, new_offers 39, work_status 34) plus review and series/crew/access-note notices.
--
-- Fix:
--  1. public.member_display_name(full_name, fallback): the formatName rule in SQL (trim; no name ->
--     the fallback verbatim; one word -> that word; two or more -> first word + last word's initial
--     + '.'). One helper, so every producer says the same thing.
--  2. Every member-facing producer that named another member restated with that helper (the crew
--     confirm trigger is in 20261021062140_member_display_name_crew_confirm.sql, its own file so the
--     guards' @mutate find strings it shares with complete_pending_accepts_on_setup stay unique). Each body is
--     its effective definition copied verbatim (md5 of prosrc matched prod on 2026-10-21); only the
--     line that reads the name changes. Staff-only producers (admin fan-outs: consequence ladder,
--     low rating, report escalation, repeat offender, stuck payment, new member) keep full names:
--     admins see full names. A member's OWN name (notify_on_application's email greeting) and
--     first-name-only producers (nudge_confirm) and notify_message_recipient (already "First L.")
--     are unchanged; src/test/notificationNamesAreFirstAndInitial.test.ts lists each with its reason.
--  3. A one-time, idempotent backfill of the stored rows: every notification whose title or message
--     contains, as whole words, the full name of a member other than its recipient (and not the
--     recipient's own name, should two members share it) gets that name replaced by the member's display name. Staff rows (an admin recipient with an /admin link) keep
--     theirs. A name whose display form contains the full name ("Andre L") is skipped so a re-run can
--     never touch a row twice. Read-only/trigger guards on notifications only restrict members
--     (current_user authenticated/anon), never this migration.
--
-- REPLAY-SAFETY: every object the restated bodies call exists before this file in timestamp order;
-- CREATE OR REPLACE keeps each function's triggers and grants; the backfill is a no-op on a fresh
-- database and on a second run.

CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor')
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN v.t = '' THEN p_fallback
           WHEN array_length(v.parts, 1) > 1
             THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
           ELSE v.parts[1]
         END
    FROM (SELECT x.t, regexp_split_to_array(x.t, '\s+') AS parts
            FROM (SELECT regexp_replace(coalesce(p_full_name, ''), '^\s+|\s+$', '', 'g') AS t) x) v
$fn$;
REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_display_name(text, text) TO authenticated, service_role;

-- claim_series_dates: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
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
    SELECT public.member_display_name(p.full_name, NULL) INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
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

-- complete_job_accept: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.complete_job_accept(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job  record;
  v_name text;
  v_done boolean;
BEGIN
  -- Q1187: this UPDATE is the accept, so jobs_award_gate lets it confirm the
  -- job (app.accept_rpc). On for this one statement only: cleared before
  -- anything else runs, so no other write in the transaction inherits it.
  PERFORM set_config('app.accept_rpc', '1', true);
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
  -- FOUND before the PERFORM below, which would reset it.
  v_done := FOUND;
  PERFORM set_config('app.accept_rpc', '0', true);
  IF NOT v_done THEN
    RETURN false;
  END IF;

  -- The other applicants learn the spot is taken (reject_other_applications_on_accept's rule).
  UPDATE public.applications
     SET status = 'rejected', updated_at = now()
   WHERE job_id = p_job_id
     AND helper_id IS DISTINCT FROM v_job.helper_id
     AND status = 'pending';

  IF v_job.customer_id IS NOT NULL THEN
    SELECT public.member_display_name(p.full_name, 'Your Helpr') INTO v_name
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
-- Unchanged grants, stated so a replay reads them: service_role only (prod proacl 2026-10-21).
REVOKE ALL ON FUNCTION public.complete_job_accept(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_accept(uuid) TO service_role;

-- complete_pending_accepts_on_setup: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
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
           coalesce(j.is_seed OR NEW.is_seed, false) AS seed,
           (j.status = 'open') AS direct
      FROM public.job_accept_pending p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
       AND (  -- a Hire's offer (Q1180)
              (j.status = 'accepted' AND j.helper_id = p.helper_id)
              -- a direct offer still live and still this Helpr's (Q1185)
           OR (j.status = 'open' AND j.helper_id IS NULL
               AND j.offered_to_helper_id = p.helper_id
               AND j.direct_offer_status = 'pending'
               AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at >= now())
               -- anything that would refuse it now (a block, the date passing, a
               -- tier, a ban): completes nothing, logs nothing
               AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL))
     ORDER BY p.requested_at
       FOR UPDATE OF j
  LOOP
    -- One job that cannot complete never rolls back the Stripe status write
    -- this trigger runs inside (review #3; settle_one_off_jobs_for_banned_account's
    -- pattern): it is logged, and the rest still complete.
    BEGIN
      -- (parenthesised: plpgsql's IF reads its condition up to the first THEN)
      IF (CASE WHEN r.direct THEN public.complete_direct_offer_accept(r.job_id, NEW.user_id) IS NOT NULL
               ELSE public.complete_job_accept(r.job_id) END) THEN
        SELECT public.member_display_name(pp.full_name, 'the person who posted it') INTO v_poster
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

-- job_access_notes_changed: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.job_access_notes_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job      uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
  v_customer uuid;
  v_helper   uuid;
  v_series   uuid;
  v_status   text;
  v_title    text;
  v_visit    record;
  v_visits   uuid[] := '{}';
  v_visit_helprs uuid[] := '{}';
  v_poster_name text;
BEGIN
  IF current_setting('app.access_notes_server_write', true) = '1' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
    RETURN NULL;
  END IF;

  SELECT j.customer_id, j.helper_id, j.recurring_helper_id, j.status::text, j.title
    INTO v_customer, v_helper, v_series, v_status, v_title
    FROM public.jobs j WHERE j.id = v_job
     FOR SHARE;
  -- A job inserted in this same transaction by the legacy route trigger is
  -- not visible yet (NOT FOUND): it is new, so nobody is booked on it.
  IF NOT FOUND OR v_status IN ('completed', 'cancelled') THEN
    RETURN NULL;
  END IF;
  -- After the FOUND test above (this SELECT would reset it): the poster's
  -- name for the notice, never a role word.
  SELECT public.member_display_name(p.full_name, NULL) INTO v_poster_name FROM public.profiles p WHERE p.user_id = v_customer;

  -- The series' live visits (locked like the job) carry the same notes.
  FOR v_visit IN
    SELECT c.id, c.helper_id FROM public.jobs c
     WHERE c.parent_job_id = v_job AND c.status::text NOT IN ('completed', 'cancelled')
       FOR SHARE
  LOOP
    v_visits := v_visits || v_visit.id;
    v_visit_helprs := v_visit_helprs || v_visit.helper_id;
  END LOOP;
  PERFORM set_config('app.access_notes_server_write', '1', true);
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.job_access_notes n WHERE n.job_id = ANY (v_visits);
  ELSE
    INSERT INTO public.job_access_notes (job_id, notes)
    SELECT v.id, NEW.notes FROM unnest(v_visits) AS v(id)
    ON CONFLICT (job_id) DO UPDATE SET notes = EXCLUDED.notes;
  END IF;
  PERFORM set_config('app.access_notes_server_write', '', true);

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT DISTINCT r.uid,
         'Access notes updated',
         COALESCE(v_poster_name, 'The person who posted it') || ' updated the access and parking notes for "' || COALESCE(v_title, 'your job')
           || '". Open the job to see them before you go.',
         'job_updates',
         '/jobs?job=' || v_job::text,
         v_job
    FROM (
      SELECT v_helper AS uid
      UNION ALL SELECT v_series
      UNION ALL SELECT g.helper_id FROM public.group_job_helpers g WHERE g.job_id = v_job
      UNION ALL SELECT unnest(v_visit_helprs)
    ) r
   WHERE r.uid IS NOT NULL
     AND r.uid IS DISTINCT FROM v_customer
     -- One unread notice per Helpr per job per 10 minutes: a poster typing a
     -- few edits in a row does not flood them (lh-authz-rls re-review, should-fix).
     AND NOT EXISTS (SELECT 1 FROM public.notifications x
                      WHERE x.user_id = r.uid AND x.job_id = v_job
                        AND x.title = 'Access notes updated' AND NOT x.read
                        AND x.created_at > now() - interval '10 minutes');

  RETURN NULL;
END;
$fn$;

-- notify_helper_on_direct_offer: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     -- No notice for a job whose money has not arrived (owner, 2026-10-17).
     AND public.job_payment_is_funded(NEW.payment_status)
     -- Only a live job's offer is news (review #4: not a pending_approval or
     -- cancelled row).
     AND NEW.status::text = 'open'
     -- Money that arrives after the job's start cutoff cannot be answered in
     -- time: no notice about an offer nobody can accept (review #3).
     AND (NEW.date_needed IS NULL
          OR public.job_offer_cutoff(NEW.date_needed, NEW.start_time) > now())
     AND (
       TG_OP = 'INSERT'
       -- The money just arrived for the FIRST time: the notice that waited
       -- for it goes out now. "Never paid" is the set a job leaves only when
       -- money arrives (NULL, unpaid, abandoned, failed), NOT "anything not
       -- funded": escrow -> cancelling -> escrow (cancel_escrow putting a
       -- cancel claim back) is the same money, already announced (review #2).
       OR OLD.payment_status IS NULL
       OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed')
       -- A funded job's offer moved to a different Helpr.
       OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id
     )
     -- A job booked from an agreed quote, offered to its quoter: paying hires
     -- them (quote_job_funded_hires_quoter), which sends the one notice.
     AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id)
  THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- notify_poster_on_status_change: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_pref_in_app boolean;
  v_link text;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/posts?job=' || NEW.id::text;
  SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/posts?job=' || NEW.id::text;

  ELSE
    RETURN NEW;
  END IF;

  -- Check in-app pref for poster
  SELECT
    CASE v_category
      WHEN 'transit_updates' THEN COALESCE(transit_updates, true)
      WHEN 'work_status' THEN COALESCE(work_status, true)
      ELSE true
    END INTO v_pref_in_app
  FROM public.notification_preferences WHERE user_id = NEW.customer_id;

  IF COALESCE(v_pref_in_app, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);
  ELSE
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'skipped', v_title, NEW.id, 'preference_off');
  END IF;

  RETURN NEW;
END;
$function$;

-- notify_user_on_review: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.notify_user_on_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_link text;
  v_job_title text;
  v_customer_id uuid;
  v_reviewer_name text;
  v_revealed boolean;
BEGIN
  SELECT title, customer_id INTO v_job_title, v_customer_id
    FROM public.jobs WHERE id = NEW.job_id;

  -- Is this review visible to its subject right now? The visibility trigger
  -- runs AFTER INSERT alongside this one, so read the reciprocal directly
  -- rather than trusting NEW.feedback_visible_at, which may not be set yet.
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE job_id = NEW.job_id
      AND reviewee_id = NEW.reviewer_id
      AND id <> NEW.id
  ) INTO v_revealed;

  IF v_revealed THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_reviewer_name
      FROM public.profiles WHERE user_id = NEW.reviewer_id;
    v_title := 'New review from ' || v_reviewer_name;
    v_msg := 'You got a ' || NEW.rating || '-star review for "'
             || COALESCE(v_job_title, 'a job') || '".';
    -- Nothing to write; the ask is "come read it".
    v_link := '/profile?tab=reviews';
  ELSE
    -- Held. Say a review exists and nothing more — no rating, no name.
    v_title := 'You have a new review';
    v_msg := 'Someone reviewed you for "' || COALESCE(v_job_title, 'a job')
             || '". It unlocks once you review them too, or in 14 days.';
    -- The ask IS to write one, so land on the surface that can.
    -- A job whose row has gone (or a review with no job) has no Activity card
    -- to land on, so it falls back to the read-only tab rather than to a
    -- /posts?job= link naming nothing.
    IF NEW.job_id IS NULL OR v_customer_id IS NULL THEN
      v_link := '/profile?tab=reviews';
    ELSIF NEW.reviewee_id = v_customer_id THEN
      v_link := '/posts?job=' || NEW.job_id;
    ELSE
      v_link := '/jobs?job=' || NEW.job_id;
    END IF;
  END IF;

  SELECT COALESCE(reviews, true) INTO v_pref
  FROM public.notification_preferences WHERE user_id = NEW.reviewee_id;

  IF COALESCE(v_pref, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', v_link, NEW.job_id);
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Backfill (one time, idempotent).
DO $backfill$
DECLARE
  v_pass int := 0;
  v_rows int;
BEGIN
  LOOP
    v_pass := v_pass + 1;
    WITH names AS (
      SELECT p.user_id,
             '\m' || regexp_replace(btrim(p.full_name), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M' AS rx,
             replace(public.member_display_name(p.full_name, NULL), '\', '\\') AS dn,
             length(btrim(p.full_name)) AS len,
             btrim(p.full_name) AS full
        FROM public.profiles p
       WHERE btrim(p.full_name) ~ '\s'
         AND position(btrim(p.full_name) IN public.member_display_name(p.full_name, NULL)) = 0
    ), hit AS (
      SELECT DISTINCT ON (n.id) n.id, nm.rx, nm.dn
        FROM public.notifications n
        JOIN names nm
          ON nm.user_id IS DISTINCT FROM n.user_id
         AND (coalesce(n.title, '') ~ nm.rx OR coalesce(n.message, '') ~ nm.rx)
         -- Two members with the same full name: the recipient's own name is never shortened.
         AND NOT EXISTS (SELECT 1 FROM public.profiles rp
                          WHERE rp.user_id = n.user_id AND btrim(rp.full_name) = nm.full)
       WHERE NOT (coalesce(n.link, '') LIKE '/admin%'
                  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'))
       ORDER BY n.id, nm.len DESC
    )
    UPDATE public.notifications n
       SET title = regexp_replace(n.title, h.rx, h.dn, 'g'),
           message = regexp_replace(n.message, h.rx, h.dn, 'g')
      FROM hit h
     WHERE n.id = h.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'Q2292 backfill pass %: % notification(s) renamed', v_pass, v_rows;
    EXIT WHEN v_rows = 0 OR v_pass >= 10;
  END LOOP;
END
$backfill$;
