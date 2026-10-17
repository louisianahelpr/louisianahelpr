-- Class check (Q140): a NULL argument never makes an allow/validity check say
-- yes. Returns one row per problem as `fn|shape|detail`; ZERO ROWS = CLEAN.
--
-- Why: helper_credential_document_ok / credential_document_path_ok were chains
-- of `IF <cond> THEN RETURN false` ending in `RETURN EXISTS(...)`. A NULL kind
-- made every condition NULL, plpgsql skipped them all, and the function said
-- TRUE for another member's real document (live, 2026-09-23). The same sweep
-- found check_dispute_velocity(NULL) = TRUE, identity_is_verified(NULL, false)
-- = NULL and job_is_funded(NULL) = NULL. 20260923123701 fixed all five.
--
-- INVENTORY = pg_proc: every function in public returning boolean. Each must be
-- classified below, exactly (an unclassified or stale entry is a row):
--   allow    TRUE grants access / says "valid". For every argument there is a
--            case: a call that returns TRUE on the fixture below, which must
--            return exactly FALSE (not NULL, not TRUE) with that argument NULL.
--            NULL is not false: `IF NOT f(x) THEN RAISE` skips on NULL.
--   absent   allow-shaped, but NULL means "no value supplied" and is valid by
--            design; say why.
--   deny     TRUE refuses / blocks / suppresses, so TRUE for NULL fails safe.
--   classify labels a row (seed? taxable? late?); no access decision.
--   noarg    no argument to NULL.
--   action   VOLATILE: an RPC that does something and reports success. Not
--            called here (it would write).
--
-- Every case runs inside ONE transaction on throwaway fixture rows and the
-- script ends in ROLLBACK. It writes to a replayed CI database only: never run
-- it against prod (the live twin is a read-only probe on real rows,
-- ~/.lh-shots/q140/probe.mjs, see docs/OPEN.md Q140).
--
-- Shared by:
--   .github/workflows/db-smoke.yml   replayed schema (deploy gate)
--   src/test/nullArgNeverAllows.test.ts  pins the classification + wiring

\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE q140_out (fn text, shape text, detail text) ON COMMIT DROP;

CREATE TEMP TABLE q140_class (fn text PRIMARY KEY, kind text NOT NULL, why text NOT NULL) ON COMMIT DROP;
INSERT INTO q140_class (fn, kind, why) VALUES
  ('can_message_in_job',            'allow',    'may this sender post in this job'),
  ('can_read_job_access_notes',     'allow',    'may the caller read this job''s access and parking notes (Q1461)'),
  ('can_read_job_detail_change',    'allow',    'may the caller read this detail-change request and its answers (Q1254)'),
  ('can_review_job',                'allow',    'may this party review this job'),
  ('can_send_message_in_job',       'allow',    'may the caller post in this job'),
  ('can_send_message_to_in_job',    'allow',    'may the caller message this receiver'),
  ('check_dispute_velocity',        'allow',    'TRUE = under the dispute limit (no fraud flag)'),
  ('credential_document_path_ok',   'allow',    'profile credential URL is the member''s own object'),
  ('dispute_evidence_url_ok',       'allow',    'evidence URL is the uploader''s own object for this job'),
  ('feature_enabled_for',           'allow',    'hidden feature switch is on for the caller (20261012031120)'),
  ('rentals_caller_is_active_tenant_of','allow', 'is the caller an active tenant of this property (Rentals S1 read policies, 20261017061457)'),
  ('feature_enabled_for_user',      'allow',    'hidden feature switch is on for this user (service_role, edge functions)'),
  ('has_pre_verification_wipe',     'noarg',    'reads auth.uid() only: was this caller''s unfinished profile wiped (Q1286 notice)'),
  ('has_role',                      'allow',    'user holds role (admin gates)'),
  ('helper_credential_document_ok', 'allow',    'helper_credentials document is the member''s own object'),
  ('helper_has_advanced_analytics', 'allow',    'caller''s own paid-tier entitlement'),
  ('identity_is_verified',          'allow',    'identity badge / hire gate verdict'),
  ('is_party_to_job',               'allow',    'user is a party to the job'),
  ('is_party_to_job_folder',        'allow',    'caller is a party to the job owning this storage folder'),
  ('is_crew_member_of_job_folder',  'allow',    'caller is on the crew of the job owning this storage folder (Q407)'),
  ('job_announceable_to',           'allow',    'job may be announced to this user (Q392: open_jobs_browse gate per recipient)'),
  ('job_is_funded',                 'allow',    'job escrow is funded (applications WITH CHECK)'),
  ('job_payment_is_funded',         'allow',    'payment_status counts as funded (award + apply gates)'),
  ('user_has_pending_application',  'allow',    'user applied to the job'),
  ('user_may_see_job_address',      'allow',    'user may see the exact job address'),
  ('is_series_party',               'allow',    'user is on the recurring series (reads its holds, offers, releases; 20260927012806)'),
  ('is_safe_media_url',             'absent',   'NULL = no URL stored; nothing to render (nullable avatar_url CHECK)'),
  ('are_safe_media_urls',           'absent',   'NULL = no photo list stored (nullable jobs.photos / portfolio_urls CHECK)'),
  ('are_users_blocked',             'deny',     'TRUE refuses the interaction'),
  ('declutter_member_out',          'deny',     'TRUE = banned or 3 Declutter strikes: the trade is refused (20261014210518)'),
  ('declutter_seller_hidden',       'deny',     'TRUE hides a seller''s Declutter listings (20261014210518)'),
  ('declutter_in_agreed_sale',      'allow',    'TRUE = this member is a side of an agreed sale (in a cart or paid) on this item: may read its pickup details (20261015042253)'),
  ('declutter_slot_in_windows',     'allow',    'TRUE = a 30-minute pickup slot at this time fits one of this seller''s windows: the booking is valid (20261015042253)'),
  ('declutter_refund_set_mode',     'action',   'VOLATILE: records a Declutter refund''s Stripe mode once and returns it (service only; 20261015042253)'),
  ('declutter_has_agreed_sales',    'noarg',    'reads auth.uid() only: does the caller have a Declutter sale in flight (row 62; 20261014224914)'),
  ('declutter_retire_order',        'action',   'VOLATILE: retires an unpaid order whose Stripe page timed out and reports whether it did (service only; a NULL argument matches no order and answers FALSE; 20261014224914)'),
  ('declutter_seller_out',          'deny',     'TRUE = the seller cannot sell now (out, under 18, business-like): refused (20261014210518)'),
  ('is_helper_shadowbanned',        'deny',     'TRUE hides the helper'),
  ('is_submitted_credential_object','deny',     'TRUE freezes the object (storage UPDATE/DELETE policies use NOT)'),
  ('is_thread_muted',               'deny',     'TRUE suppresses the notification'),
  ('is_off_job',                    'deny',     'TRUE: the person is off the job, so messaging on it closes both ways (can_message_in_job / can_send_message_to_in_job use NOT; Q419/Q420)'),
  ('member_under_18',               'deny',     'TRUE refuses Apply/Post (apply_to_job, refuse_under_18_member; Q1586(c)); NULL or no birthday is FALSE by design: the sign-up 18+ box is the requirement (owner 2026-10-13), and a NULL uid is a server writer with no member session'),
  ('job_posted_by_seed',            'deny',     'TRUE exempts a test poster''s job from the step-order and repost rules; NULL customer -> false (judged)'),
  ('job_has_crew',                  'deny',     'TRUE locks a job''s date and start time to clients (20260927012805)'),
  ('admin_notification_crosses_seed_boundary','deny', 'TRUE: the admin client skips the notification (Q157)'),
  ('notification_crosses_seed_boundary','deny', 'TRUE suppresses the notification'),
  ('seed_hidden_for',               'deny',     'TRUE hides test rows from that user (Q552); a NULL user is not an enrolled test account, so it is hidden from (fails safe)'),
  ('seed_review_hidden',            'deny',     'TRUE hides a test-account review from the caller (Q552)'),
  ('error_log_is_seed',             'classify', 'labels an error_logs row as seed traffic'),
  ('is_category_taxable',           'classify', 'labels an earnings export row Taxable/Exempt'),
  ('is_late_cancellation',          'classify', 'labels a cancellation late (fee ladder)'),
  ('is_seed_email',                 'classify', 'labels an address as a seed account'),
  ('is_user_error_screen_row',      'classify', 'labels an error_logs row as a user-facing error screen'),
  ('get_thread_counterparty_deleted', 'classify', 'labels a thread''s other party as a deleted account (read-only notice); grants no access (it discloses one bit, account gone vs exists, see its migration), and a NULL argument returns false (threadCounterpartyDeleted.pglite.mjs)'),
  ('user_error_screen_is_real',     'classify', 'labels an error screen as real-user (ops alert counting)'),
  ('user_report_is_open',           'classify', 'labels a reports row still to-do in its admin queue (ledger close rule, Q64); NULL status = pending'),
  ('cron_silent_still_failing',     'classify', 'answers whether a cron-silent ledger item is still failing (ledger close rule, CJ-007); no access decision, and NULL means unknown, which keeps the item open'),
  ('is_fixture_email',              'classify', 'labels an address as a test fixture (is_seed derived at birth, Q65)'),
  ('user_report_is_real',           'classify', 'labels a reporter as real (ledger routing, Q64); NULL reporter = a deleted account = real'),
  ('admin_queue_still_pending',     'classify', 'labels an admin-queue ledger item still pending (close rule, Q355); NULL rule = cannot tell'),
  ('admin_alert_manual_close',      'classify', 'labels an admin alert title as closed only by a person (Q355 part 2); NULL title = not manual'),
  ('is_caller_banned',              'noarg',    'reads auth.uid() only'),
  ('is_server_context',             'noarg',    'reads the session only'),
  ('session_email_unconfirmed',     'noarg',    'reads the JWT only (Q807): TRUE refuses the write, so it fails safe'),
  ('seed_jobs_hidden_publicly',     'noarg',    'reads the launch switch only'),
  ('seed_hidden_in_discovery',      'noarg',    'reads the launch switch and the caller only (Q552)'),
  ('seed_hidden_from_caller',       'noarg',    'reads the launch switch and the caller only (Q552)'),
  ('crew_fee_pays_unconfirmed',     'noarg',    'owner rule constant (Q407): unconfirmed crew members share the late fee'),
  ('crew_completes_when_hired_done','noarg',    'owner rule constant (Q407): an under-filled crew completes when every hired member is done'),
  ('admin_resolve_ban_evasion_match', 'action', 'Q1324: an admin clears or keeps a ban-evasion match (writes; true = done)'),
  ('clear_thread_mute',             'action',   'RPC'),
  ('link_str_turnover_job',         'action',   'Q768: links the caller''s own STR turnover to their own open job (writes; true = linked)'),
  ('link_maintenance_request_job',  'action',   'Rentals S1: links the caller''s own approved maintenance request to their own open job (writes; true = linked, false = refused)'),
  ('kick_payout_schedule_sync',     'action',   'Q1221: queues the payout-schedule sync (pg_net; true = queued)'),
  ('complete_job_accept',           'action',   'Q1180: completes a pending accept (writes; true = completed)'),
  ('delete_email',                  'action',   'pgmq wrapper'),
  ('deliver_job_match',             'action',   'job_match_queue send (writes; true = sent)'),
  ('deliver_saved_search_alert',    'action',   'saved-search send (writes; true = sent)'),
  ('deliver_parish_match_alert',    'action',   'parish-match alert send (writes; true = sent)'),
  ('mark_crew_dispute_executed',    'action',   'service-only crew dispute close (writes; true = closed a crew_fanout decision, Q728)'),
  ('ops_alert_close',               'action',   'RPC'),
  ('ops_alert_condition',           'action',   'ops ledger probe (writes)'),
  ('ops_alert_mark_fixed',          'action',   'RPC'),
  ('process_referral',              'action',   'RPC'),
  ('record_profile_view',           'action',   'RPC'),
  ('record_referral_signup',        'action',   'RPC'),
  ('refund_monthly_free_boost',     'action',   'RPC'),
  ('release_dispute_settlement_claim','action', 'RPC'),
  ('report_stale_dispute_settlement_claim','action','RPC'),
  ('resolve_stalled_job_flag',      'action',   'RPC'),
  ('stamp_dispute_settlement_claim','action',   'RPC'),
  ('toggle_thread_mute',            'action',   'RPC'),
  ('series_give_up_strike',         'action',   'writes a reliability strike (internal to the series give-up RPCs; true = a strike was recorded)'),
  ('choose_new_social_account',     'action',   'records a signed-out "I''m new here" choice for one social sign-in (Q446)'),
  ('admin_release_payout_hold',     'action',   'admin-only: clears a payout hold, TRUE = a hold was cleared (Q764)'),
  ('admin_release_job_payout_hold', 'action',   'admin-only (or server context): clears a JOB payout hold, TRUE = a hold was cleared (Q1491)');

-- Fixture ids (all 00000000-0000-4000-8140-*): A poster, B hired helper on a
-- pro plan, D admin; J an open funded job (A posts, B hired, B applied);
-- R a completed, released job A may review; I a Declutter item (seller A) in B's cart.
CREATE TEMP TABLE q140_case (fn text NOT NULL, sub uuid, args text[] NOT NULL, null_at int[] NOT NULL) ON COMMIT DROP;
INSERT INTO q140_case (fn, sub, args, null_at) VALUES
  ('can_message_in_job',            NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  -- A posts J, so the non-NULL call is TRUE for A.
  ('can_read_job_access_notes',     '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  -- A asked request Q (on J), so the non-NULL call is TRUE for A.
  ('can_read_job_detail_change',    '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000201''::uuid'], ARRAY[1]),
  ('can_review_job',                NULL, ARRAY['''00000000-0000-4000-8140-000000000102''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('can_send_message_in_job',       '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('can_send_message_to_in_job',    '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('check_dispute_velocity',        NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1]),
  ('credential_document_path_ok',   NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''insurance''', '''00000000-0000-4000-8140-00000000000a/credentials/insurance-1787168146999.png'''], ARRAY[1,2,3]),
  ('dispute_evidence_url_ok',       NULL, ARRAY['''00000000-0000-4000-8140-00000000000a/disputes/00000000-0000-4000-8140-000000000101/a.png''', '''00000000-0000-4000-8140-00000000000a''::uuid', '''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1,2,3]),
  -- switch_canary is created as 'testers' (20261012031120) and D is an admin, so the non-NULL call is TRUE.
  ('feature_enabled_for',           '00000000-0000-4000-8140-00000000000d', ARRAY['''switch_canary'''], ARRAY[1]),
  -- A is the active tenant of rental property P (owned by D), so the non-NULL call is TRUE for A.
  ('rentals_caller_is_active_tenant_of', '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000301''::uuid'], ARRAY[1]),
  ('feature_enabled_for_user',      NULL, ARRAY['''switch_canary''', '''00000000-0000-4000-8140-00000000000d''::uuid'], ARRAY[1,2]),
  ('has_role',                      NULL, ARRAY['''00000000-0000-4000-8140-00000000000d''::uuid', '''admin''::public.app_role'], ARRAY[1,2]),
  ('helper_credential_document_ok', NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''trade_license''', '''00000000-0000-4000-8140-00000000000a/credentials/trade_license-1757721600000.png'''], ARRAY[1,2,3]),
  ('helper_has_advanced_analytics', '00000000-0000-4000-8140-00000000000b', ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1]),
  -- identity: each argument alone can say yes, so each gets the tuple where it is the one deciding.
  ('identity_is_verified',          NULL, ARRAY['''verified''', 'false'], ARRAY[1]),
  ('identity_is_verified',          NULL, ARRAY['''unverified''', 'true'], ARRAY[2]),
  ('is_party_to_job',               NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('is_party_to_job_folder',        '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101/x.png'''], ARRAY[1]),
  -- B is on J's crew (the 'roster' fixture step), so the non-NULL call is TRUE.
  ('is_crew_member_of_job_folder',  '00000000-0000-4000-8140-00000000000b', ARRAY['''00000000-0000-4000-8140-000000000101/x.png'''], ARRAY[1]),
  -- J is open, funded, owned by A, no offer, tier 0; D is neither its poster nor offered.
  ('job_announceable_to',           NULL, ARRAY['(SELECT j FROM public.jobs j WHERE j.id = ''00000000-0000-4000-8140-000000000101''::uuid)', '''00000000-0000-4000-8140-00000000000d''::uuid'], ARRAY[1,2]),
  ('job_is_funded',                 NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('job_payment_is_funded',         NULL, ARRAY['''escrow'''], ARRAY[1]),
  ('user_has_pending_application',  NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('user_may_see_job_address',      NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  -- A posts J, so A (the caller) is a party to it as a series (the poster branch).
  ('is_series_party',               '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  -- B has Declutter item I (seller A) in the cart (the 'declutter' fixture step), so the non-NULL call is TRUE.
  ('declutter_in_agreed_sale',      NULL, ARRAY['''00000000-0000-4000-8140-000000000301''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  -- A's Monday window is 09:00-18:00 Louisiana time; 20:00Z on Monday 2026-10-19 is 15:00 CDT, inside it.
  ('declutter_slot_in_windows',     NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''2026-10-19 20:00:00+00''::timestamptz'], ARRAY[1,2]);

DO $q140$
DECLARE
  A constant uuid := '00000000-0000-4000-8140-00000000000a';
  B constant uuid := '00000000-0000-4000-8140-00000000000b';
  D constant uuid := '00000000-0000-4000-8140-00000000000d';
  J constant uuid := '00000000-0000-4000-8140-000000000101';
  R constant uuid := '00000000-0000-4000-8140-000000000102';
  step text;
BEGIN
  -- Fixture rows are data for the checks, not a test of the triggers: skip
  -- them where the role may (superuser), else write through them.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'q140: triggers stay on for the fixture (%)', SQLERRM;
  END;
  -- Not superuser (CI's postgres role): replica mode is refused, so switch off
  -- the user triggers of the public fixture tables instead (postgres owns them;
  -- the ROLLBACK at the end restores them). Measured in db-smoke 35862895416:
  -- with triggers on, the admin-role guard refuses a non-service_role grant and
  -- the application notifier's pg_net call dies on a NULL url.
  FOREACH step IN ARRAY ARRAY['public.profiles', 'public.user_roles', 'public.jobs', 'public.applications', 'public.group_job_helpers',
                              'public.declutter_items', 'public.declutter_cart_items', 'public.declutter_pickup_windows'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', step);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'q140: triggers stay on for % (%)', step, SQLERRM;
    END;
  END LOOP;
  FOR step IN SELECT unnest(ARRAY['users', 'profiles', 'role', 'jobs', 'application', 'roster', 'detail_change', 'declutter', 'rentals', 'bucket', 'objects']) LOOP
    BEGIN
      CASE step
      WHEN 'users' THEN
        INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
          (A, 'q140-a@helpr.test', now()), (B, 'q140-b@helpr.test', now()), (D, 'q140-d@helpr.test', now())
        ON CONFLICT (id) DO NOTHING;
      WHEN 'profiles' THEN
        INSERT INTO public.profiles (user_id) VALUES (A), (B), (D) ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.profiles SET subscription_tier = 'pro', subscription_expires_at = NULL WHERE user_id = B;
      WHEN 'role' THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (D, 'admin');
      WHEN 'jobs' THEN
        INSERT INTO public.jobs (id, title, description, category, budget, location, parish, date_needed,
                                 customer_id, helper_id, status, payment_status, start_time)
        VALUES (J, '[q140] open', 'q140 fixture', 'cleaning', 50, 'Test', 'Orleans', CURRENT_DATE + 7,
                A, B, 'open', 'escrow', '00:00');
        INSERT INTO public.jobs (id, title, description, category, budget, location, parish, date_needed,
                                 customer_id, helper_id, status, payment_status, poster_completed_at, helper_completed_at, start_time)
        VALUES (R, '[q140] done', 'q140 fixture', 'cleaning', 50, 'Test', 'Orleans', CURRENT_DATE,
                A, B, 'completed', 'released', now(), now(), '00:00');
      WHEN 'application' THEN
        INSERT INTO public.applications (job_id, helper_id) VALUES (J, B);
      WHEN 'roster' THEN
        INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES (J, B);
      WHEN 'detail_change' THEN
        -- Q1254: request Q, asked by A on J (to_regclass: before 20261007113957 there is no table).
        IF to_regclass('public.job_detail_change_requests') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.job_detail_change_requests (id, job_id, requested_by, changed_fields, expires_at)
                   VALUES ('00000000-0000-4000-8140-000000000201', '00000000-0000-4000-8140-000000000101',
                           '00000000-0000-4000-8140-00000000000a', '{title}', now() + interval '1 day')$q$;
        END IF;
      WHEN 'declutter' THEN
        -- Declutter item I (seller A, a draft is enough) in B's cart, and A's Monday pickup window
        -- (to_regclass: before 20261014193955 there are no Declutter tables).
        IF to_regclass('public.declutter_cart_items') IS NOT NULL AND to_regclass('public.declutter_pickup_windows') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_items (id, seller_id, status, title, category, condition_stars, delivery_size,
                                                        price_cents, current_price_cents, area_label, area_lat, area_lng)
                   VALUES ('00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-00000000000a', 'draft', '[q140] lamp',
                           'furniture', 3, 'small', 1000, 1000, 'Metairie', 29.98, -90.15)$q$;
          EXECUTE $q$INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
                   VALUES ('00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', 1000, 'buy', 'in_cart', now() + interval '1 day')$q$;
          EXECUTE $q$INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
                   VALUES ('00000000-0000-4000-8140-00000000000a', 1, '09:00', '18:00')$q$;
        END IF;
      WHEN 'rentals' THEN
        -- Rentals S1: property P (owner D), unit, and A's active tenancy (to_regclass: before 20261017061457 there is no table).
        IF to_regclass('public.rental_tenancies') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.rental_properties (id, owner_id, label, street_address, city, zip_code, ownership_status)
                   VALUES ('00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-00000000000d',
                           'q140 home', '1 Fixture Street', 'Lafayette', '70501', 'approved')$q$;
          EXECUTE $q$INSERT INTO public.rental_units (id, property_id, owner_id, label)
                   VALUES ('00000000-0000-4000-8140-000000000302', '00000000-0000-4000-8140-000000000301',
                           '00000000-0000-4000-8140-00000000000d', 'Unit A')$q$;
          EXECUTE $q$INSERT INTO public.rental_tenancies (id, unit_id, property_id, landlord_id, tenant_id, status,
                                                         invite_token_sha256, invite_expires_at, accepted_at)
                   VALUES ('00000000-0000-4000-8140-000000000303', '00000000-0000-4000-8140-000000000302',
                           '00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-00000000000d',
                           '00000000-0000-4000-8140-00000000000a', 'active', repeat('a', 64), now() + interval '14 days', now())$q$;
        END IF;
      WHEN 'bucket' THEN
        INSERT INTO storage.buckets (id, name) VALUES ('user-documents', 'user-documents') ON CONFLICT (id) DO NOTHING;
      WHEN 'objects' THEN
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('user-documents', A::text || '/credentials/insurance-1787168146999.png'),
          ('user-documents', A::text || '/credentials/trade_license-1757721600000.png');
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO q140_out VALUES ('(fixture)', 'FIXTURE_FAILED', step || ': ' || SQLERRM);
    END;
  END LOOP;
  BEGIN
    PERFORM set_config('session_replication_role', 'origin', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$q140$;

DO $q140$
DECLARE
  r record;
  c record;
  i int;
  a text[];
  res boolean;
  nargs int;
BEGIN
  -- 1. The inventory is exact both ways.
  FOR r IN
    SELECT p.proname::text AS fn, p.pronargs, p.provolatile
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype = 'boolean'::regtype
  LOOP
    IF NOT EXISTS (SELECT 1 FROM q140_class k WHERE k.fn = r.fn) THEN
      INSERT INTO q140_out VALUES (r.fn, 'UNCLASSIFIED', 'new boolean function: classify it in scripts/ci/null-arg-validators.sql (allow needs a case per argument)');
    END IF;
  END LOOP;
  FOR r IN SELECT k.fn, k.kind FROM q140_class k LOOP
    SELECT count(*) INTO nargs
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype = 'boolean'::regtype AND p.proname = r.fn;
    IF nargs = 0 THEN
      INSERT INTO q140_out VALUES (r.fn, 'STALE', 'classified but no such boolean function in public');
    END IF;
  END LOOP;
  FOR r IN
    SELECT k.fn, k.kind, p.pronargs, p.provolatile
      FROM q140_class k JOIN pg_proc p ON p.proname = k.fn AND p.pronamespace = 'public'::regnamespace AND p.prorettype = 'boolean'::regtype
  LOOP
    IF (r.kind = 'noarg') <> (r.pronargs = 0) THEN
      INSERT INTO q140_out VALUES (r.fn, 'WRONG_KIND', 'noarg iff it takes no arguments');
    ELSIF (r.kind = 'action') <> (r.provolatile = 'v') THEN
      INSERT INTO q140_out VALUES (r.fn, 'WRONG_KIND', 'action iff VOLATILE (a volatile check is not probed: say why, or make it STABLE)');
    END IF;
    IF r.kind = 'allow' THEN
      FOR i IN 1 .. r.pronargs LOOP
        IF NOT EXISTS (SELECT 1 FROM q140_case x WHERE x.fn = r.fn AND i = ANY (x.null_at)) THEN
          INSERT INTO q140_out VALUES (r.fn, 'NO_CASE', 'argument ' || i || ' is never NULLed');
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM q140_class WHERE kind = 'allow') < 17 OR (SELECT count(*) FROM q140_class) < 47 THEN
    INSERT INTO q140_out VALUES ('(inventory)', 'FLOOR', 'fewer classified functions than on 2026-09-23 (47, 17 allow)');
  END IF;

  -- 2. Every allow case: TRUE on the fixture, exactly FALSE with each argument NULL.
  FOR c IN SELECT * FROM q140_case LOOP
    IF NOT EXISTS (SELECT 1 FROM q140_class k WHERE k.fn = c.fn AND k.kind = 'allow') THEN
      INSERT INTO q140_out VALUES (c.fn, 'CASE_NOT_ALLOW', 'a case for a function not classified allow');
      CONTINUE;
    END IF;
    PERFORM set_config('request.jwt.claim.sub', coalesce(c.sub::text, ''), true);
    PERFORM set_config('request.jwt.claims', CASE WHEN c.sub IS NULL THEN '' ELSE json_build_object('sub', c.sub, 'role', 'authenticated')::text END, true);
    BEGIN
      EXECUTE format('SELECT public.%I(%s)', c.fn, array_to_string(c.args, ', ')) INTO res;
      IF res IS NOT TRUE THEN
        INSERT INTO q140_out VALUES (c.fn, 'BASELINE_NOT_TRUE', 'the fixture call returned ' || coalesce(res::text, 'NULL') || ', so its NULL cases prove nothing');
      END IF;
      FOREACH i IN ARRAY c.null_at LOOP
        a := c.args;
        a[i] := 'NULL';
        EXECUTE format('SELECT public.%I(%s)', c.fn, array_to_string(a, ', ')) INTO res;
        IF res IS DISTINCT FROM false THEN
          INSERT INTO q140_out VALUES (c.fn, 'NULL_ARG_ALLOWS', 'argument ' || i || ' NULL returned ' || coalesce(res::text, 'NULL') || ' (must be false)');
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO q140_out VALUES (c.fn, 'CASE_ERROR', SQLERRM);
    END;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;
END
$q140$;

SELECT fn || '|' || shape || '|' || detail FROM q140_out ORDER BY 1;
ROLLBACK;
