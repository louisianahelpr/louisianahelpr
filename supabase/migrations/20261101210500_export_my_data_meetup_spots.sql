-- Download My Data includes the seller's own meet spots (owner 11-01 meet spots, 20261101194608; lead 2026-11-01:
-- "those are the seller's own saved places, so they're the member's data"; for verdict lh-authz-rls).
--
-- WHY: declutter_meetup_spots.seller_id (20261101194608) is a person column the export did not carry
-- (src/test/dataExportCoversEveryUserTable.test.ts).
--
-- WHAT: export_my_data restated from the NEWEST CREATE (20261101140006_export_my_data_instant_book.sql) VERBATIM,
-- with ONE new section after declutter_seller_porch_days: declutter_meetup_spots, the member's own spots only
-- (t.seller_id = v_uid), active or removed, minus created_by (an admin's id on a public spot; never set on a
-- seller's own). Same (uuid) overload, same search_path, EXECUTE for service_role only. Replay-safe:
-- DROP IF EXISTS / CREATE OR REPLACE.
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
  v_out := v_out || jsonb_build_object('push_subscriptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'endpoint' - 'p256dh' - 'auth'), '[]'::jsonb) FROM public.push_subscriptions t
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
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
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
        OR t.agreed_poster_id = v_uid OR t.agreed_helper_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
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
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'drop_stop_cents'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  -- Remembered listing choices (20261030144112): the seller's own row.
  v_out := v_out || jsonb_build_object('declutter_seller_defaults', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_defaults t
      WHERE t.member_id = v_uid));
  -- Porch days (20261029161347): the seller's own picked porch weekdays (one row per seller).
  v_out := v_out || jsonb_build_object('declutter_seller_porch_days', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_porch_days t
      WHERE t.seller_id = v_uid));
  -- Meet spots (20261101194608): the seller's own saved public meeting places (seller_id = the member), without
  -- created_by (an admin's id on a public spot).
  v_out := v_out || jsonb_build_object('declutter_meetup_spots', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by' ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_meetup_spots t
      WHERE t.seller_id = v_uid));
  -- Q2278 (lead ruling 2026-10-21): who asked is never shown to another member, the seller included. The asker's own
  -- questions keep asker_id; on the caller's items, others' questions come without it (the caller's answers stay theirs).
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.asker_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'asker_id' END), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  -- Q2274: on the SELLER's side, an offer the buyer never took into a cart carries no buyer_id (an "I have this" answer to a
  -- Wanted post, or any offer the buyer made, never names the buyer to the seller before a deal; declutter_my_offers
  -- returns no counterparty id either). The buyer's own rows are unchanged.
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.seller_id = v_uid AND t.buyer_id IS DISTINCT FROM v_uid AND t.status <> 'accepted'
                  THEN to_jsonb(t) - 'buyer_id' ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  -- The Free change (20261030064021): the member's asks for free items (as asker or giver) and their 30-day pause.
  v_out := v_out || jsonb_build_object('declutter_free_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_free_requests t
      WHERE t.requester_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_free_pauses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_free_pauses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  -- Problems the OTHER side of the member's order reported about them (RLS
  -- already lets both sides read a problem). Without the reporter's private
  -- fields: who reported it (reporter_id), the reporter's photo paths, and
  -- which admin decided (decided_by, never exported).
  v_out := v_out || jsonb_build_object('declutter_problems_about_me', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by' - 'reporter_id' - 'photo_paths'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id IS DISTINCT FROM v_uid
        AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
                     AND (o.buyer_id = v_uid OR o.seller_id = v_uid))));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Declutter wanted posts (20261016053541). The match ledger holds no person
  -- column; a seller's alerts are in 'notifications' above.
  v_out := v_out || jsonb_build_object('declutter_wanted', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_wanted t
      WHERE t.user_id = v_uid));

  -- Slice 5, Helpr delivery (20261017055505): the Helpr's vehicle, the
  -- deliveries the member made as the Helpr (area words only: the buyer's and
  -- the seller's exact addresses, points and ids, the drop-off code and the
  -- staff close note belong to them or to us, not the Helpr),
  -- the steps they took on any delivery, their delivery pay (the Stripe transfer
  -- id is ours), and the drop-off addresses they typed as a buyer.
  v_out := v_out || jsonb_build_object('helpr_vehicles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_vehicles t
      WHERE t.user_id = v_uid));
  -- B52 (20261101025001): also the deliveries the member was released from (helpr_tasks.released_helpr_id, 20261101020052),
  -- each row once. A row the member is on: as before, without the released Helpr's id when it names someone else. A row
  -- the member was only RELEASED from (lead 10-31): only what is about their part (which delivery and item), never its
  -- status, times or anything set after they left, which is the next Helpr's progress. Their own steps, pay and
  -- strikes on it are in helpr_task_events (actor_id), helpr_task_payouts and their strikes.
  v_out := v_out || jsonb_build_object('helpr_tasks', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.helpr_id = v_uid
          THEN to_jsonb(t) - 'dropoff_code' - 'pickup_address' - 'pickup_lat' - 'pickup_lng'
             - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' - 'customer_id' - 'pickup_contact_id' - 'close_note'
             - CASE WHEN t.released_helpr_id IS DISTINCT FROM v_uid THEN 'released_helpr_id' ELSE '' END
          ELSE jsonb_build_object('id', t.id, 'source_kind', t.source_kind, 'source_id', t.source_id, 'title', t.title,
                 'created_at', t.created_at, 'released_helpr_id', t.released_helpr_id, 'released_from_you', true)
        END), '[]'::jsonb) FROM public.helpr_tasks t
      WHERE t.helpr_id = v_uid OR t.released_helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_events t
      WHERE t.actor_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.helpr_task_payouts t
      WHERE t.helpr_id = v_uid));
  -- Q2453 (20261028014848): tips on deliveries, the member's as the buyer who tipped or the Helpr tipped (both
  -- see the tip in the app, as job tips).
  v_out := v_out || jsonb_build_object('helpr_task_tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_tips t
      WHERE t.tipper_id = v_uid OR t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_dropoffs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_dropoffs t
      WHERE t.buyer_id = v_uid));
  -- Declutter seller delivery (20261027153244): the seller's setting, delivery windows, days off and the items
  -- they switched delivery off for; each delivery the member is a side of. The drop-off address and point are
  -- the BUYER's, so they leave a seller's copy (as declutter_delivery_dropoffs is never the seller's), and a
  -- seller's copy of a checkout that was never paid ('held' / 'released') carries only its order, status and
  -- time, nothing of the buyer's (lh-authz-rls review #1).
  v_out := v_out || jsonb_build_object('declutter_seller_delivery', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_delivery t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_days_off', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_days_off t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_no_seller_delivery', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_no_seller_delivery t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_deliveries', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.buyer_id = v_uid THEN to_jsonb(t)
             WHEN t.status IN ('held', 'released') THEN jsonb_build_object('order_id', t.order_id, 'status', t.status, 'created_at', t.created_at)
             ELSE to_jsonb(t) - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' END), '[]'::jsonb) FROM public.declutter_seller_deliveries t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  -- Q2450 Helpr Guarantee (20261027200455): each request on a job the member posted or worked. Both sides see the
  -- whole request in the app (the note, photos, dates and answers), so both get it whole.
  v_out := v_out || jsonb_build_object('job_guarantee_claims', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_guarantee_claims t
      WHERE t.poster_id = v_uid OR t.helper_id = v_uid));
  -- Q2425 / Q2451 safe meetup spots (20261027204500): the buyer's own pick of a spot per seller (the seller never
  -- sees a pick before checkout, so a seller's export carries none), and the meeting spot of every order the member
  -- is a side of (a snapshot of the public place, never a home address; both sides see it on the order).
  v_out := v_out || jsonb_build_object('declutter_meetup_choices', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_meetup_choices t
      WHERE t.buyer_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_order_meetups', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_order_meetups t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- Q2427 bundle discounts (20261027211754): the seller's own "Buy 2+, get N% off" setting.
  v_out := v_out || jsonb_build_object('declutter_bundle_rules', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bundle_rules t
      WHERE t.seller_id = v_uid));

  -- Shops slice 1 (20261017061155) and slice 2 (20261017061157): the
  -- member's own shop (who checked its registration and who hid it are staff
  -- ids, dropped; the hide reason is about them and stays), photo paths, the shops they follow, their items and item photos, the item
  -- review state (the AI and word-check reasons are staff-only, dropped; the
  -- admin's note stays), the confirmations they ticked, and the home-food
  -- yearly confirmations and counted sales. Opening hours (shop_hours) carry
  -- no person column and are public on the shop page, so they stay out, as
  -- every table without one does.
  v_out := v_out || jsonb_build_object('shops', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'sos_verified_by' - 'hidden_by'), '[]'::jsonb) FROM public.shops t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_follows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_follows t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_items t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'text_flag_reason'), '[]'::jsonb) FROM public.shop_item_private t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_attestations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_confirmations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_confirmations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_sales', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_sales t
      WHERE t.owner_id = v_uid));

  -- Rentals S1 (20261017205605): the caller's properties, units, tenancies
  -- (as landlord or tenant), maintenance requests and their photos.
  v_out := v_out || jsonb_build_object('rental_properties', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ownership_reviewed_by'), '[]'::jsonb) FROM public.rental_properties t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_units', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_units t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_tenancies', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'invite_token_sha256'), '[]'::jsonb) FROM public.rental_tenancies t
      WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_requests t
      WHERE t.tenant_id = v_uid OR t.landlord_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_request_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_request_photos t
      WHERE t.tenant_id = v_uid));

  -- Shops M1 (20261018164442): the member's orders as buyer or as the shop
  -- (both sides were shown the whole order: lines, date, note, money), and
  -- the lines of those orders. The Stripe ids and the capture / hold-release
  -- error text are internal, dropped.
  v_out := v_out || jsonb_build_object('shop_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id' - 'capture_last_error' - 'hold_release_last_error'), '[]'::jsonb) FROM public.shop_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_order_lines', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_order_lines t
      WHERE t.order_id IN (SELECT o.id FROM public.shop_orders o WHERE o.buyer_id = v_uid OR o.seller_id = v_uid)));
  -- The member's Shops strikes (20261018164444; the staff member who removed
  -- one is dropped, as for declutter_strikes). That migration sorts AFTER this
  -- one, so the section is skipped until the table exists: Download My Data
  -- never fails with 42P01 in between (both reviews of the strikes change).
  IF to_regclass('public.shop_strikes') IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('shop_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by'), '[]'::jsonb) FROM public.shop_strikes t
      WHERE t.user_id = v_uid));
  END IF;
  -- Shops M1b part 2 (20261018210400): the member's own shop's private pickup
  -- address. The Stripe Tax location id and its mode are internal, dropped.
  -- Only the owner's own row: a buyer was shown the address on an accepted
  -- order, but it is the shop owner's personal data, not the buyer's.
  v_out := v_out || jsonb_build_object('shop_pickup_addresses', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_tax_location_id' - 'stripe_tax_location_mode'), '[]'::jsonb) FROM public.shop_pickup_addresses t
      WHERE t.owner_id = v_uid));
  -- Homes -> Rent listings (20261019043000): the member's own listings (every
  -- field they typed, incl. the wording-check result) and their photos.
  v_out := v_out || jsonb_build_object('rental_listings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listings t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_listing_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_listing_photos t
      WHERE t.owner_id = v_uid));
  -- Q2082 (b): the Helpr's own Helpr-fault rulings (20261019015301), without
  -- the staff member who ruled (admin_id) or the poster's Stripe refund id
  -- (refund_ref, the other party's payment). The ruling's note IS theirs
  -- (why they were ruled at fault), so it is exported. The table exists from that
  -- migration on, which always runs first.
  v_out := v_out || jsonb_build_object('helpr_fault_rulings', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id' - 'refund_ref'), '[]'::jsonb) FROM public.job_helpr_fault_rulings t
    WHERE t.helper_id = v_uid));
  -- Landlord ID (20261019051407): the member's own ID review (status, dates,
  -- the admin's note). Which admin reviewed it (reviewed_by) is staff-only and
  -- dropped. The photo paths stay in the row: the export function signs every
  -- object still in the member's user-documents folder, so a photo not yet
  -- past retention comes as a signed link, never as bytes in this JSON.
  v_out := v_out || jsonb_build_object('landlord_id_reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by'), '[]'::jsonb) FROM public.landlord_id_reviews t
    WHERE t.user_id = v_uid));
  -- Homes rent tracker (20261019073106) and deposit tracker (20261019082216): the rent schedule, charges,
  -- payments and deposit of every tenancy the member is a side of (landlord or tenant). These tables are keyed
  -- by tenancy, not by a person. The landlord gets the tenant's forwarding address only once the tenancy has
  -- ended AND the tenant ended it or the lease end date passed (the same rule as rentals_deposit).
  v_out := v_out || jsonb_build_object('rental_rent_plans', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_plans t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_charges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_charges t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_rent_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_rent_payments t
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  v_out := v_out || jsonb_build_object('rental_deposits', (SELECT coalesce(jsonb_agg(
      CASE WHEN x.tenant_id = v_uid
                OR (x.status = 'ended' AND (x.ended_by = 'tenant' OR (x.lease_ends_on IS NOT NULL AND x.lease_ends_on <= public.shop_local_today())))
           THEN to_jsonb(t) ELSE to_jsonb(t) - 'forwarding_address' END), '[]'::jsonb)
      FROM public.rental_deposits t JOIN public.rental_tenancies x ON x.id = t.tenancy_id
    WHERE t.tenancy_id IN (SELECT tn.id FROM public.rental_tenancies tn WHERE tn.landlord_id = v_uid OR tn.tenant_id = v_uid)));
  -- Homes lease (20261019110137): every lease the member is a party to (landlord_id / tenant_id are kept on
  -- the lease, so a signed one is exported after its tenancy or the other account is gone). A draft's blanks
  -- go to the landlord only; the tenant gets the draft's status and their own change note.
  v_out := v_out || jsonb_build_object('rental_leases', (SELECT coalesce(jsonb_agg(
      CASE WHEN t.landlord_id = v_uid OR t.status <> 'draft' THEN to_jsonb(t)
           ELSE jsonb_build_object('tenancy_id', t.tenancy_id, 'status', t.status, 'change_request', t.change_request) END), '[]'::jsonb)
      FROM public.rental_leases t
    WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_homes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_homes t
      WHERE t.user_id = v_uid));
  -- Board 143a (20261021030052): the member's own bank payout failures (user_id = the member).
  v_out := v_out || jsonb_build_object('payout_failures', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.payout_failures t
      WHERE t.user_id = v_uid));
  -- Board 141 (20261021102943): every refund request the member asked, was asked, or answered.
  v_out := v_out || jsonb_build_object('refund_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.refund_requests t
      WHERE t.requester_id = v_uid OR t.responder_id = v_uid OR t.answered_by = v_uid));
  -- SMS alerts (20261021193738): the member's text consent (number, opt-in and
  -- opt-out times and sources), every consent event, and every text considered
  -- for them (kind, status, reason, times; no phone or body is stored there).
  -- confirm_* and updated_at are left out for the same reason: they move
  -- only when a confirmation was really sent, which a number in use
  -- elsewhere never is (and confirm_code is a live secret).
  v_out := v_out || jsonb_build_object('sms_consent', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at'), '[]'::jsonb) FROM public.sms_consent t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('sms_consent_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.sms_consent_events t
      WHERE t.user_id = v_uid));
  -- A confirmation row keeps only that one was considered: its status and
  -- reason would say whether the number is used on another account
  -- (lh-authz-rls review of the SMS slice).
  v_out := v_out || jsonb_build_object('sms_messages', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at)
             ELSE to_jsonb(t) END), '[]'::jsonb) FROM public.sms_messages t
      WHERE t.user_id = v_uid));
  -- Board 141, Declutter side (20261026155251): refund requests on the member's own sales, buyer or seller.
  v_out := v_out || jsonb_build_object('declutter_refund_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_refund_requests t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- Q2462 (20261028235249): the member's handover talks, buyer or seller, and every message in them (both people
  -- wrote to each other in the app; each sees the whole talk there).
  v_out := v_out || jsonb_build_object('declutter_handover_talks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_handover_talks t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_handover_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_handover_talk_messages t
      WHERE t.sender_id = v_uid OR t.talk_id IN (SELECT h.id FROM public.declutter_handover_talks h WHERE h.buyer_id = v_uid OR h.seller_id = v_uid)));
  -- D2-1 (20261030004216): the member's paid-order chats, buyer or seller of the order, and every message in them
  -- (each side sees the whole chat in the app), plus any message the member sent.
  v_out := v_out || jsonb_build_object('declutter_order_talks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_order_talks t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  v_out := v_out || jsonb_build_object('declutter_order_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_order_talk_messages t
      WHERE t.sender_id = v_uid OR t.talk_id IN (SELECT ot.id FROM public.declutter_order_talks ot JOIN public.declutter_orders o ON o.id = ot.order_id
                                                  WHERE v_uid IN (o.buyer_id, o.seller_id))));
  -- BUY-36 (the delivery chat): what the member wrote in a delivery's chat. (B36: this line sat inside the statement above.)
  v_out := v_out || jsonb_build_object('helpr_task_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.helpr_task_talk_messages t WHERE t.sender_id = v_uid));
  -- Q1866 (20261015091114, the 'quotes' switch): the member's quote requests as the poster, their own quotes as the
  -- quoter, the quotes on their requests WITHOUT the quoter's id or photos (another member's details), and every
  -- counter-offer on a quote the member is a side of.
  v_out := v_out || jsonb_build_object('job_quote_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_quote_requests t
      WHERE t.poster_id = v_uid));
  v_out := v_out || jsonb_build_object('job_quotes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_quotes t
      WHERE t.quoter_id = v_uid));
  v_out := v_out || jsonb_build_object('job_quotes_on_my_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'quoter_id' - 'photo_paths'), '[]'::jsonb) FROM public.job_quotes t
      WHERE t.quoter_id IS DISTINCT FROM v_uid AND t.request_id IN (SELECT r.id FROM public.job_quote_requests r WHERE r.poster_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_quote_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_quote_offers t
      WHERE t.quote_id IN (SELECT q.id FROM public.job_quotes q JOIN public.job_quote_requests r ON r.id = q.request_id WHERE q.quoter_id = v_uid OR r.poster_id = v_uid)));
  -- D-NEW14 (20261030164712): the seller's own pickup places with their addresses; the buyer's own pick; the place
  -- frozen on each order the member is a side of, its address and point to the seller only.
  v_out := v_out || jsonb_build_object('declutter_porch_places', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_porch_places t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_porch_place_choices', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_porch_place_choices t
      WHERE t.buyer_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_order_porch_places', (SELECT coalesce(jsonb_agg(
             CASE WHEN t.seller_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'address' - 'lat' - 'lng' - 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  -- The half-finished job post on this account (OPS-3): the member's own words.
  v_out := v_out || jsonb_build_object('job_post_drafts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_post_drafts t
             WHERE t.user_id = v_uid));
  -- Where this account came from (OPS-5, 20261031220447): the two cleaned words of the link that brought the member,
  -- kept once at sign-up. The member's own row only (LEAD-EXPORT-SIGNUP-SOURCE).
  v_out := v_out || jsonb_build_object('member_signup_sources', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'source', t.source, 'campaign', t.campaign, 'recorded_at', t.recorded_at)), '[]'::jsonb) FROM public.member_signup_sources t
             WHERE t.user_id = v_uid));

  -- LEAD-PROFILE-LINK (20261101034834): the profile links this member used before, kept so old links still find them.
  v_out := v_out || jsonb_build_object('profile_handles_retired', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'handle', t.handle, 'retired_at', t.retired_at)), '[]'::jsonb) FROM public.profile_handles_retired t
             WHERE t.user_id = v_uid));

  -- CMP-4 instant book (20261101063725, 20261101065105): the member's own auto-accept floors, and the jobs they said
  -- they can't make. Their own rows only (helper_id = the member).
  v_out := v_out || jsonb_build_object('instant_book_floors', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'category', t.category, 'floor_cents', t.floor_cents, 'created_at', t.created_at, 'updated_at', t.updated_at)
             ORDER BY t.category::text), '[]'::jsonb) FROM public.instant_book_floors t
             WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_book_declines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'job_id', t.job_id, 'reason', t.reason, 'declined_at', t.declined_at) ORDER BY t.declined_at), '[]'::jsonb)
             FROM public.instant_book_declines t
             WHERE t.helper_id = v_uid));

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
