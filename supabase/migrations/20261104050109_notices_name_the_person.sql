-- Q2331 (owner 2026-11-03, via the lead: "first name + last initial"): two poster notices named a known
-- person by role. expire_unanswered_offers' crew notice now reads "Bea T. didn't answer in time for ..."
-- and series_release_dates' gave-up notice "Bea T. gave up <dates> on ...", through member_display_name
-- (the member-name rule), with the old role words as the fallback for a blank name.
-- Restated from the newest definitions, live on prod 2026-11-03 (read-only pg_proc check:
-- expire_unanswered_offers md5(prosrc) 9c2647e1f79665416a09ef03fdf34d3a = 20261103023713;
-- series_release_dates b1fc50b689ed438ad10eb930ff313498 = 20261102070659). Only those two strings change;
-- arguments, logic, other notices and grants are as live.
-- The gave-up notice is filed on the series parent, where the Helpr is a party only through
-- recurring_visit_releases / series_date_offers / series_visit_holds; the Q2330 departed-member scrub
-- (20261103022806) now also matches those, so a deleted Helpr's name leaves that notice too (restated from
-- 20261103022806, the only definition; trigger unchanged). purge_user_data (live md5 9e1e1e07...,
-- 2026-11-03) deletes none of the three tables before its step 4e (read-only prosrc check).
-- Proof: src/test/pglite/noticesNameThePerson.pglite.mjs.

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
  v_setup_unfinished boolean;
  v_crew_setup_unfinished boolean;
  v_cap_ended boolean;
  v_too_late boolean;
  v_crew_cap boolean;
  v_crew_too_late boolean;
  v_slot record;
  v_cjob record;
  v_remaining int;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id, j.helper_id,
           -- Q1188: a seed job, or a seed/test Helpr (detect_stuck_payments'
           -- rule), logs a failure under the '-seed' source.
           (coalesce(j.is_seed, false) OR coalesce(hp.is_seed, false)) AS seed
      FROM public.jobs j
      LEFT JOIN public.profiles hp ON hp.user_id = j.helper_id
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    -- Q1188 (lh-authz-rls round 3 of Q1180, should-fix 2): each offer in its
    -- own subtransaction. accept_job_offer takes the Helpr's profile, then the
    -- job; this sweep holds the job when the strike ladder writes that
    -- profile. If Postgres picks this side of that deadlock (or anything else
    -- in one iteration fails), only this offer rolls back, it is logged with
    -- its job, and every other offer still expires. The next run retries it.
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.helper_id, j.response_deadline, j.date_needed, j.start_time, j.payment_status
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

      -- Q1281 (owner, 2026-10-05): letting an offer run out is free, like
      -- declining it. Nothing is committed until the Helpr taps Accept, so
      -- this sweep files no strike. The two flags below only pick the
      -- Helpr's sentence: the answer-by was capped at the job's start
      -- (20261005184940), or their Stripe setup was unfinished / their
      -- Accept was still waiting on it (Q1180).
      v_cap_ended := v_locked.response_deadline >= public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time);
      -- Q1889: accept_application's own rule. Past it, nobody else can be hired for this start.
      v_too_late := public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time) <= now() + interval '15 minutes';
      v_setup_unfinished := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);

      IF v_app_id IS NOT NULL THEN
        -- Q1207: say why it closed, or the Helpr reads "You weren't picked".
        UPDATE public.applications
           SET status = 'rejected', closed_reason = 'offer_expired'
         WHERE id = v_app_id;
      END IF;

      UPDATE public.jobs
         SET status = 'open',
             helper_id = NULL,
             response_deadline = NULL
       WHERE id = v_locked.id;

      -- Both sides are told, because both sides were waiting on this.
      -- A failed payment (the card hold could not be charged): the Helpr did nothing wrong, often
      -- tapped Accept, and the job is off the list until the poster pays again, so neither
      -- "didn't answer" nor "open to everyone" would be true (job 02a6e1b5, 2026-10-30).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.customer_id,
        CASE WHEN v_locked.payment_status = 'failed'
             THEN 'Offer expired — payment needed'
             WHEN v_too_late
             THEN 'Offer expired'
             ELSE 'Offer expired — job reopened' END,
        CASE WHEN v_locked.payment_status = 'failed'
             THEN 'Your payment for "' || COALESCE(v_locked.title, 'your job')
                    || '" didn''t go through before the offer ran out, so nobody was hired. Open the job to pay again.'
             WHEN v_too_late
             THEN 'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
                    || '", and it''s now too late to hire someone else for that time.'
             ELSE 'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
                    || '". It''s open to everyone again, so you can pick somebody else.'
        END,
        'job_updates',
        '/posts?job=' || v_locked.id::text,
        v_locked.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
          || CASE WHEN v_cap_ended
               THEN '" when the job started, so it went back to everyone. No strike.'
               WHEN v_locked.payment_status = 'failed'
               THEN '" while it was waiting on payment from the person who posted it, so the offer closed. No strike.'
               WHEN v_setup_unfinished
               THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and it went back to everyone. No strike.'
             END,
        'expired',
        '/jobs?job=' || v_locked.id::text,
        v_locked.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E offer logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_job.seed THEN 'info' ELSE 'error' END,
        'unanswered offer expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_job.seed THEN '-seed' ELSE '' END,
                           'seed', v_job.seed, 'job_id', v_job.id::text),
        jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  -- ── THE CREW PASS (Q729, owner 2026-10-05) ───────────────────────────────
  -- A crew has no lead, so its members are found on the roster. Each member
  -- whose own reply deadline passed unconfirmed loses the spot, exactly as a
  -- single offer expires: no strike (Q1281), application closed as
  -- offer_expired, both sides told; the spot reopens (a full crew goes back
  -- to open). No fee: nothing was committed.
  FOR v_slot IN
    SELECT g.id AS slot_id, g.job_id, g.helper_id,
           g.response_deadline, j.date_needed, j.start_time,
           (j.is_seed IS TRUE OR hp.is_seed IS TRUE) AS seed
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
      LEFT JOIN public.profiles hp ON hp.user_id = g.helper_id
     WHERE j.is_group_job IS TRUE
       -- 'in_progress' (Q1378 money review, 2026-10-05): a member who already
       -- arrived starts the crew, and an unconfirmed spot on it must still
       -- expire, or it holds a share nobody will work.
       AND j.status IN ('open', 'accepted', 'in_progress')
       AND g.helper_id IS NOT NULL
       AND g.helper_confirmed_at IS NULL
       AND g.response_deadline IS NOT NULL
       AND g.response_deadline < now()
  LOOP
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.status::text AS status, j.helpers_needed, j.payment_status
        INTO v_cjob
        FROM public.jobs j
       WHERE j.id = v_slot.job_id
         AND j.is_group_job IS TRUE
         AND j.status IN ('open', 'accepted', 'in_progress')
       FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
      -- Re-checked under the job's lock: a confirm that landed first wins.
      PERFORM 1
        FROM public.group_job_helpers g
       WHERE g.id = v_slot.slot_id
         AND g.helper_confirmed_at IS NULL
         AND g.response_deadline IS NOT NULL
         AND g.response_deadline < now()
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- Q1281: no strike here either; the flags only pick the sentence.
      v_crew_cap := v_slot.response_deadline >= public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time);
      -- Q1889: the same cutoff rule as the single offer; past it, nobody can fill the spot.
      v_crew_too_late := public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time) <= now() + interval '15 minutes';
      v_crew_setup_unfinished := public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_cjob.id AND p.helper_id = v_slot.helper_id);

      UPDATE public.applications
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE job_id = v_cjob.id AND helper_id = v_slot.helper_id AND status = 'accepted';

      DELETE FROM public.group_job_helpers WHERE id = v_slot.slot_id;

      SELECT count(*) INTO v_remaining FROM public.group_job_helpers g WHERE g.job_id = v_cjob.id;
      -- Q1378 (owner 2026-10-05): the rest of the crew carries on; only a
      -- crew with nobody left reopens (see helper_cancel_booking).
      IF v_cjob.status = 'accepted' AND v_remaining = 0 THEN
        UPDATE public.jobs SET status = 'open' WHERE id = v_cjob.id;
      END IF;

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_cjob.customer_id,
        CASE WHEN v_cjob.payment_status = 'failed'
             THEN 'Offer expired — payment needed'
             WHEN v_crew_too_late
             THEN 'Offer expired'
             ELSE 'Offer expired — spot reopened' END,
        CASE WHEN v_cjob.payment_status = 'failed'
             THEN 'Your payment for "' || COALESCE(v_cjob.title, 'your job')
                    || '" didn''t go through before a Helpr''s offer ran out, so they weren''t confirmed. Open the job to pay again'
             -- Q2331 (owner 2026-11-03): say who, "Bea T. didn't answer in time"; the role words only for a blank name.
             ELSE public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = v_slot.helper_id), 'A Helpr you picked')
                    || ' didn''t answer in time for "' || COALESCE(v_cjob.title, 'your job') END
          || CASE WHEN v_cjob.payment_status = 'failed' THEN '.'
               WHEN v_cjob.status = 'in_progress' AND v_remaining > 0
               THEN '". The rest of your crew is still on, and that spot''s share is refunded to you once the job is done.'
               WHEN v_crew_too_late AND v_remaining > 0
               THEN '". The rest of your crew is still on. It''s now too late to fill that spot for that time, so that spot''s share is refunded to you once the job is done.'
               WHEN v_crew_too_late
               THEN '". It''s now too late to fill that spot for that time.'
               WHEN v_cjob.status = 'accepted' AND v_remaining > 0
               THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
               ELSE '". Their spot is open to everyone again, so you can pick somebody else.'
             END,
        'job_updates',
        '/posts?job=' || v_cjob.id::text,
        v_cjob.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_slot.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_cjob.title, 'a job')
          || CASE WHEN v_crew_cap
               THEN '" when the job started, so you lost your spot. No strike.'
               WHEN v_cjob.payment_status = 'failed'
               THEN '" while it was waiting on payment from the person who posted it, so you lost your spot. No strike.'
               WHEN v_crew_setup_unfinished
               THEN '" before your payout setup and Stripe ID were done, so you lost your spot. No strike. Finish both so you can accept the next offer.'
               ELSE '" and you lost your spot. No strike.'
             END,
        'expired',
        '/jobs?job=' || v_cjob.id::text,
        v_cjob.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_slot.seed THEN 'info' ELSE 'error' END,
        'unanswered crew spot expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_slot.seed THEN '-seed' ELSE '' END,
                           'seed', v_slot.seed, 'job_id', v_slot.job_id::text),
        jsonb_build_object('job_id', v_slot.job_id, 'helper_id', v_slot.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.series_release_dates(
  p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
RETURNS date[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_released date[];
  v_list text;
  v_flag text := current_setting('app.series_end_rpc', true);
BEGIN
  IF p_parent IS NULL OR p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN ARRAY[]::date[];
  END IF;

  PERFORM set_config('app.series_end_rpc', '1', true);

  -- A date with a booked visit is not released here (it is cancelled from its
  -- own card, helper_cancel_booking, which vacates the visit first). A
  -- VACATED visit (open, no Helpr, still funded) is released like an
  -- uncreated date: the next Helpr takes over that visit row.
  WITH gone AS (
    DELETE FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id = p_helper
       AND h.visit_date = ANY (p_dates)
       AND NOT EXISTS (SELECT 1 FROM public.jobs c
                        WHERE c.parent_job_id = p_parent AND c.date_needed = h.visit_date
                          AND NOT (c.status::text = 'open' AND c.helper_id IS NULL)
                        FOR SHARE)
    RETURNING h.visit_date
  )
  SELECT COALESCE(array_agg(visit_date ORDER BY visit_date), ARRAY[]::date[]) INTO v_released FROM gone;

  IF cardinality(v_released) > 0 THEN
    INSERT INTO public.recurring_visit_releases (parent_job_id, helper_id, visit_date, reason)
    SELECT p_parent, p_helper, d, p_reason FROM unnest(v_released) AS d
    ON CONFLICT (parent_job_id, visit_date)
      DO UPDATE SET helper_id = EXCLUDED.helper_id, reason = EXCLUDED.reason, created_at = now();

    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_released) AS d;

    IF p_customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        p_customer, p_parent,
        CASE WHEN cardinality(v_released) = 1 THEN 'A visit date is open again' ELSE 'Visit dates are open again' END,
        -- Q2246: charge-recurring-visits releases an ineligible holder's dates ('holder_ineligible'); nobody gave
        -- them up, so the poster reads a neutral line that names nothing about the Helpr.
        format(CASE WHEN p_reason = 'holder_ineligible'
                    THEN '%s on "%s" %s open again. Another Helpr on the series can pick %s up, or you can offer %s to someone new. A date nobody takes isn''t charged, or most of it comes back to your card if you already paid for it.'
                    ELSE '%6$s gave up %1$s on "%2$s"%3$s. Another Helpr on the series can pick %4$s up, or you can offer %5$s to someone new. A date nobody takes isn''t charged, or most of it comes back to your card if you already paid for it.'
               END,
               v_list, COALESCE(p_title, 'your series'),
               CASE WHEN p_reason = 'holder_ineligible' THEN CASE WHEN cardinality(v_released) = 1 THEN 'is' ELSE 'are' END ELSE '' END,
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
               -- Q2331 (owner 2026-11-03): the 6th argument names the Helpr who gave the dates up ("Bea T.").
               -- The gave-up line reads it with positional %n$s (never by concatenation, so a % in a name is
               -- text); the neutral line uses only arguments 1-5 and format() ignores the rest.
               public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = p_helper), 'A Helpr')),
               'job_updates', '/posts?job=' || p_parent::text);
    END IF;

    -- Every other Helpr on the series (holding a date from today on), not the
    -- one who gave it up.
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    SELECT DISTINCT h.helper_id, p_parent,
           'A date opened up — pick it up',
           format('%s on "%s" %s open. First to pick %s up gets %s.',
                  v_list, COALESCE(p_title, 'your series'),
                  CASE WHEN cardinality(v_released) = 1 THEN 'is' ELSE 'are' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END),
           'job_updates', '/jobs?job=' || p_parent::text
      FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id <> p_helper
       AND h.visit_date >= (now() AT TIME ZONE 'America/Chicago')::date;
  END IF;

  PERFORM set_config('app.series_end_rpc', COALESCE(v_flag, '0'), true);
  RETURN v_released;
END;
$fn$;

REVOKE ALL ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full text := btrim(coalesce(OLD.full_name, ''));
  v_name text;
  v_rx text;
BEGIN
  IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL OR v_full !~ '\s' THEN
    RETURN NEW;
  END IF;
  -- Longest first: the full name, then its "First L." form.
  FOREACH v_name IN ARRAY ARRAY[v_full, public.member_display_name(OLD.full_name, NULL)] LOOP
    CONTINUE WHEN v_name IS NULL OR v_name = '';
    v_rx := '\m' || regexp_replace(v_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?!\w)';
    UPDATE public.notifications n
       SET title   = regexp_replace(regexp_replace(n.title, '^' || v_rx, 'A former member'), v_rx, 'a former member', 'g'),
           message = regexp_replace(regexp_replace(n.message, '^' || v_rx, 'A former member'), v_rx, 'a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx)
       AND n.job_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.jobs j
                     WHERE j.id = n.job_id AND OLD.user_id IN (j.customer_id, j.helper_id))
         OR EXISTS (SELECT 1 FROM public.applications a
                     WHERE a.job_id = n.job_id AND a.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                     WHERE g.job_id = n.job_id AND g.helper_id = OLD.user_id)
         -- Q2331 review (lh-authz-rls, 11-03): a series Helpr is a party to the series parent through these
         -- rows, not through jobs/applications/group_job_helpers, so "Bea T. gave up <date>" (job_id = the
         -- parent) left her name in the poster's bell. purge_user_data deletes none of them before 4e.
         OR EXISTS (SELECT 1 FROM public.recurring_visit_releases r
                     WHERE r.parent_job_id = n.job_id AND r.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_date_offers o
                     WHERE o.parent_job_id = n.job_id AND o.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                     WHERE h.parent_job_id = n.job_id AND h.helper_id = OLD.user_id))
       AND NOT (coalesce(n.link, '') LIKE '/admin%'
                AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'));
  END LOOP;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated;
