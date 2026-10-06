-- Q1324 / Q1411 / Q1221 follow-ups (owner decisions and reviews, 2026-10-05
-- ~22:00-22:30 CT). Builds on 20261006014801 (ban_settlement_queue,
-- ban_evasion_matches) and 20261006020751 (payout freeze). Every function
-- restated here is its LIVE body (pg_get_functiondef, prod, 2026-10-05) plus
-- only the change named in its section; grants are restated as live.
--
--   1. enforce_retained_ban (email / phone / identity matches, owner
--      supersedes 2026-09-07): no longer copies the retained ban's reason,
--      date or id into the person's fraud flag or user_bans (both exported by
--      export_my_data); neutral account-only wording, and the other account's
--      details go to admin-only ban_evasion_matches.
--   2. Money freezes while a ban settlement review is open (lh-money-escrow):
--      - refuse_payout_claim_while_held also refuses a transfer claim on a job
--        whose POSTER (or Helpr) is under an open review;
--      - a job under review cannot move escrow -> payout_pending (the
--        auto-release / confirm move) on any path;
--      - settle_one_off_jobs_for_banned_account prices a late-cancel fee as of
--        app.ban_settlement_as_of when an admin confirms a review (the ban
--        time), not as of the confirm.
--   3. Q1411 (owner): while a review is open the account's OPEN posts leave
--      every browse surface (open_jobs_browse stays security_invoker = false,
--      get_ranked_open_jobs, get_open_jobs_for_map, get_public_open_jobs, and
--      job_announceable_to for announcements) and take no NEW applications
--      (enforce_application_job_state, the same neutral 'job_not_available').
--      Existing applications are untouched; a lift brings the posts back as
--      they were; a confirm settles them.
--   4. An open review pages: ban-review-watch (hourly) files one fatal
--      error_logs row and an admin_alert per review open over 24 hours, again
--      every 24 hours while it stays open.
--   5. Those admin alerts close themselves (Q355): 'Ban settlement review'
--      titles re-ask the queue (admin_alert_close_rule /
--      admin_queue_still_pending, live bodies plus one entry each).
--
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, the view through the
-- same DO / EXECUTE shape as 20260927012806, cron / expectations guarded.
-- Proof: src/test/pglite/banEvasionCardBankName.pglite.mjs.

-- ── 1. enforce_retained_ban: neutral reason, details admin-only ─────────────

CREATE OR REPLACE FUNCTION public.enforce_retained_ban(p_user_id uuid, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_identity_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email_h text := CASE WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(p_email))::bytea), 'hex') END;
  v_phone_h text := public.ban_fingerprint('phone', public.normalize_phone_for_ban(p_phone));
  v_ident_h text := NULLIF(btrim(COALESCE(p_identity_sha256, '')), '');
  v_row     RECORD;
  v_matched text;
  v_attempt text;
  v_cur_status text;
  v_cur_until  timestamptz;
  v_cur_rank   int;
  v_new_rank   int;
  v_own_reason CONSTANT text :=
    'This account is linked to an account closed for breaking our Platform Rules. '
    || 'Contact support if you think this is a mistake.';
BEGIN
  IF v_email_h IS NULL AND v_phone_h IS NULL AND v_ident_h IS NULL THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans
   WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)
      OR (v_phone_h IS NOT NULL AND phone_sha256    = v_phone_h)
      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)
   ORDER BY (identity_sha256 IS NOT NULL AND identity_sha256 = v_ident_h) DESC,
            (phone_sha256    IS NOT NULL AND phone_sha256    = v_phone_h) DESC,
            retained_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  v_matched := CASE
    WHEN v_ident_h IS NOT NULL AND v_row.identity_sha256 = v_ident_h THEN 'identity'
    WHEN v_phone_h IS NOT NULL AND v_row.phone_sha256    = v_phone_h THEN 'phone'
    ELSE 'email'
  END;

  v_attempt := NULLIF(btrim(COALESCE(p_email, '')), '');
  IF v_attempt IS NULL AND p_user_id IS NOT NULL THEN
    SELECT email INTO v_attempt FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF p_user_id IS NOT NULL THEN
    -- The one legitimate self-issued ban: a judgment from an account that no
    -- longer exists, re-applied with no admin present. Scoped to this
    -- transaction (`is_local => true`), so it cannot leak to any other write.
    -- Set BEFORE the profile write, so refuse_unban_during_ban_review sees it
    -- (lh-authz-rls review of f2644839e: set after, the open-review exemption
    -- never applied and stripe-idv-webhook still failed).
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

    -- Never soften or re-date an existing ban (as enforce_retained_payment_ban
    -- does): complete-signup calls this with any signed-in user's JWT and a
    -- phone from the request body, so a weaker retained row matched by phone
    -- turned a permanent ban into a short temporary one, whose expiry then
    -- released a payout hold (same review). Only a stricter judgment applies.
    SELECT ban_status, auto_suspended_until INTO v_cur_status, v_cur_until
      FROM public.profiles WHERE user_id = p_user_id;
    v_cur_rank := CASE v_cur_status WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 WHEN 'temp_banned' THEN 1 ELSE 0 END;
    v_new_rank := CASE v_row.ban_status WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 WHEN 'temp_banned' THEN 1 ELSE 0 END;
    IF v_new_rank > v_cur_rank
       OR (v_new_rank = 1 AND v_cur_rank = 1 AND v_cur_until IS NOT NULL
           AND (v_row.expires_at IS NULL OR v_row.expires_at > v_cur_until)) THEN
      UPDATE public.profiles
         SET ban_status           = v_row.ban_status,
             auto_suspended_until = v_row.expires_at
       WHERE user_id = p_user_id;
    END IF;

    -- Q1324 (owner 2026-10-05, supersedes 2026-09-07): the reason this
    -- person sees on /account-banned and in their data export is about THEM,
    -- never the retained ban's own reason.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           COALESCE(v_row.ban_type, v_row.ban_status),
           v_own_reason,
           p_user_id,
           v_row.expires_at,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_own_reason
     );

    PERFORM set_config('app.retained_ban_reapply', 'off', true);

    -- The admin record. Everything the user-facing refusal deliberately
    -- withholds goes here instead.
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT
        p_user_id,
        'ban_evasion_attempt',
        format(
          'Signup blocked: matched a ban retained on %s. Attempted email: %s. '
          || 'The retained ban it matched is in the admin match record (ban_evasion_matches).',
          v_matched,
          COALESCE(v_attempt, '(unknown)')
        )
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
         WHERE f.user_id = p_user_id
           AND f.flag_type = 'ban_evasion_attempt'
           AND NOT f.resolved
           AND f.details LIKE 'Signup blocked: matched a ban retained on ' || v_matched || '.%'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'enforce_retained_ban: fraud flag failed for %: %', p_user_id, SQLERRM;
    END;

    -- The retained ban's own details, for admins only (never exported).
    BEGIN
      INSERT INTO public.ban_evasion_matches (
        user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
        original_recorded_at, original_expires_at, auto_banned
      )
      VALUES (p_user_id, v_matched,
              CASE v_matched WHEN 'identity' THEN v_ident_h WHEN 'phone' THEN v_phone_h ELSE v_email_h END,
              v_row.id, v_row.ban_status, v_row.reason, v_row.retained_at, v_row.expires_at, true)
      ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'enforce_retained_ban: match record failed for %: %', p_user_id, SQLERRM;
    END;
  END IF;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',      true,
    'matched_on',  v_matched,
    'ban_status',  v_row.ban_status,
    'reason',      v_own_reason,
    'expires_at',  v_row.expires_at,
    'retained_at', v_row.retained_at,
    'retained_id', v_row.id
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) TO service_role;

-- ── 2a. No transfer claim on a job whose poster or Helpr is under review ────

CREATE OR REPLACE FUNCTION public.refuse_payout_claim_while_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer uuid;
  v_helper   uuid;
BEGIN
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr''s payouts are on hold (public.payout_holds). No transfer may be claimed until an admin releases the hold.';
  END IF;
  -- Q1324: a job whose POSTER or Helpr is under an open ban settlement review
  -- moves no money until an admin decides (the Helpr also has a payout hold;
  -- the poster's counterparty does not, so the job is checked here). The
  -- claim's own recipient too: on a crew job jobs.helper_id is NULL and the
  -- member paid is NEW.helper_id (lh-money-escrow F4, 2026-10-06).
  IF NEW.status = 'pending' AND NEW.stripe_transfer_id IS NULL THEN
    -- FOR KEY SHARE: the parties read are the ones the claim is for, and a
    -- concurrent settlement cannot swap them out from under it.
    SELECT j.customer_id, j.helper_id INTO v_customer, v_helper
      FROM public.jobs j
     WHERE j.id = NEW.job_id
       FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                WHERE q.review_state = 'open' AND q.user_id IN (v_customer, v_helper, NEW.helper_id)) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'An account on this job is under a ban settlement review (public.ban_settlement_queue). No transfer may be claimed until an admin confirms or lifts it.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


REVOKE ALL ON FUNCTION public.refuse_payout_claim_while_held() FROM PUBLIC, anon, authenticated, service_role;

-- ── 2b. No escrow -> payout_pending on a job under review, on any path ──────
CREATE OR REPLACE FUNCTION public.refuse_payout_pending_during_ban_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.payment_status = 'escrow'
     AND NEW.payment_status = 'payout_pending'
     AND EXISTS (
       SELECT 1 FROM public.ban_settlement_queue q
        WHERE q.review_state = 'open'
          AND (q.user_id IN (NEW.customer_id, NEW.helper_id)
               OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                           WHERE g.job_id = NEW.id AND g.helper_id = q.user_id))) THEN
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = '23514',
            DETAIL = 'An account on this job is under a ban settlement review. Its money waits for an admin to confirm or lift it.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refuse_payout_pending_during_ban_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_payout_pending_during_ban_review ON public.jobs;
CREATE TRIGGER trg_refuse_payout_pending_during_ban_review
  BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.payment_status = 'escrow' AND NEW.payment_status = 'payout_pending')
  EXECUTE FUNCTION public.refuse_payout_pending_during_ban_review();

-- ── 2c. A confirmed review is priced as of the ban ─────────────────────────

CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_seat text;
  v_other uuid;
  v_action text;
  v_started boolean;
  v_series boolean;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_cut numeric;
  v_n int;
  v_title text;
  v_admin_note text;
  v_out jsonb := '[]'::jsonb;
  v_closed_apps int := 0;
  v_closed_offers int := 0;
  v_cancel_flag text := current_setting('app.sanctioned_cancel', true);
  v_ladder_flag text := current_setting('app.trusted_ladder_write', true);
  v_reason CONSTANT text := 'Cancelled because an account on this job was closed by Louisiana Helpr.';
  v_dispute_reason CONSTANT text := 'An account on this job was closed by Louisiana Helpr after work had started. An admin decides the payment.';
  v_gone CONSTANT text := 'the other person on it can no longer use Louisiana Helpr';
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('settled', '[]'::jsonb, 'closed_applications', 0, 'closed_offers', 0);
  END IF;

  FOR v_job IN
    SELECT j.id, j.title, j.customer_id, j.helper_id, j.status::text AS status, j.payment_status,
           j.budget, j.date_needed, j.start_time, j.helper_confirmed_at, j.helper_fee_percent,
           j.helper_arrived_at, j.helper_completed_at, j.proof_before_urls, j.proof_after_urls,
           j.is_group_job, j.parent_job_id, j.recurrence_days,
           j.offered_to_helper_id, j.direct_offer_status
      FROM public.jobs j
     WHERE (
             (j.customer_id = p_user OR j.helper_id = p_user
              OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                          WHERE g.job_id = j.id AND g.helper_id = p_user))
             AND j.status::text NOT IN ('completed', 'cancelled')
           )
        OR (j.helper_id = p_user
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending'))
        -- Q731(b), owner 2026-10-05: a crew has no lead (Q407), so a banned
        -- crew MEMBER of a finished crew job is found through the roster, and
        -- is treated exactly as a banned single Helpr (ban_settlement_action:
        -- admin_review, every admin alerted, payouts run on schedule). A member
        -- whose own share already paid out has nothing left to decide.
        OR (j.is_group_job IS TRUE
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending')
            AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                         WHERE g.job_id = j.id AND g.helper_id = p_user)
            AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                             WHERE pt.job_id = j.id AND pt.helper_id = p_user AND pt.status = 'paid'))
     ORDER BY j.id
       FOR UPDATE
  LOOP
    v_seat := CASE WHEN v_job.customer_id = p_user THEN 'poster' ELSE 'helpr' END;
    v_other := CASE WHEN v_seat = 'poster' THEN v_job.helper_id ELSE v_job.customer_id END;
    v_series := v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL;
    -- helper_abort_job's "work started" test, plus a requested revision (which
    -- only follows a Done).
    v_started := v_job.helper_arrived_at IS NOT NULL
              OR v_job.helper_completed_at IS NOT NULL
              OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
              OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0
              OR v_job.status = 'revision_requested';
    v_action := public.ban_settlement_action(v_seat, v_job.status, v_job.payment_status,
                                             v_started, COALESCE(v_job.is_group_job, false), v_series);
    v_title := COALESCE(v_job.title, 'A job');
    v_admin_note := NULL;
    v_fee := 0;
    v_hours := NULL;

    BEGIN
      -- The sanctioned hatches this settlement is (trg_cancellation_requires_rpc,
      -- the helper column whitelist), transaction-local and restored below.
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.trusted_ladder_write', 'on', true);

      IF v_action IN ('cancel_priced', 'cancel_no_money') THEN
        v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;
        IF v_action = 'cancel_priced' THEN
          -- poster_cancel_job's single-job pricing.
          v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
          -- Q1324: an admin confirming a fingerprint-match ban settles as of
          -- the ban (admin_confirm_ban_settlement sets the review's start, so
          -- the late-cancel fee is the one the ban would have charged); every
          -- other ban settles at once, as of now.
          IF NULLIF(current_setting('app.ban_settlement_as_of', true), '') IS NOT NULL THEN
            v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time,
                         current_setting('app.ban_settlement_as_of', true)::timestamptz);
          END IF;
          v_percent := public.cancellation_fee_percent(v_committed, v_hours);
          v_fee := CASE WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
                        THEN round(v_job.budget * v_percent) / 100.0 ELSE 0 END;
        END IF;

        UPDATE public.jobs
           SET status = 'cancelled',
               cancelled_by = NULL,
               cancelled_at = now(),
               cancellation_reason = v_reason,
               late_cancellation = CASE WHEN v_action = 'cancel_priced'
                                        THEN public.is_late_cancellation(v_committed, v_hours) ELSE false END,
               cancellation_fee = v_fee,
               cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END,
               direct_offer_status = CASE WHEN direct_offer_status = 'pending' THEN 'declined' ELSE direct_offer_status END,
               direct_offer_expires_at = CASE WHEN direct_offer_status = 'pending' THEN NULL ELSE direct_offer_expires_at END
         WHERE id = v_job.id
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.helper_id IS NOT NULL THEN
          v_cut := GREATEST(0, round((v_fee - round(v_fee * COALESCE(v_job.helper_fee_percent, 10)) / 100.0) * 100) / 100.0);
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.helper_id,
            CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
            CASE WHEN v_fee > 0 THEN
              format('"%s" was cancelled because %s. It was cancelled late, so you''ll receive about $%s as a cancellation fee, processed within the hour.',
                     v_title, v_gone, to_char(v_cut, 'FM999999990.00'))
            ELSE format('"%s" was cancelled because %s.', v_title, v_gone) END,
            CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        ELSIF v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending' THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.offered_to_helper_id,
            'Offer closed',
            format('"%s" was cancelled because %s, so its offer is closed.', v_title, v_gone),
            'warning',
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'reopen' THEN
        UPDATE public.applications
           SET status = 'rejected',
               closed_reason = 'party_blocked'
         WHERE job_id = v_job.id AND helper_id = p_user AND status = 'accepted';

        UPDATE public.jobs
           SET status = 'open',
               helper_id = NULL,
               response_deadline = NULL,
               helper_confirmed_at = NULL,
               helper_dayof_confirmed_at = NULL,
               helper_on_the_way_at = NULL,
               helper_arrived_at = NULL,
               dayof_confirm_reminder_sent_at = NULL,
               dayof_unanswered_poster_alert_sent_at = NULL,
               start_reminder_sent_at = NULL
         WHERE id = v_job.id
           AND helper_id = p_user
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.customer_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.customer_id,
            'Your job is open again',
            format('"%s" is open to everyone again because the person you hired can no longer use Louisiana Helpr. %s',
                   v_title,
                   CASE WHEN v_job.payment_status = 'escrow'
                        THEN 'Your payment stays protected in escrow for whoever you pick next.'
                        ELSE 'Pick someone new whenever you''re ready.' END),
            'warning',
            '/posts?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'hold_dispute' THEN
        INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
        VALUES (v_job.id, NULL, v_dispute_reason, '{}'::text[]);

        -- One statement, so set_dispute_deadline sees disputed_at on the flip.
        -- ESCALATED from the start: the 72h timeout never settles it.
        UPDATE public.jobs
           SET status = 'disputed',
               disputed_by = NULL,
               disputed_at = now(),
               dispute_reason = v_dispute_reason,
               dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status::text = v_job.status
           AND payment_status = 'escrow';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job on hold for review',
            format('"%s" is on hold because %s. Work had already started, so a person at Louisiana Helpr will review it and decide the payment. The money stays in escrow until then, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;
        v_admin_note := 'work had started when an account on it was banned, so the platform opened an ESCALATED dispute. Nothing pays out until an admin decides.';

      ELSIF v_action = 'escalate_dispute' THEN
        UPDATE public.jobs
           SET dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status = 'disputed'
           AND dispute_status IS DISTINCT FROM 'escalated';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
          v_admin_note := 'an account on this disputed job was banned. The dispute is escalated so the 72h timeout cannot settle it.';
        ELSE
          v_action := 'none_already_held';  -- escalated already: a re-run says nothing
        END IF;

      ELSIF v_action = 'admin_review' THEN
        v_admin_note := format('an account on it was banned and it could not be settled automatically (status %s, payment %s%s). Nothing on the job was changed, and any scheduled payout or refund still runs on schedule unless an admin steps in.',
                               v_job.status, COALESCE(v_job.payment_status, 'none'),
                               CASE WHEN v_job.is_group_job THEN ', crew' ELSE '' END);
        IF v_job.status IN ('open', 'pending_approval', 'accepted', 'in_progress', 'revision_requested')
           AND v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job under review',
            format('"%s": %s. A person at Louisiana Helpr will review this job, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action IN ('none_finished', 'none_settling', 'series_lane') THEN
        -- Nothing to do: finished, already cancelled with nothing owed to the
        -- banned account, or the recurring lane's.
        NULL;

      ELSE
        RAISE EXCEPTION 'unhandled ban settlement (seat %, status %, payment %)',
          v_seat, v_job.status, COALESCE(v_job.payment_status, 'none');
      END IF;

      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    EXCEPTION WHEN OTHERS THEN
      -- Only this job's writes roll back; the ban and every other job stand.
      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
      v_admin_note := format('an account on it was banned but settling it failed (%s: %s). Nothing was changed; settle it by hand.',
                             v_action, SQLERRM);
      v_action := 'failed';
      v_fee := 0;
    END;

    IF v_admin_note IS NOT NULL THEN
      -- Its own subtransaction: a failed alert never rolls back the ban.
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        SELECT r.user_id,
               'Banned account: job needs a decision',
               format('"%s": %s', v_title, v_admin_note),
               'admin_alert',
               '/admin?view=jobs&job=' || v_job.id::text,
               v_job.id
          FROM public.user_roles r
         WHERE r.role = 'admin';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ban settlement: admin alert for job % failed: %', v_job.id, SQLERRM;
      END;
    END IF;

    -- Only what this run did (or could not do) is reported; a job with
    -- nothing to settle is not, so a re-run reports nothing.
    IF v_action NOT LIKE 'none%' AND v_action <> 'series_lane' THEN
      v_out := v_out || jsonb_build_object('job_id', v_job.id, 'seat', v_seat, 'action', v_action, 'cancellation_fee', v_fee);
    END IF;
  END LOOP;

  -- Its own subtransaction: closing applications and offers can never roll
  -- back the ban or the jobs settled above.
  BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Pending applications FROM the banned account: closed silently.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
   WHERE a.helper_id = p_user
     AND a.status = 'pending';
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer TO the banned account: declined (the job reopens to
  -- everyone, as a declined offer does) and its poster told.
  FOR v_job IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.offered_to_helper_id = p_user
       AND j.direct_offer_status = 'pending'
       AND j.helper_id IS NULL
     ORDER BY j.id
       FOR UPDATE
  LOOP
    UPDATE public.jobs
       SET direct_offer_status = 'declined',
           direct_offer_expires_at = NULL
     WHERE id = v_job.id AND direct_offer_status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_closed_offers := v_closed_offers + 1;
      IF v_job.customer_id IS NOT NULL AND v_job.customer_id <> p_user THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          v_job.customer_id,
          'Offer closed',
          format('The person you offered "%s" to can no longer use Louisiana Helpr, so the offer is closed and the job is open to everyone again.',
                 COALESCE(v_job.title, 'your job')),
          'warning',
          '/posts?job=' || v_job.id::text,
          v_job.id
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    v_closed_apps := 0;
    v_closed_offers := 0;
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT r.user_id,
             'Banned account: applications need a look',
             format('Closing the banned account''s pending applications and offers failed (%s). Nothing was changed; close them by hand.', SQLERRM),
             'admin_alert',
             '/admin?view=users&user=' || p_user::text
        FROM public.user_roles r
       WHERE r.role = 'admin';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ban settlement: application/offer close failed for %: %', p_user, SQLERRM;
    END;
  END;

  RETURN jsonb_build_object(
    'settled', v_out,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;

-- ── 3a/3b. Q1411: the posts leave browse and take no new application ────────
-- Moved to 20261006042617_ban_review_hides_posts_on_crew_surfaces.sql: the
-- crew batch restated the same five objects first (20261006023437,
-- 20261006031016), so they are restated there from the crew-era bodies.
-- Announcements and saved-search alerts carry the same gate:

CREATE OR REPLACE FUNCTION public.job_announceable_to(p_job jobs, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- open_jobs_browse's WHERE for a recipient who is neither the poster nor
  -- the offered helper, with get_user_credential_tier(recipient) in place of
  -- my_credential_tier(). The early-access clock is NOT here: a caller that
  -- may queue asks early_access_visible_at() itself.
  SELECT COALESCE(
        p_user_id IS NOT NULL
    AND p_job.status = 'open'
    -- A series visit is re-offered only inside its series (20260927015010).
    AND p_job.parent_job_id IS NULL
    AND p_job.customer_id IS NOT NULL
    AND p_job.customer_id <> p_user_id
    AND COALESCE(p_job.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (p_job.offered_to_helper_id IS NULL
         OR COALESCE(p_job.direct_offer_status, 'pending') IN ('declined', 'expired'))
    AND (NOT COALESCE(p_job.is_seed, false) OR NOT public.seed_jobs_hidden_publicly())
    AND (COALESCE(p_job.credential_tier, 0) = 0
         OR COALESCE(public.get_user_credential_tier(p_user_id), 0) >= p_job.credential_tier)
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = p_job.customer_id AND q.review_state = 'open'),
    false);
$function$;


REVOKE ALL ON FUNCTION public.job_announceable_to(public.jobs, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_announceable_to(public.jobs, uuid) TO service_role;

-- Saved-search alerts spell the browse gate out (Q392), so they carry it too.
CREATE OR REPLACE FUNCTION public.deliver_saved_search_alert(p_user_id uuid, p_job_id uuid, p_search_name text, p_search_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_ids uuid[];
  v_title TEXT := 'New job matches your saved search';
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
  v_digest BOOLEAN;
BEGIN
  -- FOR SHARE: the job cannot be hired, cancelled or unfunded between this
  -- check and the send. NOWAIT: if a writer (the funding transaction, a hire)
  -- holds the row, this raises lock_not_available instead of waiting, and the
  -- sweep keeps the row for its next run. The sweep never waits on a job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The job must still be what open_jobs_browse shows this user: open,
  -- funded, not under a live direct offer, not a hidden fixture, not
  -- ownerless (the poster deleted their account), not the recipient's own,
  -- and not above the recipient's credential tier (the view's gate, with
  -- get_user_credential_tier(recipient) in place of my_credential_tier()).
  IF v_job.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010).
     OR v_job.parent_job_id IS NOT NULL
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NULL
     OR v_job.customer_id = p_user_id
     OR (COALESCE(v_job.credential_tier, 0) <> 0
         AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)
     -- Q1411: not while the poster is under an open ban settlement review.
     OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = v_job.customer_id AND q.review_state = 'open')
  THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient must still be verified, active and opted in to job matches.
  SELECT COALESCE(np.match_digest_mode, false)
    INTO v_digest
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
   WHERE p.user_id = p_user_id
     AND p.email_verified
     AND COALESCE(p.ban_status, 'active') = 'active'
     AND COALESCE(np.job_matches, true) IS TRUE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_is_urgent := COALESCE(v_job.is_urgent, false);

  -- Switched to the daily digest while this alert waited: batch it there.
  IF v_digest AND NOT v_is_urgent THEN
    INSERT INTO public.match_digest_queue (user_id, job_id)
    VALUES (p_user_id, p_job_id)
    ON CONFLICT (user_id, job_id) DO NOTHING;
    RETURN false;
  END IF;

  -- ST-011: the matched searches that still notify and are past the hourly
  -- throttle. None left means this alert is dropped, as a throttled match is.
  -- FOR UPDATE (in id order, so two sends cannot deadlock): a concurrent send
  -- for the same searches waits here, then re-reads last_notified_at after the
  -- first one's stamp commits and finds nothing left. Without the lock both
  -- read the old stamp and both send.
  SELECT ARRAY_AGG(x.id)
    INTO v_ids
    FROM (
      SELECT s.id
        FROM public.saved_searches s
       WHERE s.id = ANY(p_search_ids)
         AND s.user_id = p_user_id
         AND s.notify_enabled = true
         AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
       ORDER BY s.id
         FOR UPDATE
    ) x;
  IF v_ids IS NULL THEN
    RETURN false;
  END IF;

  -- ST-011: the throttle is spent only when the user is actually notified.
  UPDATE public.saved_searches
     SET last_notified_at = now()
   WHERE id = ANY(v_ids); -- ST-011 stamp on notify only

  v_link := '/home?job=' || v_job.id::text;
  v_message :=
    'A new job matches "' || p_search_name || '": '
    || v_job.title || ' ($' || v_job.budget || ')'
    || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link);

  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', v_title,
      'message', v_message,
      'type', 'job_match',
      'link', v_link
    )
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) TO service_role;

-- ── 4. An open review pages ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_open_ban_settlement_reviews()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r       record;
  v_open  integer := 0;
  v_paged integer := 0;
BEGIN
  FOR r IN
    SELECT q.id, q.user_id, q.matched_on, q.created_at, q.alerted_at
      FROM public.ban_settlement_queue q
     WHERE q.review_state = 'open'
     ORDER BY q.created_at
  LOOP
    v_open := v_open + 1;
    IF r.created_at < now() - interval '24 hours'
       AND (r.alerted_at IS NULL OR r.alerted_at < now() - interval '24 hours') THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('fatal',
              format('Ban settlement review open for %s hours (account %s, banned on a %s match). Its jobs and their escrow are frozen until an admin confirms or lifts it in the fraud console (docs/OPEN.md Q1324).',
                     floor(extract(epoch FROM now() - r.created_at) / 3600)::int, r.user_id, r.matched_on),
              jsonb_build_object('source', 'ban-settlement-review-open', 'area', 'money'),
              jsonb_build_object('user_id', r.user_id, 'review_id', r.id, 'opened_at', r.created_at));
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        SELECT ur.user_id,
               'Ban settlement review still waiting',
               format('An account banned on a %s match has waited %s hours. Its jobs and escrow are frozen until you confirm or lift the ban.',
                      r.matched_on, floor(extract(epoch FROM now() - r.created_at) / 3600)::int),
               'admin_alert',
               '/admin?view=fraud'
          FROM public.user_roles ur
         WHERE ur.role = 'admin';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ban review watch: admin alert failed: %', SQLERRM;
      END;
      UPDATE public.ban_settlement_queue SET alerted_at = now() WHERE id = r.id;
      v_paged := v_paged + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('open', v_open, 'paged', v_paged);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_open_ban_settlement_reviews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_open_ban_settlement_reviews() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('ban-review-watch', interval '3 hours',
            'Q1324: hourly, pages every ban settlement review left open over 24 hours (again every 24 hours).',
            'exempt',
            'No review waiting is the healthy state, so a run that changes nothing is not a silent failure. A stale review raises its own error_logs page.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('ban-review-watch', '23 * * * *',
                          $c$SELECT public.cron_record_work('ban-review-watch', to_jsonb(public.sweep_open_ban_settlement_reviews()));$c$);
  END IF;
END
$do$;

-- ── 5. The admin alerts close themselves (Q355) ──────────────────────────────
-- 'Ban settlement review…' titles get a close rule that re-asks the queue.
-- Both functions are their live bodies plus that one entry / branch.
CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.rule
    FROM (VALUES
      ('ban review needed',                         'ban-review'),
      ('identity verification needs review',        'idv-review'),
      ('user flagged',                              'reported-user'),
      ('dispute escalated',                         'dispute-open'),
      ('escalated dispute overdue',                 'dispute-open'),
      ('dispute stuck — escrow cannot auto-settle', 'dispute-open'),
      ('dispute split did not settle',              'dispute-unsettled'),
      ('job stalled — nobody marked it done',       'stalled-job'),
      ('stuck payment — webhook may be failing',    'stuck-payment'),
      ('payout blocked — ',                          'money-held'),
      ('scheduled payout failed',                   'money-held'),
      ('transfer failed',                           'money-held'),
      ('arrival not confirmed in ',                 'arrival-unconfirmed'),
      ('arrival near a wrong pin not confirmed',    'arrival-unconfirmed'),
      ('auto-restricted (',                         'restriction-review'),
      ('repeat offender: ',                         'repeat-offender'),
      ('low rating alert',                          'low-rating'),
      ('new member joined',                         'notice'),
      ('dispute auto-resolved',                     'notice'),
      -- Q1324: an account banned on a card / bank match waits for an admin.
      ('ban settlement review',                     'ban-settlement-review')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_queue_still_pending(p_rule text, p_ref jsonb, p_since timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (p_ref ->> 'user_id')::uuid;
  v_job  uuid := (p_ref ->> 'job_id')::uuid;
BEGIN
  IF p_rule = 'ban-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_violations v
       WHERE v.action_taken = 'pending_ban_review'
         AND (v.user_id = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = v.user_id AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'idv-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.idv_status = 'manual_review'
         AND (p.user_id = v_user OR p.is_seed IS NOT TRUE))
      OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = v_user
         AND p.idv_status = 'failed'
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = v_user::text
                            AND a.action IN ('manual_verify_user', 'idv_reject', 'request_id_reupload')
                            AND a.created_at > p_since));

  ELSIF p_rule = 'reported-user' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       CROSS JOIN LATERAL (
         SELECT CASE WHEN r.reported_type = 'user' THEN r.reported_id
                     ELSE (SELECT a.helper_id FROM public.applications a WHERE a.id = r.reported_id) END AS subject) s
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND r.reported_type IN ('user', 'application')
         AND s.subject IS NOT NULL
         AND (s.subject = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = s.subject AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'dispute-open' THEN
    -- The whole /admin?view=disputes queue (AdminDisputes.tsx): a job still
    -- 'disputed', or a decided dispute whose settlement has not executed
    -- ("Dispute stuck" is also sent for split_pending, a decided split).
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status = 'disputed'
         AND (j.id = v_job OR j.is_seed IS NOT TRUE))
      OR public.admin_queue_still_pending('dispute-unsettled', p_ref, p_since);

  ELSIF p_rule = 'dispute-unsettled' THEN
    -- AdminDisputes' unsettled read: decided, execution NULL or not 'executed'.
    RETURN EXISTS (
      SELECT 1 FROM public.disputes d
        LEFT JOIN public.jobs j ON j.id = d.job_id
       WHERE d.status = 'decided'
         AND coalesce(d.execution_status, '') <> 'executed'
         AND (d.job_id = v_job OR j.is_seed IS NOT TRUE));

  ELSIF p_rule = 'stalled-job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.job_completion_nudges n
        LEFT JOIN public.jobs j ON j.id = n.job_id
       WHERE n.escalated_at IS NOT NULL
         AND n.resolved_at IS NULL
         AND (n.job_id = v_job OR j.is_seed IS NOT TRUE));

  -- Q1324 (20261006030849): still pending while any ban settlement review is
  -- open; closes once every review is confirmed or lifted.
  ELSIF p_rule = 'ban-settlement-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.review_state = 'open');

  ELSIF p_rule = 'stuck-payment' THEN
    RETURN public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, p_since, false);

  -- Q355 part 2 (20260926035647): the posts that name no queue. Each asks
  -- about every subject the item was raised for (admin_alert_subjects).
  ELSIF p_rule = 'notice' THEN
    -- Informational: nothing to act on.
    RETURN false;

  ELSIF p_rule IN ('money-held', 'arrival-unconfirmed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.job_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.jobs j ON j.id = s.job_id
       WHERE j.is_seed IS NOT TRUE
         AND CASE p_rule
               WHEN 'money-held' THEN
                 j.payment_status IN ('escrow', 'payout_pending')
                 -- a group job released before every roster member was paid
                 OR (j.is_group_job IS TRUE AND j.payment_status = 'released'
                     AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                                  WHERE g.job_id = j.id AND g.helper_id IS NOT NULL
                                    AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                                                     WHERE pt.job_id = j.id AND pt.helper_id = g.helper_id
                                                       AND pt.status IN ('pending', 'paid'))))
               ELSE j.status IN ('accepted', 'in_progress')
                    AND j.helper_arrived_at IS NOT NULL
                    AND j.poster_confirmed_arrival_at IS NULL
             END);

  ELSIF p_rule IN ('restriction-review', 'repeat-offender', 'low-rating') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.user_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.profiles p ON p.user_id = s.user_id
       WHERE p.is_seed IS NOT TRUE
         -- a moderation DECISION on the person after the alert is the review
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = s.user_id::text
                            AND a.action IN ('set_ban_status', 'ban_user', 'unban_user', 'reverse_auto_ban',
                                             'reverse_violation', 'restrict_applications', 'formal_warning',
                                             'final_warning', 'auto_suspend_3_strikes', 'confirm_message_ban',
                                             'dismiss_message_ban_review')
                            AND a.created_at > s.alerted_at)
         AND CASE p_rule
               WHEN 'restriction-review' THEN
                 p.ban_status = 'temp_banned'
                 AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())
               WHEN 'repeat-offender' THEN
                 coalesce(p.ban_status, '') NOT IN ('banned', 'permanently_banned')
               ELSE EXISTS (SELECT 1 FROM public.user_violations v
                             WHERE v.user_id = s.user_id AND v.violation_type = 'low_ratings')
             END);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;
