-- Q1206 (docs/OPEN.md): a flagged offer message was hidden only on screen.
--
-- Read live 2026-10-04: scan_application_contact_info (md5(prosrc)
-- ab63320ad4b2dd4cdf236da2392ab47a = 20260907005738) sets ONE flag,
-- flagged_hidden, when EITHER the applicant's note (message) or the poster's
-- offer_message leaks contact details, and leaves both texts in place. So:
--   * the withheld text still reached the other party's client (the app only
--     drew a "hidden" notice over it; any reader of the row had the words);
--   * one flag hid both directions: a flagged note also hid the poster's
--     clean offer message from the Helpr, and the other way round.
-- Live: 49 applications, 0 flagged, 0 with an offer message, so nothing to
-- backfill. Legitimate senders never reach this: both send dialogs run the
-- same scan before sending (ApplyBody, ResponseDeadlineDialog); only a stale
-- client or a direct write is flagged here.
--
-- Fix:
--   1. One flag per direction: flagged_hidden stays the applicant's note;
--      offer_message_flagged_hidden is new, for the poster's offer message.
--   2. A flagged text is moved out of the column every client reads into a
--      server-only column (message_withheld, offer_message_withheld) and the
--      readable column is set NULL. authenticated holds no grant on either new
--      text column (applications SELECT is column-granted since Q1232), so no
--      client read can carry the words; the flag says why the text is absent.
--      Each direction is re-judged only by the trigger for its own column
--      (three triggers: INSERT, UPDATE OF message, UPDATE OF offer_message),
--      so a write of the other direction never un-flags it and an explicit
--      NULL clears a withheld text.
--   3. export_my_data: the applicant's own rows drop the poster's withheld
--      offer text; the poster's branch carries their own withheld text and
--      flag. Restated from its newest definition, 20261004191007 (Q1232), with
--      those two changes only.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE; grants restated.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS offer_message_flagged_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message_withheld text,
  ADD COLUMN IF NOT EXISTS offer_message_withheld text;

COMMENT ON COLUMN public.applications.offer_message_flagged_hidden IS
  'Q1206: the poster''s offer_message matched contact_leak_reason(); its text is in offer_message_withheld (server-only). flagged_hidden is the applicant''s note.';
COMMENT ON COLUMN public.applications.message_withheld IS
  'Q1206: the applicant''s flagged note, kept out of every client read (no grant to authenticated).';
COMMENT ON COLUMN public.applications.offer_message_withheld IS
  'Q1206: the poster''s flagged offer message, kept out of every client read (no grant to authenticated).';

-- The flag is readable; the two text columns get no grant at all. Since Q1009,
-- Q1232 and Q1234 no client role holds table-level SELECT, INSERT or UPDATE on
-- applications, so a column nobody grants is a column no client can read or
-- write (src/test/applicationFlagWithheld.test.ts replays it).
GRANT SELECT (offer_message_flagged_hidden) ON public.applications TO authenticated;

CREATE OR REPLACE FUNCTION public.scan_application_contact_info()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir    text := coalesce(TG_ARGV[0], 'both');
  r_note   text;
  r_offer  text;
BEGIN
  -- Each direction is judged on its own, and only by the trigger for its own
  -- column (UPDATE OF message -> 'note', UPDATE OF offer_message -> 'offer';
  -- on INSERT both). That trigger fires only when its column is in the
  -- statement's SET list, so the value judged is exactly what was written:
  -- an explicit NULL is a clear and drops the withheld copy, and a write of
  -- the OTHER direction never touches this one.
  IF v_dir IN ('both', 'note') THEN
    r_note := public.contact_leak_reason(NEW.message);
    IF r_note IS NOT NULL THEN
      NEW.flagged_hidden   := true;
      NEW.message_withheld := NEW.message;
      NEW.message          := NULL;
    ELSE
      -- Clear on edit: a corrected (or cleared) note un-flags itself.
      NEW.flagged_hidden   := false;
      NEW.message_withheld := NULL;
    END IF;
  END IF;

  IF v_dir IN ('both', 'offer') THEN
    r_offer := public.contact_leak_reason(NEW.offer_message);
    IF r_offer IS NOT NULL THEN
      NEW.offer_message_flagged_hidden := true;
      NEW.offer_message_withheld       := NEW.offer_message;
      NEW.offer_message                := NULL;
    ELSE
      NEW.offer_message_flagged_hidden := false;
      NEW.offer_message_withheld       := NULL;
    END IF;
  END IF;

  -- The moderation note: the applicant's reason first, as before. Read from
  -- the withheld columns, which hold exactly the texts that are flagged now.
  NEW.flag_reason := COALESCE(public.contact_leak_reason(NEW.message_withheld),
                              public.contact_leak_reason(NEW.offer_message_withheld));

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.scan_application_contact_info() FROM PUBLIC, anon, authenticated;

-- One trigger per write path (lh-authz-rls review 2026-10-04: with one
-- trigger for both columns, an applicant's explicit NULL could not clear a
-- withheld note, because the function could not tell "set to NULL" from "not
-- written" and re-judged the withheld copy).
DROP TRIGGER IF EXISTS applications_scan_contact_info ON public.applications;
CREATE TRIGGER applications_scan_contact_info
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info('both');
DROP TRIGGER IF EXISTS applications_scan_contact_info_note ON public.applications;
CREATE TRIGGER applications_scan_contact_info_note
  BEFORE UPDATE OF message ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info('note');
DROP TRIGGER IF EXISTS applications_scan_contact_info_offer ON public.applications;
CREATE TRIGGER applications_scan_contact_info_offer
  BEFORE UPDATE OF offer_message ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info('offer');

-- The no-argument door stays closed (Q408), as in every restatement.
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
