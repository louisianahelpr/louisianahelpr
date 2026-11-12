-- S016 (Shops audit 11-12, Medium): nothing reminded a shop before its 24-hour answer deadline, so new orders dropped
-- silently. The needs-you reminder sweep (Declutter offers and refunds) now also reminds the shop about every order
-- waiting on its answer: about 12 hours before accept_by ("Answer the new order") and in the last 2 hours ("Order drops
-- soon"), with the sweep's own rules (quiet hours, at most 2 per order per Louisiana day, one per rung, test orders
-- skipped). Owner rule: reminders are never trimmed, on by default (the shop's Orders switch).
-- needs_you_reminder_sends.step CHECK (inline in 20261102002011) restated plus 'shop_order'.
-- sweep_needs_you_reminders RESTATED from 20261109224952_notices_card_fee_and_our_team.sql (newest CREATE); only the
-- S016 lines (one UNION ALL branch, its words, its notice) are new.
-- sms_kind_for RESTATED from 20261110205345_push_titles_fit_lock_screen.sql (newest CREATE): the two new titles are
-- texted as 'needs_you' (every sweep title is texted; needsYouDeadlineReminders.test). sms_claim_due RESTATED from
-- 20261102034632_sms_needs_you_step_done.sql (newest CREATE): a shop-order text whose order was answered while it waited
-- is dropped as 'step_done', like an offer or refund step. The notifications_fan_out_to_sms trigger already wakes for
-- 'new_offers'. Only the S016 lines are new in each.
-- MONEY: none. AUTHZ: none new (service_role only, grants kept). REPLAY-SAFE: DROP/ADD CONSTRAINT, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsAcceptReminders.pglite.mjs (3x; NEW_MIGRATION=skip red; mutants).

ALTER TABLE public.needs_you_reminder_sends DROP CONSTRAINT IF EXISTS needs_you_reminder_sends_step_check;
ALTER TABLE public.needs_you_reminder_sends ADD CONSTRAINT needs_you_reminder_sends_step_check
  CHECK (step IN ('offer', 'refund_answer', 'refund_offer', 'shop_order'));

CREATE OR REPLACE FUNCTION public.sweep_needs_you_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    UNION ALL
    -- S016 (Shops audit 11-12): a Shops order waiting on the shop's answer by accept_by (24 h after the hold), or it drops.
    SELECT 'shop_order', so.id, so.accept_by, so.seller_id, so.buyer_id, 'seller',
           COALESCE(NULLIF(btrim(sh.name), ''), 'your shop')
      FROM public.shop_orders so
      JOIN public.shops sh ON sh.id = so.shop_id
     WHERE so.status = 'held' AND so.accept_by IS NOT NULL
       AND so.accept_by > p_now AND so.accept_by <= p_now + interval '12 hours'
       AND COALESCE(so.is_seed, false) = false
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
    ELSIF r.step = 'shop_order' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the new order' ELSE 'Order drops soon' END;
      v_body := format('A new order at %s is waiting on you. Next: accept or decline it by %s, or it drops and the buyer''s hold is released.', r.what, v_by);
    ELSIF r.step = 'refund_answer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund request' ELSE 'Refund request closes soon' END;
      v_body := format('The buyer asked for a refund on "%s". Next: answer by %s, or our team decides.', r.what, v_by);
    ELSE
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund offer' ELSE 'Refund offer closes soon' END;
      v_body := format('The seller offered part of a refund on "%s". Next: take it or ask our team to decide by %s, or our team decides.', r.what, v_by);
    END IF;

    BEGIN
      INSERT INTO public.needs_you_reminder_sends (user_id, step, ref_id, deadline, rung, sent_at)
      VALUES (r.to_id, r.step, r.ref_id, r.deadline, v_rung, p_now);
      IF r.step = 'offer' THEN
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_offers', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      ELSIF r.step = 'shop_order' THEN
        -- Filed under the shop's Orders switch (declutter_notice_type: a /shops link is a Shops kind).
        PERFORM public.declutter_notify_strict(r.to_id, 'new_offers', v_title, v_body, '/shops/dashboard', r.other_id);
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
$function$;

-- S016: the two new titles are texted as needs-you reminders.
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
    WHEN p_type IN ('warning', 'work_status') AND p_title = 'Please review the work' THEN 'needs_you'
    WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you'
    WHEN p_type = 'declutter_pickups' AND (p_title IN ('Porch pickup in 1 hour', 'Pickup in 1 hour')
                                           OR p_title LIKE 'Porch pickup at %' OR p_title LIKE 'Pickup at %') THEN 'needs_you'
    WHEN p_type = 'declutter_offers' AND p_title IN ('Answer the offer', 'Offer closes soon') THEN 'needs_you'
    WHEN p_type = 'declutter_refunds' AND p_title IN ('Answer the refund request', 'Refund request closes soon',
                                                      'Answer the refund offer', 'Refund offer closes soon') THEN 'needs_you'
    -- S016 (Shops audit 11-12): the shop's answer to a waiting order (sweep_needs_you_reminders). Ahead of the job offer
    -- row, which shares the 'new_offers' type.
    WHEN p_type = 'new_offers' AND p_title IN ('Answer the new order', 'Order drops soon') THEN 'needs_you'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning', 'job_updates') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Back-out reminders moved from 'warning' to 'job_updates' and are still never texted: ahead of the catch-all.
    WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', 'Your Helpr didn''t confirm',
                                                'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet',
                                                'A crew Helpr hasn''t confirmed yet')
      THEN NULL
    -- Other updates on the member's own job.
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;

-- S016: a shop-order text whose order was answered while it waited is dropped (step_done).
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
    IF v_reason IS NULL AND r.kind = 'needs_you' AND n.type IN ('declutter_offers', 'declutter_refunds', 'new_offers') THEN
      v_step := CASE n.title
        WHEN 'Answer the offer' THEN 'offer' WHEN 'Offer closes soon' THEN 'offer'
        WHEN 'Answer the refund request' THEN 'refund_answer' WHEN 'Refund request closes soon' THEN 'refund_answer'
        WHEN 'Answer the refund offer' THEN 'refund_offer' WHEN 'Refund offer closes soon' THEN 'refund_offer'
        -- S016: the shop's answer to a waiting order.
        WHEN 'Answer the new order' THEN 'shop_order' WHEN 'Order drops soon' THEN 'shop_order' END;
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
                              -- S016: still waiting on the shop's answer at that deadline.
                              WHEN 'shop_order' THEN EXISTS (
                                SELECT 1 FROM public.shop_orders so
                                 WHERE so.id = s.ref_id AND so.status = 'held' AND so.accept_by = s.deadline
                                   AND so.seller_id = s.user_id)
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
