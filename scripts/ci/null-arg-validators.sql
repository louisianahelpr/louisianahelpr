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
  ('rentals_caller_is_active_tenant_of','allow', 'is the caller an active tenant of this property (Rentals S1 read policies, 20261017205605)'),
  ('rentals_listing_visible',       'allow',    'may this Homes listing show in the browse (live, not expired, ownership approved, owner not banned; 20261019043000)'),
  ('referral_member_has_completed_job','allow', 'referral bonus (20261027201034): TRUE = this member has a completed job, one of the two conditions for paying a referral'),
  ('declutter_item_link_visible',   'allow',    'Q2426 share card (20261027194426): may a public link card show this Declutter item (live/reserved, seller not out, Declutter not off)'),
  ('rentals_tenancy_party',         'allow',    'is the caller the landlord or tenant of this tenancy (Homes rent tracker read policies, 20261019073106)'),
  ('feature_enabled_for_user',      'allow',    'hidden feature switch is on for this user (service_role, edge functions)'),
  ('sell_for_me_listings_sent',     'allow',    'may a Have a Helpr list it job be marked done: TRUE = its Helpr sent at least one listing for approval (create-payment release path, LEAD-LIST-FOR-SELLER, 20261101034159)'),
  ('declutter_payout_unsent',       'allow',    'may a refund after the handover still rebook this sale''s seller payout (never tried, marked or sent; board 141, 20261026155251)'),
  ('declutter_problem_window_open', 'allow',    'may the buyer still report a problem on this handed-over sale (board 141, 20261026155251)'),
  ('declutter_sale_final',          'allow',    'may this sale''s seller payout be offered to the payout run (board 141, 20261026155251)'),
  ('shipping_rate_buyable',         'allow',    'may the label worker buy this rate: claimed, and within the shipping the buyer paid (shipping S2, 20261030000030)'),
  ('declutter_held_address_closed', 'deny',     'TRUE closes a held sale''s address to the buyer, 7 days after the time (20261031004529)'),
  ('declutter_sale_decided',        'deny',     'TRUE ends the buyer''s refund and problem window (an admin decided, or a request settled; board 141, 20261026155251)'),
  ('declutter_delivery_raise_open', 'allow',    'may the buyer still raise this delivery''s pay (Q1929, 20261021185418)'),
  ('declutter_delivery_tip_open',   'allow',    'A3-8 / A2-18 (20261028210552): TRUE = the buyer of this order can tip its delivery Helpr now, so "Enjoy your item" says so (the notice only; helpr_task_tip_start checks again)'),
  ('declutter_meetup_spot_near_lines','allow', 'is this meetup spot near every one of these cart lines (Q2425, 20261027204500): TRUE lets checkout freeze the spot'),
  ('declutter_is_porch_day',        'allow',    'porch days (20261029161347): TRUE = this weekday is one of the seller''s porch days (picked days, else pickup-time weekdays), so porch_days offers it and book_porch_day accepts it'),
  ('declutter_order_is_porch_day',  'allow',    'porch places (D-NEW14, 20261030164712): TRUE = this weekday is a porch day for this order (the frozen place''s weekdays, else declutter_is_porch_day), so porch_days offers it and book_porch_day accepts it'),
  ('has_pre_verification_wipe',     'noarg',    'reads auth.uid() only: was this caller''s unfinished profile wiped (Q1286 notice)'),
  ('has_role',                      'allow',    'user holds role (admin gates)'),
  ('payout_setup_hire_allowed',     'allow',    'may this member open a payout account: chosen for a job that holds money, or owed money (owner 2026-10-25, 20261025162003)'),
  ('payout_setup_hire_allowed_for_me','noarg',  'reads auth.uid() only: payout_setup_hire_allowed for the caller (20261025162003)'),
  ('payout_waits_on_identity',      'deny',     'TRUE = hold this Helpr''s payout claim until the ID check is done (payout_after_hire + identity_check, 20261025162003); a NULL member is never held, and its only caller (refuse_payout_claim_while_held) asks only for a non-NULL helper_id'),
  ('helper_credential_document_ok', 'allow',    'helper_credentials document is the member''s own object'),
  ('helper_has_advanced_analytics', 'allow',    'caller''s own paid-tier entitlement'),
  ('identity_is_verified',          'allow',    'the ID gate verdict: Stripe Identity only (20261021081258)'),
  ('identity_check_exempt',         'deny',     'TRUE = an enrolled test account skips the Stripe Identity gates; a NULL user is COALESCEd to FALSE, never exempt (20261021081258)'),
  ('is_identity_verified',          'allow',    'rentals identity gate: the user''s identity_is_verified verdict looked up by id (20261019051407)'),
  ('is_party_to_job',               'allow',    'user is a party to the job'),
  ('is_party_to_job_folder',        'allow',    'caller is a party to the job owning this storage folder'),
  ('is_crew_member_of_job_folder',  'allow',    'caller is on the crew of the job owning this storage folder (Q407)'),
  ('job_announceable_to',           'allow',    'job may be announced to this user (Q392: open_jobs_browse gate per recipient)'),
  ('shop_owner_in_good_standing',   'allow',    'Shops slice 1: this shop owner may be seen by others (not banned, under 3 marketplace strikes)'),
  ('shop_publicly_visible',         'allow',    'Shops slice 1: a member other than the owner may see this shop (switch, hidden, seed, standing)'),
  ('shop_state_ok',                 'allow',    'SH2b (20261019042744): the shared shop-state rule (not hidden, no seed shop while seeds hidden, owner in good standing)'),
  ('shop_link_visible',             'allow',    'SH2b (20261019042744): anyone with the link may see this shop (shop_state_ok, not paused, Shops not switched off)'),
  ('shop_extras_readable',          'allow',    'SH12 (20261019072541): this caller may read the shop FAQs and policies (owner, admin, or shop_link_visible)'),
  ('shop_visible_to',               'allow',    'Shops slice 1: this viewer may see this shop (owner, or publicly visible)'),
  ('job_is_funded',                 'allow',    'job is listed: funded or its card held (applications WITH CHECK; Q2399 20261027185146)'),
  ('job_payment_is_funded',         'allow',    'payment_status counts as funded (award + apply gates)'),
  ('job_payment_is_listed',         'allow',    'payment_status counts as listed: funded or the card held (browse, apply, alerts, offers; Q2399 20261027185146)'),
  ('user_has_pending_application',  'allow',    'user applied to the job'),
  ('user_may_see_job_address',      'allow',    'user may see the exact job address'),
  ('is_series_party',               'allow',    'user is on the recurring series (reads its holds, offers, releases; 20260927012806)'),
  ('is_safe_media_url',             'absent',   'NULL = no URL stored; nothing to render (nullable avatar_url CHECK)'),
  ('are_safe_media_urls',           'absent',   'NULL = no photo list stored (nullable jobs.photos / portfolio_urls CHECK)'),
  ('declutter_photo_object_attached', 'deny',   'TRUE = a declutter photo row still names this object, so the own-folder delete policy refuses the delete (manager photos stay, 20261101235806); its only caller passes storage.objects.name, never NULL, and the same policy first requires the name''s own-folder parts'),
  ('declutter_handover_refused',    'deny',     'TRUE refuses this way at checkout (handover_not_offered; Q2462, 20261028235247); both checkouts refuse a NULL way before calling it, and NULL lines match no row (FALSE: nothing ticked to narrow)'),
  ('declutter_pair_talking',        'deny',     'TRUE holds back the "or you get a strike" checkout reminders while a handover chat is open (Q2462, 20261028235249); a NULL side matches no talk (FALSE: the reminders go out as before)'),
  ('are_users_blocked',             'deny',     'TRUE refuses the interaction'),
  ('declutter_member_out',          'deny',     'TRUE = banned or 3 Declutter strikes: the trade is refused (20261014210518)'),
  ('declutter_seller_hidden',       'deny',     'TRUE hides a seller''s Declutter listings (20261014210518)'),
  ('declutter_pair_needs_talk',     'allow',    'TRUE = this buyer and seller have an agreed sale whose shared ways leave out every way that always works, so a handover chat may open and the missed-checkout strike waits (Q2462, 20261028235249); a NULL side matches no cart line and COALESCE makes it FALSE'),
  ('declutter_in_agreed_sale',      'allow',    'TRUE = this member is a side of an agreed sale (in a cart or paid) on this item: may read its pickup details (20261015042253)'),
  ('declutter_seller_slot_open',    'allow',    'TRUE = this pickup time fits one of the seller''s places'' windows (or, with no places, their pickup windows): the free ask''s time can be confirmed (20261101174857)'),
  ('helpr_task_position_viewer',    'allow',    'TRUE = the caller may see the Helpr''s live position on this started delivery (the seller before pickup, the buyer on the road; 20261101184555)'),
  ('unread_reminder_quiet',         'classify', 'TRUE = this moment is in the 9 PM to 8 AM quiet hours for unread-message reminders; no access decision (20261101183017)'),
  ('declutter_slot_in_windows',     'allow',    'TRUE = a 30-minute pickup slot at this time fits one of this seller''s windows: the booking is valid (20261015042253)'),
  ('declutter_handover_photo_access', 'allow',  'TRUE = the caller may write (own folder, paid order) or read (a party or an admin) this declutter-handover object (20261017055502)'),
  ('declutter_handover_photo_unattached', 'allow', 'audit 1a #10 (20261029222816): TRUE = this declutter-handover path is in the caller''s own handover folder and no handover row holds it, so the uploader may delete it (storage DELETE policy)'),
  ('shop_handover_photo_access',    'allow',    'TRUE = the caller may write (the shop, own folder, charged accepted order) or read (a party or an admin) this shop-handover object (20261018211820)'),
  ('rentals_public_listing_visible','allow',    'may anyone with the link see this Homes listing (visible, Homes open to everyone, not a test or seed owner; 20261019062540)'),
  ('rentals_listing_photo_access',  'allow',    'TRUE = the caller may upload into / read this listing-photos object (own folder, own open listing, not taken down; 20261019071203)'),
  ('rentals_listing_photo_deletable','allow',   'TRUE = the caller may delete this listing-photos object (own folder, readable, attached to nothing; 20261019071203)'),
  ('application_email_should_wait', 'action',   'VOLATILE: paces a poster''s applicant emails (counts or stamps); a NULL user answers false = send now, never a held email (20261025182522)'),
  ('job_match_email_should_wait',   'action',   'VOLATILE: paces a member''s job-match emails to one a day; a NULL user answers false = send now (20261025182522)'),
  ('scanner_safe_confirm_link_for', 'deny',     'TRUE = send the scanner-safe link; a NULL user answers FALSE, so the email keeps GoTrue''s own link (20261025190000)'),
  ('declutter_set_item_seller_delivery', 'action', 'VOLATILE: a seller turns seller delivery on or off for one own item and gets the new setting back; a NULL item or setting raises item_not_found (20261027153244)'),
  ('helpr_task_tip_attach',         'action',   'VOLATILE: records a delivery tip''s Stripe page on its pending row once and says whether the row holds it (service only); a NULL id or page answers false and writes nothing (Q2453; 20261028014848)'),
  ('declutter_refund_set_mode',     'action',   'VOLATILE: records a Declutter refund''s Stripe mode once and returns it (service only; 20261015042253)'),
  ('record_my_signup_source',       'action',   'VOLATILE: a new member (account under 2 days old) records their own sign-up source once (writes; TRUE = a row was added); a NULL source is stored as direct, a NULL campaign as none; no access decision (20261031220447)'),
  ('declutter_has_agreed_sales',    'noarg',    'reads auth.uid() only: does the caller have a Declutter sale in flight (row 62; 20261014224914)'),
  ('declutter_open_to_guests',      'noarg',    'no argument: is the declutter switch''s audience everyone (BUY-16 anon read policies, 20261031060656)'),
  ('declutter_set_auto_free',       'action',   'VOLATILE: the seller turns "free on day 12" on/off on their own listing and gets the stored value back; a NULL choice raises invalid_choice (Q2430; 20261027205327)'),
  ('declutter_auto_free_state',     'classify', 'reads the seller''s own "free on day 12" switch for one own listing (Q2430; 20261027205327)'),
  ('declutter_set_keep_up',         'action',   'VOLATILE: the seller turns "keep it up until it sells" on/off on their own listing and gets the stored value back; a NULL choice raises invalid_choice, a NULL item item_not_found (20261029154323)'),
  ('declutter_keep_up_state',       'classify', 'reads the seller''s own "keep it up until it sells" switch for one own listing; a NULL item raises item_not_found (20261029154323)'),
  ('declutter_keeps_up',            'classify', 'service only: does the listing-rounds sweep keep this listing up (its private keep-up switch); a NULL item matches no row and COALESCE makes it FALSE, the normal rounds (20261029154323)'),
  ('declutter_set_listing_drops',   'action',   'VOLATILE: the seller turns price drops on/off on their own listing and gets the stored value back (board 158; 20261020064354)'),
  ('declutter_set_wanted_public',   'action',   'VOLATILE: the poster opens or closes public answers on their own Wanted post and gets the stored value back (a NULL choice is stored as false; 20261021031757)'),
  ('declutter_set_porch_ok',        'action',   'VOLATILE: the seller sets porch pickup on their own draft and gets the stored value back; a NULL choice raises invalid_porch_choice (row 101; 20261017055504)'),
  ('landlord_id_images_deleted',    'action',   'VOLATILE: the retention sweep stamps a landlord ID review whose photos it removed and reports whether it did (service only; a NULL argument matches no row and answers FALSE; 20261019051407)'),
  ('money_ref_in_use',              'deny',     'TRUE = this Stripe id is already on a money row, so settle-by-hand refuses it (ref_already_used); its only caller tests it inside IF v_stripe IS NOT NULL, and a NULL ref matches no row (FALSE) (20261019070737)'),
  ('payout_hold_for_review',        'action',   'VOLATILE: the payout run holds one pending/failed payout or refund for admin review and reports whether it did (service only; a NULL id matches no row and answers FALSE, a NULL kind raises invalid_kind; 20261019070737)'),
  ('rentals_set_saved_home',        'action',   'VOLATILE: the caller saves or unsaves a Homes listing (the heart) and gets the new state back; a NULL p_saved unsaves and answers FALSE, a NULL listing raises listing_not_found on save (20261019185722)'),
  ('shop_refund_reversed',          'action',   'VOLATILE: the webhook reopens the Shops refund row that recorded a refund Stripe later failed, TRUE = it did (service only; a NULL id or refund id matches no row and answers FALSE; 20261019071055)'),
  ('shop_order_unaccounted_hand_refund','deny', 'TRUE = a refund made in Stripe the app has not accounted for stands on the order: every Shops queue, the order lock and the admin release refuse it (service only; 20261019071055)'),
  ('declutter_retire_order',        'action',   'VOLATILE: retires an unpaid order whose Stripe page timed out and reports whether it did (service only; a NULL argument matches no order and answers FALSE; 20261014224914)'),
  ('declutter_order_slot_in_windows', 'allow', 'place hours (20261031145652): TRUE = a 30-minute slot at this time fits this order''s frozen place hours, else the seller''s usual times, so book_pickup and delivery_slot_ok accept it'),
  ('declutter_place_windows_valid', 'absent',   'place hours (20261031145652): NULL = no hours stored for the place (both nullable windows CHECKs say windows IS NULL OR ...; the save checks only a non-NULL p_windows)'),
  ('declutter_delivery_slot_ok',    'allow',    'TRUE = a Helpr may pick this delivery order up at this time (seller''s window, before the 7-day deadline; 20261017055505)'),
  ('helpr_task_photo_access',       'allow',    'TRUE = the caller may write (the assigned Helpr, own folder, active task) or read (a party or an admin) this helpr-tasks object (20261017055505)'),
  ('helpr_task_photo_ok',           'allow',    'TRUE = this path is the Helpr''s own uploaded photo of this task (20261017055505; a stale one raises photo_too_old, 20261029002010)'),
  ('handover_photo_is_fresh',       'allow',    'TRUE = this storage object was uploaded in the last 10 minutes: a live handover photo (20261029002010)'),
  ('declutter_return_photo_ok',     'allow',    'TRUE = this path is the caller''s own uploaded return photo for this order (20261030071818)'),
  ('helpr_task_same_stripe_mode',   'allow',    'TRUE = the two members are the same Stripe kind (test vs real): the Helpr may take the task (20261017055505)'),
  ('helpr_task_source_held',        'deny',     'TRUE = the source holds the money (an open problem): no confirm or payout (20261017055505)'),
  ('helpr_task_source_slot_ok',     'allow',    'TRUE = the task''s source accepts this pickup time (20261017055505)'),
  ('helpr_task_vehicle_fits',       'allow',    'TRUE = this Helpr''s vehicle can carry this size (row 41; 20261017055505)'),
  ('declutter_link_setup_job',      'action',   'VOLATILE: links the caller''s own open, not-yet-paid job (any category) to their own paid Declutter order and reports whether it did; a NULL job matches no job and raises not your open job, a NULL order matches no order and answers FALSE ("Add a Helpr"; 20261017073146)'),
  ('declutter_seller_out',          'deny',     'TRUE = the seller cannot sell now (out, under 18, business-like): refused (20261014210518)'),
  ('shop_cottage_cap_reached',      'deny',     'Shops slice 2 (20261017061157): TRUE = the owner is at the yearly home-food limit, so new home-food listings (and orders) are refused; a NULL owner is TRUE (fails safe)'),
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
  ('quote_job_offered_to_quoter',   'classify', 'labels a job as booked from an agreed quote and offered to that quoter (20261018155222): the hire trigger acts on it and the direct-offer notice stands aside; no access decision (EXECUTE revoked from clients), and a NULL job or helper is false'),
  ('is_seed_email',                 'classify', 'labels an address as a seed account'),
  ('is_test_subject',               'classify', 'labels a member as a test account so admin alerts skip them (20261030143141); NULL is false, not a test subject'),
  ('refund_request_is_live',        'classify', 'labels a refund_requests row live (open, a come-back not settled, declined awaiting its dispute, or agreed and unsettled; 20261021102943); no access decision (EXECUTE revoked from clients), called only on rows whose status is NOT NULL, and a NULL status is false'),
  ('refund_come_back_pending',      'deny',     'TRUE = the Helpr agreed to come back and finish and the agreed time is still ahead, so a new done stamp is REFUSED (trg_refuse_done_before_come_back, create-payment release); a NULL job is TRUE (fails safe); service only (20261021102943)'),
  ('refund_party_held',             'deny',     'TRUE = a party is banned, suspended, under a ban review or on a payout hold, so an agreed refund is NOT settled automatically (it goes to an admin); a NULL user is TRUE (fails safe); service only (20261021102943)'),
  ('is_user_error_screen_row',      'classify', 'labels an error_logs row as a user-facing error screen'),
  ('get_thread_counterparty_deleted', 'classify', 'labels a thread''s other party as a deleted account (read-only notice); grants no access (it discloses one bit, account gone vs exists, see its migration), and a NULL argument returns false (threadCounterpartyDeleted.pglite.mjs)'),
  ('sms_phone_prompt_due',          'classify', 'SMS phone ask (20261027183058): TRUE shows the one-time "Add your phone" prompt to the caller; no access decision, and a NULL moment raises invalid_moment'),
  ('saved_search_category_matches', 'classify', 'labels a new job as matching a saved search''s category or its group (20261021072206); a NULL search category is the "any category" search and matches by design; no access decision (EXECUTE is service_role only; the alert trigger still applies every visibility gate)'),
  ('user_error_screen_is_real',     'classify', 'labels an error screen as real-user (ops alert counting)'),
  ('user_report_is_open',           'classify', 'labels a reports row still to-do in its admin queue (ledger close rule, Q64); NULL status = pending'),
  ('cron_silent_still_failing',     'classify', 'answers whether a cron-silent ledger item is still failing (ledger close rule, CJ-007); no access decision, and NULL means unknown, which keeps the item open'),
  ('is_fixture_email',              'classify', 'labels an address as a test fixture (is_seed derived at birth, Q65)'),
  ('job_reminder_switched_off',     'classify', 'says whether a switchable job reminder is turned off for its recipient (20261030031059), so the edge sender can tell that drop from a failed insert; no access decision (EXECUTE is service_role only), and a NULL user has no preferences row, so false'),
  ('is_test_member',                'classify', 'labels a member as test data (profiles.is_seed or test_accounts; b62, 20261030015205) so totals leave them out; no access decision (EXECUTE is service_role only), and a NULL user is false'),
  ('backout_notice_applies',        'classify', 'labels a back-out notice still live (keeps its reminders; Q2175); no access decision, and NULL status or kind keeps the notice, the reminder side'),
  ('user_report_is_real',           'classify', 'labels a reporter as real (ledger routing, Q64); NULL reporter = a deleted account = real'),
  ('admin_queue_still_pending',     'classify', 'labels an admin-queue ledger item still pending (close rule, Q355); NULL rule = cannot tell'),
  ('admin_alert_manual_close',      'classify', 'labels an admin alert title as closed only by a person (Q355 part 2); NULL title = not manual'),
  ('job_photos_shareable',          'classify', 'labels a job whose before/after photos Helpr may use in marketing: the poster and every booked Helpr left share_job_photos on (admin only; app access never depends on it; 20261021001940)'),
  ('declutter_search_matches',      'classify', 'labels a Declutter item as matching a saved search''s words (DA-1, 20261030071817); NULL query = no search words, matches like an empty Browse search; no access decision'),
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
  ('message_attachment_locked',     'deny',     'TRUE refuses deleting a locked message''s attachment (20261030144615); EXISTS, so a NULL path is FALSE, never NULL'),
  ('message_delete_locked',         'deny',     'TRUE refuses a member deleting the message (20261030144615); EXISTS and COALESCE, so NULL arguments are FALSE, never NULL'),
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
  ('resolve_approval_escalation',   'action',   'RPC'),
  ('file_approval_escalation',      'action',   'approval queue (20261023143240): service-only, files or re-opens a job''s escalation (writes; TRUE = this call filed it)'),
  ('stamp_dispute_settlement_claim','action',   'RPC'),
  ('toggle_thread_mute',            'action',   'RPC'),
  ('series_give_up_strike',         'action',   'writes a reliability strike (internal to the series give-up RPCs; true = a strike was recorded)'),
  ('choose_new_social_account',     'action',   'records a signed-out "I''m new here" choice for one social sign-in (Q446)'),
  ('admin_release_payout_hold',     'action',   'admin-only: clears a payout hold, TRUE = a hold was cleared (Q764)'),
  ('admin_release_job_payout_hold', 'action',   'admin-only (or server context): clears a JOB payout hold, TRUE = a hold was cleared (Q1491)'),
  ('shops_admin_check_registration','action',   'Shops slice 1: admin marks a Secretary of State number checked (writes; returns the new state)'),
  ('shops_admin_set_hidden',        'action',   'Shops slice 1: admin hides or shows a shop (writes; returns the new state)'),
  ('shops_set_follow',              'action',   'Shops slice 1: the caller follows or unfollows a shop (writes; returns the new state)'),
  ('shops_set_paused',              'action',   'Shops slice 1: the caller pauses or reopens their own shop (writes; returns the new state)'),
  ('sms_record_result',             'action',   'SMS alerts (20261021193738): service-only, records Twilio''s answer for a queued text (writes; TRUE = a queued row was updated)'),
  ('instant_book_helper_free_on',   'allow',    'instant book (20261101063725): TRUE = this Helpr''s calendar marks them free on this day, so the job can be booked straight away'),
  ('instant_book_payment_failed',   'action',   'instant book (20261101065105): service-only, ends a live booking whose payment failed and tells both sides (writes; TRUE = it ended one)'),
  ('instant_book_end_if_unhireable','action',   'instant book (20261101071621): service-only, ends a booking whose Helpr can no longer be hired before any capture (writes; TRUE = it ended one)'),
  ('instant_book_captured_not_hired','action',  'instant book (20261101074901): service-only, ends a booking captured with nobody hired and takes the refund claim (writes; TRUE = it marked one)'),
  ('instant_book_refund_finished',  'action',   'instant book (20261101074901): service-only, releases the instant-book refund claim once the refund is done (writes; TRUE = it released one)');

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
  -- D's listing L on unit U of P is live for 30 days, so the non-NULL call is TRUE.
  ('rentals_listing_visible',       NULL, ARRAY['''00000000-0000-4000-8140-000000000304''::uuid'], ARRAY[1]),
  -- A is the tenant of tenancy T (the 'rentals' fixture step), so the non-NULL call is TRUE for A.
  ('rentals_tenancy_party',         '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000303''::uuid'], ARRAY[1]),
  ('feature_enabled_for_user',      NULL, ARRAY['''switch_canary''', '''00000000-0000-4000-8140-00000000000d''::uuid'], ARRAY[1,2]),
  ('has_role',                      NULL, ARRAY['''00000000-0000-4000-8140-00000000000d''::uuid', '''admin''::public.app_role'], ARRAY[1,2]),
  -- B is the Helpr on J (open, escrow: funded), so the non-NULL call is TRUE.
  -- A posted R (completed), so the non-NULL call is TRUE for A.
  ('referral_member_has_completed_job', NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1]),
  -- L is D's LIVE Declutter item and Declutter is on for testers (the 'declutter' fixture step), so the non-NULL call is TRUE.
  ('declutter_item_link_visible',   NULL, ARRAY['''00000000-0000-4000-8140-000000000311''::uuid'], ARRAY[1]),
  ('payout_setup_hire_allowed',     NULL, ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1]),
  ('helper_credential_document_ok', NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''trade_license''', '''00000000-0000-4000-8140-00000000000a/credentials/trade_license-1757721600000.png'''], ARRAY[1,2,3]),
  ('helper_has_advanced_analytics', '00000000-0000-4000-8140-00000000000b', ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1]),
  -- identity: Stripe Identity decides (arg 1); arg 2 (the NOT NULL Connect column) only says a row was read.
  ('identity_is_verified',          NULL, ARRAY['''verified''', 'false'], ARRAY[1,2]),
  -- D's profile carries idv_status = 'verified' (profiles fixture step), so the non-NULL call is TRUE.
  ('is_identity_verified',          NULL, ARRAY['''00000000-0000-4000-8140-00000000000d''::uuid'], ARRAY[1]),
  ('is_party_to_job',               NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('is_party_to_job_folder',        '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101/x.png'''], ARRAY[1]),
  -- B is on J's crew (the 'roster' fixture step), so the non-NULL call is TRUE.
  ('is_crew_member_of_job_folder',  '00000000-0000-4000-8140-00000000000b', ARRAY['''00000000-0000-4000-8140-000000000101/x.png'''], ARRAY[1]),
  -- J is open, funded, owned by A, no offer, tier 0; D is neither its poster nor offered.
  ('job_announceable_to',           NULL, ARRAY['(SELECT j FROM public.jobs j WHERE j.id = ''00000000-0000-4000-8140-000000000101''::uuid)', '''00000000-0000-4000-8140-00000000000d''::uuid'], ARRAY[1,2]),
  ('job_is_funded',                 NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('job_payment_is_funded',         NULL, ARRAY['''escrow'''], ARRAY[1]),
  ('job_payment_is_listed',         NULL, ARRAY['''held'''], ARRAY[1]),
  ('user_has_pending_application',  NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('user_may_see_job_address',      NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  -- A posts J, so A (the caller) is a party to it as a series (the poster branch).
  ('is_series_party',               '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  -- B has Declutter item I (seller A) in the cart (the 'declutter' fixture step), so the non-NULL call is TRUE.
  -- B has item I (seller A) in the cart and A offers it by safe meeting spot only (the 'declutter' step), so the pair needs to talk.
  ('declutter_pair_needs_talk',     NULL, ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('declutter_in_agreed_sale',      NULL, ARRAY['''00000000-0000-4000-8140-000000000301''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  -- A's Monday window is 09:00-18:00 Louisiana time; 20:00Z on Monday 2026-10-19 is 15:00 CDT, inside it.
  ('declutter_slot_in_windows',     NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''2026-10-19 20:00:00+00''::timestamptz'], ARRAY[1,2]),
  -- Seller A has no porch places, so the same slot is open through declutter_slot_in_windows.
  ('declutter_seller_slot_open',    NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''2026-10-19 20:00:00+00''::timestamptz'], ARRAY[1,2]),
  -- Task 603: accepted and started, A is its pickup contact (the 'tip' fixture).
  ('helpr_task_position_viewer',    '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000603''::uuid'], ARRAY[1]),
  -- D is an admin, so reading a well-formed declutter-handover path is TRUE for D (no order row needed).
  ('declutter_handover_photo_access', '00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-00000000000a/declutter/handover/00000000-0000-4000-8140-000000000401/x.jpg''', 'false'], ARRAY[1,2]),
  -- Audit 1a #10: A's own handover-folder path that no declutter_handovers row holds, so the non-NULL call is TRUE for A.
  ('declutter_handover_photo_unattached', '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-00000000000a/declutter/handover/00000000-0000-4000-8140-000000000401/x.jpg'''], ARRAY[1]),
  -- D is an admin, so reading a well-formed shop-handover path is TRUE for D (no order row needed).
  ('shop_handover_photo_access',    '00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-00000000000a/shops/handover/00000000-0000-4000-8140-000000000401/x.jpg''', 'false'], ARRAY[1,2]),
  -- D's listing L (live; the 'rentals' step opens Homes to everyone; D is no test or seed account), so TRUE for anyone.
  ('rentals_public_listing_visible', NULL, ARRAY['''00000000-0000-4000-8140-000000000304''::uuid'], ARRAY[1]),
  -- D reads an object in D's own folder for D's listing L (not taken down), so TRUE for D.
  ('rentals_listing_photo_access',  '00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-00000000000d/rental-listings/00000000-0000-4000-8140-000000000304/x.jpg''', '''select'''], ARRAY[1,2]),
  -- The same object is attached to nothing, so D may delete it.
  ('rentals_listing_photo_deletable','00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-00000000000d/rental-listings/00000000-0000-4000-8140-000000000304/x.jpg'''], ARRAY[1]),
  -- Slice 5 (the 'delivery' fixture step): O is B's paid delivery order from seller A, whose windows cover
  -- every day 09:00-18:00 Louisiana time, so tomorrow 10:00 there is a valid pickup time.
  ('declutter_order_slot_in_windows', NULL, ARRAY['''00000000-0000-4000-8140-000000000501''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid', '((((now() AT TIME ZONE ''America/Chicago'')::date + 1) + time ''10:00'') AT TIME ZONE ''America/Chicago'')'], ARRAY[1,2,3]),
  ('declutter_delivery_slot_ok',    NULL, ARRAY['''00000000-0000-4000-8140-000000000501''::uuid', '((((now() AT TIME ZONE ''America/Chicago'')::date + 1) + time ''10:00'') AT TIME ZONE ''America/Chicago'')'], ARRAY[1,2]),
  ('helpr_task_source_slot_ok',     NULL, ARRAY['''declutter_delivery''', '''00000000-0000-4000-8140-000000000501''::uuid', '((((now() AT TIME ZONE ''America/Chicago'')::date + 1) + time ''10:00'') AT TIME ZONE ''America/Chicago'')'], ARRAY[1,2,3]),
  -- B uploaded p.jpg for task T (the 'objects' step).
  ('helpr_task_photo_ok',           NULL, ARRAY['''00000000-0000-4000-8140-000000000601''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid', '''00000000-0000-4000-8140-00000000000b/task/00000000-0000-4000-8140-000000000601/p.jpg'''], ARRAY[1,2,3]),
  -- The same object, uploaded just now by the fixture (anti-lying #2, 20261029002010).
  ('handover_photo_is_fresh',       NULL, ARRAY['''helpr-tasks''', '''00000000-0000-4000-8140-00000000000b/task/00000000-0000-4000-8140-000000000601/p.jpg'''], ARRAY[1,2]),
  ('declutter_return_photo_ok',     NULL, ARRAY['''00000000-0000-4000-8140-000000000501''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid', '''00000000-0000-4000-8140-00000000000b/declutter/return/00000000-0000-4000-8140-000000000501/p.jpg'''], ARRAY[1,2,3]),
  -- D is an admin, so reading a well-formed helpr-tasks path is TRUE for D (no task row needed).
  -- Q1929: O is B's paid delivery order (the 'delivery' step); the task is built in place (jsonb_populate_record):
  -- open, an hour of window left, its source O (not held), so the non-NULL call with 0 minutes is TRUE.
  ('declutter_delivery_raise_open', NULL, ARRAY['(SELECT o FROM public.declutter_orders o WHERE o.id = ''00000000-0000-4000-8140-000000000501''::uuid)', 'jsonb_populate_record(NULL::public.helpr_tasks, jsonb_build_object(''id'', ''00000000-0000-4000-8140-000000000602'', ''status'', ''open'', ''open_until'', now() + interval ''1 hour'', ''source_kind'', ''declutter_delivery'', ''source_id'', ''00000000-0000-4000-8140-000000000501''))', '0'], ARRAY[1,2,3]),
  -- Board 141: H is handed over now with an untouched payout, so a refund may still rebook it and the buyer may still
  -- report; O is still 'paid' (not handed over), so its sale counts as final for the payout queue.
  -- B (J's Helpr) sent item I's listing to A, so the service-role call (no caller) is TRUE for J.
  ('sell_for_me_listings_sent',     NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('declutter_payout_unsent',       NULL, ARRAY['''00000000-0000-4000-8140-000000000502''::uuid'], ARRAY[1]),
  -- T (the 'tip' step): B's handed-over delivery from A, its task confirmed, Helpr D with a payout account.
  ('declutter_delivery_tip_open',   NULL, ARRAY['''00000000-0000-4000-8140-000000000503''::uuid'], ARRAY[1]),
  ('declutter_problem_window_open', NULL, ARRAY['''00000000-0000-4000-8140-000000000502''::uuid'], ARRAY[1]),
  ('declutter_sale_final',          NULL, ARRAY['''00000000-0000-4000-8140-000000000501''::uuid'], ARRAY[1]),
  -- Instant book: B marked a week from today as a free day (the 'availability' step).
  ('instant_book_helper_free_on',   NULL, ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid', '(CURRENT_DATE + 7)'], ARRAY[1,2]),
  -- Shipping S2 (the 'ship' step): shipment 801 is claimed for B's shipped order 504 ($7.33 paid), so a $7.33 rate is TRUE.
  ('shipping_rate_buyable',         NULL, ARRAY['''00000000-0000-4000-8140-000000000801''::uuid', '733'], ARRAY[1,2]),
  -- Q2425: spot S (the 'meetup' step) is active and beside item I, whose line is in B's cart (the 'declutter' step).
  ('declutter_meetup_spot_near_lines', NULL, ARRAY['''00000000-0000-4000-8140-000000000701''::uuid', 'ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.item_id = ''00000000-0000-4000-8140-000000000301''::uuid)'], ARRAY[1,2]),
  -- Porch days: A has no picked days and a Monday pickup window (the 'declutter' step), so Monday (1) is a porch day.
  ('declutter_is_porch_day',        NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '1::smallint'], ARRAY[1,2]),
  -- Porch places: O (the 'delivery' step) has no frozen place, so its days are seller A's: Monday (1) is one.
  ('declutter_order_is_porch_day',  NULL, ARRAY['''00000000-0000-4000-8140-000000000501''::uuid', '1::smallint'], ARRAY[1,2]),
  ('helpr_task_photo_access',       '00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-00000000000a/task/00000000-0000-4000-8140-000000000601/x.jpg''', 'false'], ARRAY[1,2]),
  -- A and B are both real (not test) accounts.
  ('helpr_task_same_stripe_mode',   NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('helpr_task_vehicle_fits',       NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''small'''], ARRAY[1,2]),
  -- Shops slice 1: A owns shop S (the 'shop' fixture step), not hidden, not seed, A in good standing.
  ('shop_owner_in_good_standing',   NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1]),
  -- The 'shops' switch is set to testers in the fixture and D is an admin, so S is visible to D.
  ('shop_publicly_visible',         '00000000-0000-4000-8140-00000000000d', ARRAY['''00000000-0000-4000-8140-000000000401''::uuid'], ARRAY[1]),
  -- SH2b: S is not hidden, not seed, not paused, A in good standing, and the fixture's 'shops' switch is testers (not off).
  ('shop_state_ok',                 NULL, ARRAY['''00000000-0000-4000-8140-000000000401''::uuid'], ARRAY[1]),
  ('shop_link_visible',             NULL, ARRAY['''00000000-0000-4000-8140-000000000401''::uuid'], ARRAY[1]),
  -- SH12: S is link-visible (above), so even a caller with no uid reads it.
  ('shop_extras_readable',          NULL, ARRAY['''00000000-0000-4000-8140-000000000401''::uuid'], ARRAY[1]),
  -- A owns S, so the non-NULL call is TRUE (the owner branch).
  ('shop_visible_to',               NULL, ARRAY['''00000000-0000-4000-8140-000000000401''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]);

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
                              'public.declutter_items', 'public.declutter_cart_items', 'public.declutter_pickup_windows', 'public.declutter_meetup_spots',
                              'public.declutter_orders', 'public.declutter_payouts', 'public.shops', 'public.feature_switches'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', step);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'q140: triggers stay on for % (%)', step, SQLERRM;
    END;
  END LOOP;
  FOR step IN SELECT unnest(ARRAY['users', 'profiles', 'role', 'jobs', 'application', 'roster', 'detail_change', 'declutter', 'meetup', 'delivery', 'handed_over', 'tip', 'ship', 'rentals', 'bucket', 'objects', 'shop', 'list_for_seller', 'availability']) LOOP
    BEGIN
      CASE step
      WHEN 'users' THEN
        INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
          (A, 'q140-a@helpr.test', now()), (B, 'q140-b@helpr.test', now()), (D, 'q140-d@helpr.test', now())
        ON CONFLICT (id) DO NOTHING;
      WHEN 'profiles' THEN
        INSERT INTO public.profiles (user_id) VALUES (A), (B), (D) ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.profiles SET subscription_tier = 'pro', subscription_expires_at = NULL WHERE user_id = B;
        UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = D;  -- is_identity_verified's TRUE case
        -- Q1844 (20261017085012): helper_has_advanced_analytics also asks the 'memberships' switch, so turn it
        -- on for everyone here (rolled back with the rest), or B's baseline call is false and proves nothing.
        IF to_regclass('public.feature_switches') IS NOT NULL THEN
          INSERT INTO public.feature_switches (key, audience, description) VALUES ('memberships', 'everyone', 'q140 fixture')
          ON CONFLICT (key) DO UPDATE SET audience = 'everyone';
        END IF;
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
          -- Q2462 (20261028235247): A offers item I by a safe meeting spot only, so A and B need to talk the handover through.
          IF EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'declutter_items' AND column_name = 'handovers') THEN
            EXECUTE $q$UPDATE public.declutter_items SET handovers = ARRAY['meetup'] WHERE id = '00000000-0000-4000-8140-000000000301'$q$;
          END IF;
          -- L: D's live item (D is ID-verified), and Declutter on for testers, for declutter_item_link_visible (Q2426).
          EXECUTE $q$INSERT INTO public.declutter_items (id, seller_id, status, title, category, condition_stars, delivery_size,
                                                        price_cents, current_price_cents, area_label, area_lat, area_lng)
                   VALUES ('00000000-0000-4000-8140-000000000311', '00000000-0000-4000-8140-00000000000d', 'live', '[q140] chair',
                           'furniture', 3, 'small', 1000, 1000, 'Metairie', 29.98, -90.15)$q$;
          EXECUTE $q$UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'$q$;
        END IF;
      WHEN 'list_for_seller' THEN
        -- LEAD-LIST-FOR-SELLER (20261101034159): B (J's Helpr) listed item I for A (J's poster) and sent it, so
        -- sell_for_me_listings_sent(J) is TRUE as the service role (to_regclass: before it there is no table).
        IF to_regclass('public.declutter_listed_for_seller') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_listed_for_seller (item_id, job_id, helpr_id, seller_id, sent_at)
                   VALUES ('00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-000000000101',
                           '00000000-0000-4000-8140-00000000000b', '00000000-0000-4000-8140-00000000000a', now())$q$;
        END IF;
      WHEN 'meetup' THEN
        -- Q2425 (20261027204500): spot S, an active public place beside item I (to_regclass: before it there are no spots).
        IF to_regclass('public.declutter_meetup_spots') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_meetup_spots (id, parish, name, address, lat, lng, kind, active)
                   VALUES ('00000000-0000-4000-8140-000000000701', 'Jefferson', '[q140] safe exchange', '1 Test St, Metairie, LA',
                           29.98, -90.15, 'police', true)$q$;
        END IF;
      WHEN 'delivery' THEN
        -- Slice 5 (20261017055505): order O, B's PAID delivery order from seller A (paid now: the 7-day
        -- deadline is a week away), and A's pickup windows on every other day (Monday exists above).
        IF to_regclass('public.declutter_order_deliveries') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents,
                                                         tax_cents, delivery_cents, total_cents, paid_at, stripe_payment_intent_id)
                   VALUES ('00000000-0000-4000-8140-000000000501', '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', 'paid', 'delivery', 1000, 120, 0, 1200, 2320, now(), 'pi_q140')$q$;
          EXECUTE $q$INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
                   SELECT '00000000-0000-4000-8140-00000000000a', d, '09:00', '18:00' FROM generate_series(0, 6) d WHERE d <> 1$q$;
        END IF;
        -- Q2452 (20261028012406): every delivery needs a car, so A has one (helpr_task_vehicle_fits' TRUE case).
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'helpr_vehicles' AND column_name = 'has_car') THEN
          EXECUTE $q$INSERT INTO public.helpr_vehicles (user_id, has_car) VALUES ('00000000-0000-4000-8140-00000000000a', true)$q$;
        END IF;
      WHEN 'handed_over' THEN
        -- Board 141 (20261026155251): order H, B's pickup from seller A handed over just now, its seller payout
        -- pending and never tried (to_regclass: before 20261015042253 there is no payout table).
        IF to_regclass('public.declutter_payouts') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents,
                                                         tax_cents, delivery_cents, total_cents, paid_at, handed_over_at,
                                                         closed_at, close_reason, stripe_payment_intent_id)
                   VALUES ('00000000-0000-4000-8140-000000000502', '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', 'handed_over', 'pickup_home', 1000, 120, 0, 0, 1120,
                           now(), now(), now(), 'handed_over', 'pi_q140_h')$q$;
          EXECUTE $q$INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, debt_cents, amount_cents, status)
                   VALUES ('00000000-0000-4000-8140-000000000502', '00000000-0000-4000-8140-00000000000a', 1000, 0, 1000, 'pending')$q$;
        END IF;
      WHEN 'tip' THEN
        -- A3-8 / A2-18 (20261028210552): order T, B's handed-over Helpr delivery from seller A; its task (Helpr D,
        -- not the buyer, not blocked) is confirmed and D has a payout account, so declutter_delivery_tip_open is
        -- TRUE (to_regclass: before 20261017055505 there is no delivery table).
        IF to_regclass('public.declutter_order_deliveries') IS NOT NULL AND to_regprocedure('public.declutter_delivery_tip_open(uuid)') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents,
                                                         tax_cents, delivery_cents, total_cents, paid_at, handed_over_at,
                                                         closed_at, close_reason, stripe_payment_intent_id)
                   VALUES ('00000000-0000-4000-8140-000000000503', '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', 'handed_over', 'delivery', 1000, 120, 0, 1200, 2320,
                           now(), now(), now(), 'handed_over', 'pi_q140_t')$q$;
          EXECUTE $q$INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area,
                                                    pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
                                                    trip_miles, pay_cents, fee_cents, customer_id, pickup_contact_id, helpr_id,
                                                    open_until, latest_pickup_at, pickup_slot_start, dropoff_code, confirmed_at, confirmed_by)
                   VALUES ('00000000-0000-4000-8140-000000000601', 'declutter_delivery', '00000000-0000-4000-8140-000000000503',
                           'confirmed', 'small', '[q140] tip', 'Lafayette', 'Lafayette', '1 Pickup St', 30.2, -92.0,
                           '2 Dropoff St', 30.21, -92.01, 5, 1200, 0, '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', '00000000-0000-4000-8140-00000000000d',
                           now() + interval '1 day', now() + interval '1 day', now() - interval '1 hour', '1234', now(), 'customer')$q$;
          EXECUTE $q$INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                                    road_miles, size, delivery_cents, task_id)
                   VALUES ('00000000-0000-4000-8140-000000000503', '2 Dropoff St', 'Lafayette', 30.21, -92.01, 5, 'small', 1200,
                           '00000000-0000-4000-8140-000000000601')$q$;
          -- Task 603 (20261101184555 live position): accepted by D and started; A, the seller, is its pickup contact.
          IF to_regprocedure('public.helpr_task_position_viewer(uuid)') IS NOT NULL THEN
            -- Its own order 505 (helpr_tasks_one_per_source: one task per order), shaped as 503.
            EXECUTE $q$INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, items_cents, premium_cents,
                                                           tax_cents, delivery_cents, total_cents, paid_at, handed_over_at,
                                                           closed_at, close_reason, stripe_payment_intent_id)
                     VALUES ('00000000-0000-4000-8140-000000000505', '00000000-0000-4000-8140-00000000000b',
                             '00000000-0000-4000-8140-00000000000a', 'handed_over', 'delivery', 1000, 120, 0, 1200, 2320,
                             now(), now(), now(), 'handed_over', 'pi_q140_live')$q$;
            EXECUTE $q$INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area,
                                                      pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
                                                      trip_miles, pay_cents, fee_cents, customer_id, pickup_contact_id, helpr_id,
                                                      open_until, latest_pickup_at, pickup_slot_start, dropoff_code, started_at)
                     VALUES ('00000000-0000-4000-8140-000000000603', 'declutter_delivery', '00000000-0000-4000-8140-000000000505',
                             'accepted', 'small', '[q140] live', 'Lafayette', 'Lafayette', '1 Pickup St', 30.2, -92.0,
                             '2 Dropoff St', 30.21, -92.01, 5, 1200, 0, '00000000-0000-4000-8140-00000000000b',
                             '00000000-0000-4000-8140-00000000000a', '00000000-0000-4000-8140-00000000000d',
                             now() + interval '1 day', now() + interval '1 day', now() + interval '1 hour', '1235', now())$q$;
          END IF;
          EXECUTE $q$UPDATE public.profiles SET stripe_account_id = 'acct_q140_d' WHERE user_id = '00000000-0000-4000-8140-00000000000d'$q$;
        END IF;
      WHEN 'ship' THEN
        -- Shipping S2 (20261030000030): order 504, B's PAID shipped order from seller A ($10 + $7.33 shipping, fee rule
        -- f1_ship written out: the order triggers are off here), and its label claim 801 with a $7.33 budget.
        IF to_regprocedure('public.shipping_rate_buyable(uuid, integer)') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover, fee_rule, items_cents, premium_cents,
                                                         tax_cents, delivery_cents, shipping_cents, total_cents, paid_at, stripe_payment_intent_id)
                   VALUES ('00000000-0000-4000-8140-000000000504', '00000000-0000-4000-8140-00000000000b',
                           '00000000-0000-4000-8140-00000000000a', 'paid', 'ship', 'f1_ship', 1000, 157, 0, 0, 733, 1890, now(), 'pi_q140_s')$q$;
          EXECUTE $q$INSERT INTO public.shipments (id, declutter_order_id, idempotency_key, label_mode, service, quoted_cents, ship_to, parcel)
                   VALUES ('00000000-0000-4000-8140-000000000801', '00000000-0000-4000-8140-000000000504',
                           'declutter:00000000-0000-4000-8140-000000000504', 'test', 'usps_ground_advantage', 733,
                           '{"zip":"70501","line1":"[q140] 1 Test St"}', '{"weight_oz":12}')$q$;
        END IF;
      WHEN 'rentals' THEN
        -- Rentals S1: property P (owner D), unit, and A's active tenancy (to_regclass: before 20261017205605 there is no table).
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
        -- Homes listings (20261019043000): D lists unit U, live for 30 days.
        IF to_regclass('public.rental_listings') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.rental_listings (id, unit_id, property_id, owner_id, status, headline, rent_cents, beds, baths,
                                                        available_on, published_at, expires_at)
                   VALUES ('00000000-0000-4000-8140-000000000304', '00000000-0000-4000-8140-000000000302',
                           '00000000-0000-4000-8140-000000000301', '00000000-0000-4000-8140-00000000000d', 'live',
                           'q140 listing', 100000, 1, 1, current_date, now(), now() + interval '30 days')$q$;
        END IF;
        -- Homes public link (20261019062540): visible to anyone only once Homes is open to everyone.
        IF to_regclass('public.feature_switches') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.feature_switches (key, audience, description) VALUES ('rentals', 'everyone', 'q140 Homes')
                   ON CONFLICT (key) DO UPDATE SET audience = 'everyone'$q$;
        END IF;
      WHEN 'bucket' THEN
        INSERT INTO storage.buckets (id, name) VALUES ('user-documents', 'user-documents') ON CONFLICT (id) DO NOTHING;
      WHEN 'objects' THEN
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('user-documents', A::text || '/credentials/insurance-1787168146999.png'),
          ('user-documents', A::text || '/credentials/trade_license-1757721600000.png');
        -- Slice 5: B's photo for task T in the private helpr-tasks bucket (no bucket row needed for the check).
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('helpr-tasks', B::text || '/task/00000000-0000-4000-8140-000000000601/p.jpg');
        -- Returns (20261030071818): B's return photo for order 0501 in the private declutter-handover bucket.
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('declutter-handover', B::text || '/declutter/return/00000000-0000-4000-8140-000000000501/p.jpg');
      WHEN 'shop' THEN
        -- Shops slice 1 (20261017061155): shop S owned by A, and the 'shops'
        -- switch on for testers (D is an admin). Rolled back with the rest.
        IF to_regclass('public.shops') IS NOT NULL THEN
          EXECUTE $q$INSERT INTO public.shops (id, owner_id, name, category, area_label, pin_lat, pin_lng)
                   VALUES ('00000000-0000-4000-8140-000000000401', '00000000-0000-4000-8140-00000000000a',
                           'q140 shop', 'bakery', 'Baton Rouge', 30.45, -91.15)$q$;
          INSERT INTO public.feature_switches (key, audience, description) VALUES ('shops', 'testers', 'q140 fixture')
          ON CONFLICT (key) DO UPDATE SET audience = 'testers';
        END IF;
      WHEN 'availability' THEN
        -- Instant book (20261101063725): B is free a week from today, 09:00-17:00, so
        -- instant_book_helper_free_on(B, that day) is TRUE.
        INSERT INTO public.helper_availability (helper_id, specific_date, start_time, end_time, is_available)
        VALUES ('00000000-0000-4000-8140-00000000000b', CURRENT_DATE + 7, '09:00', '17:00', true);
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
