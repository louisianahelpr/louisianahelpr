-- A3-85 (owner 11-01 12:19 PM, narrowed by the lead 6:12 PM): NEEDS-YOU DEADLINE REMINDERS. When a member has a step
-- due, they get a push (and a text, if they opted in to texts) before the deadline, the way the unread reminders work.
--
-- What each step had before this (measured in the migrations, newest definitions):
--   Declutter
--     * answer an offer (declutter_offers.respond_by, open, the 'awaiting' side): NO reminder. Added here.
--     * check out (declutter_cart_items.checkout_by): two reminders already ('Check out within 24 hours' and
--       '2 hours left to check out', declutter_deadline_sweep, type 'payment'), bell + push, never texted. Now texted.
--     * answer a refund request (declutter_refund_requests: seller by answer_by while 'open'; buyer by offer_answer_by
--       while 'offered'): NO reminder. Added here.
--     * hand over (a booked pickup time): the 1-hour pickup reminder already goes to both sides
--       (declutter_pickup_reminder_sweep, type 'declutter_pickups'), bell + push + email, never texted. Now texted.
--       Picking a pickup time is declutter_book_by_reminder_sweep's (20261101230519), not duplicated.
--   Jobs
--     * approve the finished work: 'Please review the work' (sweep_release_last_chance, type 'warning', 2 hours before
--       the 24-hour mark), bell + push, never texted. Now texted.
--     * confirm ("Still on for tomorrow?", type 'job_update' with the job): already pushed AND texted (sms_kind_for's
--       job-update catch-all). Unchanged.
--
-- 1. public.needs_you_reminder_sends: the claim, one row per (member, step, item, deadline, rung), written in the same
--    transaction as the notice (a failed notice rolls its claim back and the next run retries). A new deadline (a
--    counter-offer resets respond_by) is a new item to remind about.
-- 2. public.sweep_needs_you_reminders(p_now), service_role: for an open offer and an open refund step, rung 1 in
--    [deadline - 12 h, deadline - 2 h), rung 2 in [deadline - 2 h, deadline). Never after the step is done (each run
--    re-reads the step's own status and deadline), never past the deadline, at most 2 per member per item per
--    Louisiana day, nothing from 8:50 PM to 8 AM Central (so a text, which waits 3 minutes for the app to be read
--    first, never lands after 9 PM). Never a test (is_seed) offer or request. The notice goes through
--    declutter_notify_strict (seed isolation; push per the member's push and Declutter settings).
-- 3. TEXTS: sms_kind_for (restated from 20261030215251) gives the needs-you notices the new kind 'needs_you';
--    the notifications_fan_out_to_sms trigger (restated from 20261021193738) also wakes for the three Declutter
--    types it now texts; sms_claim_due (restated from 20261021193738) drops a needs-you text that is over an hour
--    old (a quiet-hours deferral would otherwise send it after the deadline). The fixed phrase is smsPolicy's
--    'needs_you'. Consent, the member's own category switches and quiet window, the daily cap and seed suppression
--    are sms_claim_due's, unchanged.
-- 4. CRON: rides 'declutter-book-by-reminders' (same 10-minute line '2-59/10 * * * *'): its command now calls
--    sweep_deadline_reminders(), which runs both sweeps, each in its own block, recorded on its own. No new job, so
--    CRON_RESERVE_FLOOR and the catch-up set are unchanged.
--
-- MONEY: none (no amount, refund, status or payout changes). AUTHZ: no member-callable function; every new function
-- is service_role only. REPLAY-SAFE: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, cron.schedule by name.
-- Proof: src/test/pglite/needsYouDeadlineReminders.pglite.mjs (applied 3x; red with NEW_MIGRATION=skip and on planted
-- defects).

CREATE TABLE IF NOT EXISTS public.needs_you_reminder_sends (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('offer', 'refund_answer', 'refund_offer')),
  -- A declutter_offers id (step 'offer') or a declutter_refund_requests id.
  ref_id uuid NOT NULL,
  deadline timestamptz NOT NULL,
  -- 1 = about 12 hours before, 2 = the last 2 hours.
  rung smallint NOT NULL CHECK (rung IN (1, 2)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step, ref_id, deadline, rung)
);
ALTER TABLE public.needs_you_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.needs_you_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.needs_you_reminder_sends TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- True from 8:50 PM to 8 AM Louisiana time: no needs-you reminder is written then.
CREATE OR REPLACE FUNCTION public.needs_you_reminder_quiet(p_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT (p_at AT TIME ZONE 'America/Chicago')::time >= time '20:50'
      OR (p_at AT TIME ZONE 'America/Chicago')::time < time '08:00';
$fn$;
REVOKE ALL ON FUNCTION public.needs_you_reminder_quiet(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.needs_you_reminder_quiet(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_needs_you_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
  v_rung smallint;
  v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_by text;
  v_title text;
  v_body text;
BEGIN
  IF public.needs_you_reminder_quiet(p_now) THEN
    RETURN 0;
  END IF;

  FOR r IN
    -- An open offer: the side it waits on answers by respond_by.
    SELECT 'offer'::text AS step, o.id AS ref_id, o.respond_by AS deadline,
           CASE WHEN o.awaiting = 'seller' THEN o.seller_id ELSE o.buyer_id END AS to_id,
           CASE WHEN o.awaiting = 'seller' THEN o.buyer_id ELSE o.seller_id END AS other_id,
           o.awaiting AS side,
           COALESCE(NULLIF(btrim(i.title), ''), 'your Declutter item') AS what
      FROM public.declutter_offers o
      LEFT JOIN public.declutter_items i ON i.id = o.item_id
     WHERE o.status = 'open' AND o.awaiting IN ('seller', 'buyer')
       AND o.respond_by IS NOT NULL AND o.respond_by > p_now AND o.respond_by <= p_now + interval '12 hours'
       AND COALESCE(o.is_seed, false) = false
    UNION ALL
    -- A refund request waiting on the seller's answer, or a refund offer waiting on the buyer's.
    SELECT CASE WHEN q.status = 'open' THEN 'refund_answer' ELSE 'refund_offer' END,
           q.id,
           CASE WHEN q.status = 'open' THEN q.answer_by ELSE q.offer_answer_by END,
           CASE WHEN q.status = 'open' THEN d.seller_id ELSE d.buyer_id END,
           CASE WHEN q.status = 'open' THEN d.buyer_id ELSE d.seller_id END,
           CASE WHEN q.status = 'open' THEN 'seller' ELSE 'buyer' END,
           COALESCE((SELECT NULLIF(btrim(i2.title), '') FROM public.declutter_cart_items c
                       JOIN public.declutter_items i2 ON i2.id = c.item_id
                      WHERE c.order_id = d.id ORDER BY c.created_at, c.id LIMIT 1), 'your Declutter item')
      FROM public.declutter_refund_requests q
      JOIN public.declutter_orders d ON d.id = q.order_id
     WHERE COALESCE(q.is_seed, false) = false
       AND ((q.status = 'open' AND q.answer_by > p_now AND q.answer_by <= p_now + interval '12 hours')
         OR (q.status = 'offered' AND q.offer_answer_by > p_now AND q.offer_answer_by <= p_now + interval '12 hours'))
  LOOP
    CONTINUE WHEN r.to_id IS NULL;
    IF r.deadline <= p_now + interval '2 hours' THEN
      v_rung := 2;
    ELSE
      v_rung := 1;
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.needs_you_reminder_sends s
                           WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                             AND s.deadline = r.deadline AND s.rung >= v_rung);
    -- At most 2 per member per item per Louisiana day (a reset deadline does not buy more).
    CONTINUE WHEN (SELECT count(*) FROM public.needs_you_reminder_sends s
                    WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                      AND s.sent_at >= v_day_start) >= 2;

    v_by := to_char(r.deadline AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')
            || CASE WHEN (r.deadline AT TIME ZONE 'America/Chicago')::date = (p_now AT TIME ZONE 'America/Chicago')::date
                    THEN ' today' ELSE ' tomorrow' END;
    IF r.step = 'offer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the offer' ELSE 'Offer closes soon' END;
      v_body := CASE WHEN r.side = 'seller'
        THEN format('An offer on "%s" is waiting on you. Next: accept, counter or decline by %s, or it expires.', r.what, v_by)
        ELSE format('The seller answered your offer on "%s". Next: accept, counter or decline by %s, or it expires.', r.what, v_by) END;
    ELSIF r.step = 'refund_answer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund request' ELSE 'Refund request closes soon' END;
      v_body := format('The buyer asked for a refund on "%s". Next: answer by %s, or Louisiana Helpr decides.', r.what, v_by);
    ELSE
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund offer' ELSE 'Refund offer closes soon' END;
      v_body := format('The seller offered part of a refund on "%s". Next: take it or ask Louisiana Helpr to decide by %s, or Louisiana Helpr decides.', r.what, v_by);
    END IF;

    BEGIN
      INSERT INTO public.needs_you_reminder_sends (user_id, step, ref_id, deadline, rung, sent_at)
      VALUES (r.to_id, r.step, r.ref_id, r.deadline, v_rung, p_now);
      IF r.step = 'offer' THEN
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_offers', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      ELSE
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_refunds', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      END IF;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      -- The claim above rolls back with the notice, so the next run retries; recorded where ops reads.
      PERFORM public.log_cron_defect('sweep_needs_you_reminders', r.step || ':' || r.ref_id::text, SQLERRM,
        jsonb_build_object('user_id', r.to_id, 'step', r.step, 'ref_id', r.ref_id, 'rung', v_rung));
    END;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_needs_you_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_needs_you_reminders(timestamptz) TO service_role;

-- Both deadline sweeps for the one cron job below. Each half runs in its own block and is recorded on its own: its
-- count in the job's cron_run_log row ({"book_by": n, "needs_you": n}), or, when it fails, NULL there, its name in
-- "failed" and a cron defect, so one failing half shows up and never stops the other.
CREATE OR REPLACE FUNCTION public.sweep_deadline_reminders(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_book_by integer;
  v_needs_you integer;
  v_failed text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_book_by := public.declutter_book_by_reminder_sweep(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'book_by');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'declutter_book_by_reminder_sweep', SQLERRM, NULL);
  END;
  BEGIN
    v_needs_you := public.sweep_needs_you_reminders(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'needs_you');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'sweep_needs_you_reminders', SQLERRM, NULL);
  END;
  RETURN jsonb_build_object('book_by', v_book_by, 'needs_you', v_needs_you)
         || CASE WHEN cardinality(v_failed) > 0 THEN jsonb_build_object('failed', to_jsonb(v_failed)) ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_deadline_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_deadline_reminders(timestamptz) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    UPDATE public.cron_work_expectations
       SET note = 'B117 (lead 11-01, A3-18/19): a paid Declutter pickup with no time booked reminds the buyer 24 h and 2 h before book_by (paid + 7 days). A3-85 (owner 11-01): an open Declutter offer or refund step reminds the member who must answer, about 12 h and 2 h before its deadline (2 a day per item, none 8:50 PM-8 AM).'
     WHERE jobname = 'declutter-book-by-reminders';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-book-by-reminders', '2-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-book-by-reminders', to_jsonb(public.sweep_deadline_reminders()));$c$);
  END IF;
END
$do$;

-- TEXTS (see 3. above). sms_kind_for restated from 20261030215251, with only the needs-you lines added.
CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- Needs-you deadline reminders (owner 11-01 12:19 PM; 20261102002011): a step the member must take before a
    -- deadline. Jobs: approve the finished work (sweep_release_last_chance). Declutter: check out (the 24 h and 2 h
    -- checkout reminders), hand over (the 1-hour pickup reminder), answer an offer or a refund step
    -- (sweep_needs_you_reminders). Ahead of every catch-all.
    WHEN p_type = 'warning' AND p_title = 'Please review the work' THEN 'needs_you'
    WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you'
    WHEN p_type = 'declutter_pickups' AND (p_title IN ('Porch pickup in 1 hour', 'Pickup in 1 hour')
                                           OR p_title LIKE 'Porch pickup at %' OR p_title LIKE 'Pickup at %') THEN 'needs_you'
    WHEN p_type = 'declutter_offers' AND p_title IN ('Answer the offer', 'Offer closes soon') THEN 'needs_you'
    WHEN p_type = 'declutter_refunds' AND p_title IN ('Answer the refund request', 'Refund request closes soon',
                                                      'Answer the refund offer', 'Refund offer closes soon') THEN 'needs_you'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Back-out reminders moved from 'warning' to 'job_updates' and are still never texted: ahead of the catch-all.
    WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', 'Your Helpr didn''t confirm',
                                                'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet')
      THEN NULL
    -- Other updates on the member's own job.
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_kind_for(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_kind_for(text, text, uuid) TO service_role;

-- The SMS fan-out trigger, restated from 20261021193738 with the three Declutter types it now texts. sms_kind_for
-- still decides, by exact title, which of their notices is texted (only the needs-you reminders).
DROP TRIGGER IF EXISTS notifications_fan_out_to_sms ON public.notifications;
CREATE TRIGGER notifications_fan_out_to_sms
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('message', 'job_match', 'new_offers', 'job_updates', 'job_update', 'work_status',
                     'expired', 'info', 'success', 'application', 'warning', 'payment', 'financial_alerts',
                     'declutter_offers', 'declutter_refunds', 'declutter_pickups'))
  EXECUTE FUNCTION public.sms_fan_out_on_notification();

-- sms_claim_due restated from 20261021193738, with only the needs-you staleness line added.
CREATE OR REPLACE FUNCTION public.sms_claim_due(p_limit integer, p_provider_ready boolean, p_now timestamptz DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r public.sms_messages;
  n public.notifications;
  c public.sms_consent;
  prefs public.notification_preferences;
  v_reason text;
  v_pref_col text;
  v_pref boolean;
  v_urgent boolean;
  v_release timestamptz;
  v_first boolean;
  -- p_now: the clock the decisions read (NULL = now()). The edge function never
  -- passes it; the PGlite proof does, to test night and day deterministically.
  v_now timestamptz := COALESCE(p_now, now());
BEGIN
  FOR r IN
    SELECT * FROM public.sms_messages
     WHERE status = 'pending' AND due_at <= v_now
     ORDER BY due_at
     LIMIT least(greatest(COALESCE(p_limit, 25), 1), 100)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := NULL;
    SELECT * INTO n FROM public.notifications WHERE id = r.notification_id;
    SELECT * INTO c FROM public.sms_consent WHERE user_id = r.user_id;
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = r.user_id;
    v_urgent := r.kind IN ('job_offer', 'starting_soon');

    IF n.id IS NULL THEN
      v_reason := 'notification_missing';
    ELSIF n.read IS TRUE THEN
      -- Seen in the app within the delay: the text would only repeat it.
      v_reason := 'seen_in_app';
    ELSIF c.user_id IS NULL OR NOT c.sms_opt_in THEN
      v_reason := 'no_consent';
    ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = r.user_id AND p.is_seed IS TRUE)
       OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = r.user_id) THEN
      v_reason := 'suppressed_seed';
    ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = r.user_id
                     AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                     -- the same lapsed-suspension rule as is_caller_banned()
                     AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > v_now)) THEN
      v_reason := 'account_restricted';
    ELSIF NOT public.feature_enabled_for_user('sms_alerts', r.user_id) THEN
      v_reason := 'switch_off';
    ELSIF p_provider_ready IS NOT TRUE THEN
      v_reason := 'twilio_not_configured';
    ELSIF r.kind = 'job_match' AND c.job_match_texts IS NOT TRUE THEN
      v_reason := 'job_match_texts_off';
    END IF;

    IF v_reason IS NULL THEN
      -- The member's own category toggle (the push toggles in Notification
      -- settings): a category they muted is not texted either.
      SELECT pref_column INTO v_pref_col FROM public.notification_type_pref_map WHERE type = n.type;
      IF v_pref_col IS NOT NULL AND prefs.user_id IS NOT NULL THEN
        EXECUTE format('SELECT ($1).%I', v_pref_col) INTO v_pref USING prefs;
        IF v_pref IS NOT TRUE THEN
          v_reason := 'pref_off';
        END IF;
      END IF;
    END IF;

    IF v_reason IS NULL AND (
         (r.kind = 'job_match' AND n.created_at < v_now - interval '12 hours')
      OR (r.kind = 'starting_soon' AND n.created_at < v_now - interval '45 minutes')
      -- A needs-you deadline reminder (20261102002011) is only worth a text near its own time: one deferred past
      -- quiet hours, or held longer, is dropped (the deadline may have passed or the step been done meanwhile).
      OR (r.kind = 'needs_you' AND n.created_at < v_now - interval '1 hour')
      OR (n.created_at < v_now - interval '36 hours')) THEN
      v_reason := 'stale';
    END IF;

    IF v_reason IS NULL THEN
      -- Quiet hours DEFER (never drop): the house window for non-urgent
      -- kinds, then the member's own window for every kind.
      v_release := v_now;
      IF NOT v_urgent THEN
        v_release := public.sms_quiet_release(v_release, '21:00'::time, '08:00'::time);
      END IF;
      v_release := public.sms_quiet_release(v_release, prefs.quiet_start, prefs.quiet_end);
      IF v_release > v_now THEN
        UPDATE public.sms_messages SET due_at = v_release, reason = 'quiet_hours' WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      IF NOT v_urgent AND r.kind <> 'money_problem' AND (SELECT count(*) FROM public.sms_messages m
           WHERE m.user_id = r.user_id AND m.status IN ('queued', 'sent')
             AND m.created_at > v_now - interval '24 hours') >= 10 THEN
        v_reason := 'cap_daily_total';
      ELSIF r.kind = 'job_match' AND (
              (SELECT count(*) FROM public.sms_messages m
                WHERE m.user_id = r.user_id AND m.kind = 'job_match'
                  AND m.status IN ('queued', 'sent') AND m.sent_at > v_now - interval '1 hour') >= 1
           OR (SELECT count(*) FROM public.sms_messages m
                WHERE m.user_id = r.user_id AND m.kind = 'job_match'
                  AND m.status IN ('queued', 'sent') AND COALESCE(m.sent_at, m.created_at) > v_now - interval '24 hours') >= 3) THEN
        v_reason := 'cap_job_matches';
      ELSIF r.kind = 'message' AND EXISTS (
              SELECT 1 FROM public.sms_messages m
               WHERE m.user_id = r.user_id AND m.kind = 'message' AND m.id <> r.id
                 AND m.status IN ('queued', 'sent') AND COALESCE(m.sent_at, m.created_at) > v_now - interval '10 minutes') THEN
        v_reason := 'coalesced_messages';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE public.sms_messages SET status = 'skipped', reason = v_reason WHERE id = r.id;
      CONTINUE;
    END IF;

    v_first := NOT EXISTS (
      SELECT 1 FROM public.sms_messages m
       WHERE m.user_id = r.user_id AND m.status IN ('queued', 'sent') AND m.kind IS DISTINCT FROM 'confirm'
         AND m.created_at >= COALESCE(c.opted_in_at, '-infinity'::timestamptz));
    UPDATE public.sms_messages SET status = 'queued', reason = NULL WHERE id = r.id;
    RETURN NEXT jsonb_build_object(
      'sms_id', r.id,
      'phone', c.phone_e164,
      'category', r.category,
      'kind', r.kind,
      'job_id', n.job_id,
      'first_text', v_first
    );
  END LOOP;
  RETURN;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_claim_due(integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim_due(integer, boolean, timestamptz) TO service_role;
