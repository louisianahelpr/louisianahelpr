-- SMS STEP-DONE CHECK (A3-85 follow-up, lead accepted; plan from B125's handoff, built by B137). A needs-you deadline
-- reminder (20261102002011) is texted only after it waits: 3 minutes for the app to be read first, or longer when quiet
-- hours defer it. If the member answered the offer or the refund step in that wait, the text still went out:
-- "Answer the offer ... by 10:00 PM" about an offer they had already accepted. sms_claim_due dropped only a text over
-- an hour old ('stale').
--
-- Fix: sms_claim_due (restated verbatim from its newest body, 20261102002011, plus the one block marked
-- 20261102034632) skips a needs-you text with reason 'step_done' when the step it reminds about is no longer waiting
-- on the member:
--   * the reminder's claim rows (needs_you_reminder_sends: user, step, item, deadline, rung; written in the notice's
--     own transaction, so sent_at is the notice's time) are matched by member, the step and rung the notice's title
--     names, and a sent_at within 10 minutes of the notice;
--   * dropped only when at least one claim matches and NONE of them is still due: the offer still 'open' at the same
--     respond_by and awaiting this member; the refund request still 'open' at the same answer_by (seller) or
--     'offered' at the same offer_answer_by (buyer); and the deadline not passed.
-- A text with no matching claim is left alone (the older needs-you kinds, checkout, pickup and job approval, have no
-- claim row and keep today's rule). Everything else in sms_claim_due is unchanged.
--
-- MONEY: none. AUTHZ: service_role only, as before (REVOKE FROM PUBLIC, anon, authenticated). REPLAY-SAFE: CREATE OR
-- REPLACE with the same signature, grants restated. Proof: src/test/pglite/smsNeedsYouStepDone.pglite.mjs (applied 3x
-- on needsYouDeadlineReminders' world; red with NEW_MIGRATION=skip and on planted defects).

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
  v_step text;
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

    -- A needs-you text whose step is already DONE is dropped (20261102034632): the member answered the offer or the
    -- refund step in the minutes the text waited (3 for the app to be read first, or a quiet-hours deferral).
    -- The reminder's claim row (needs_you_reminder_sends, written in the notice's own transaction) names the step,
    -- the item and the deadline it was about; the notice's title says the step and the rung. Dropped only when every
    -- matching claim's step is no longer waiting on this member at that deadline; no match leaves the text alone.
    IF v_reason IS NULL AND r.kind = 'needs_you' AND n.type IN ('declutter_offers', 'declutter_refunds') THEN
      v_step := CASE n.title
        WHEN 'Answer the offer' THEN 'offer' WHEN 'Offer closes soon' THEN 'offer'
        WHEN 'Answer the refund request' THEN 'refund_answer' WHEN 'Refund request closes soon' THEN 'refund_answer'
        WHEN 'Answer the refund offer' THEN 'refund_offer' WHEN 'Refund offer closes soon' THEN 'refund_offer' END;
      IF v_step IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.needs_you_reminder_sends s
                      WHERE s.user_id = r.user_id AND s.step = v_step
                        AND s.rung = CASE WHEN n.title LIKE 'Answer the %' THEN 1 ELSE 2 END
                        AND s.sent_at BETWEEN n.created_at - interval '10 minutes' AND n.created_at + interval '10 minutes')
         AND NOT EXISTS (SELECT 1 FROM public.needs_you_reminder_sends s
                          WHERE s.user_id = r.user_id AND s.step = v_step
                            AND s.rung = CASE WHEN n.title LIKE 'Answer the %' THEN 1 ELSE 2 END
                            AND s.sent_at BETWEEN n.created_at - interval '10 minutes' AND n.created_at + interval '10 minutes'
                            AND s.deadline > v_now
                            AND CASE s.step
                              WHEN 'offer' THEN EXISTS (
                                SELECT 1 FROM public.declutter_offers o
                                 WHERE o.id = s.ref_id AND o.status = 'open' AND o.respond_by = s.deadline
                                   AND (CASE WHEN o.awaiting = 'seller' THEN o.seller_id ELSE o.buyer_id END) = s.user_id)
                              WHEN 'refund_answer' THEN EXISTS (
                                SELECT 1 FROM public.declutter_refund_requests q
                                 WHERE q.id = s.ref_id AND q.status = 'open' AND q.answer_by = s.deadline)
                              ELSE EXISTS (
                                SELECT 1 FROM public.declutter_refund_requests q
                                 WHERE q.id = s.ref_id AND q.status = 'offered' AND q.offer_answer_by = s.deadline)
                            END) THEN
        v_reason := 'step_done';
      END IF;
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
