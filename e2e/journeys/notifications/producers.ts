/**
 * EVERY NOTIFICATION PRODUCER, AND WHICH JOURNEY LEG ASSERTS ITS ROW (Q230).
 *
 * notifications.spec.ts promised that the legs it cannot drive are "annotated
 * uncovered". On 2026-09-26 five of them (direct offer, saved-search match,
 * job-match fan-out, tip, the cron notifications) had neither an annotation nor
 * a leg. This registry is the fix for the whole class, not the five:
 *
 *   - its keys are the producer inventory DERIVED FROM SOURCE by
 *     src/test/helpers/notificationProducers.ts (every SQL function that inserts
 *     into notifications, every edge-function file that does, every
 *     create-notification template), and
 *     src/test/notificationProducersCovered.test.ts fails in BOTH directions:
 *     a producer with no entry here, or an entry for a producer that is gone;
 *   - a `driven` entry names the journey spec and a code EVIDENCE string (the
 *     REST filter or copy it asserts on) that must appear in that spec's code,
 *     comments excluded — "driven" means a leg asserts the row, not that a leg
 *     happens to pass through the door;
 *   - every `uncovered` entry is announced at run time by
 *     notifications.spec.ts ("every producer no leg asserts is annotated
 *     uncovered"), so the reason is on the run, not only in this file.
 *
 * "GAP" reasons are honest open work: reachable with the two shared accounts,
 * not asserted by any leg yet.
 */

export type ProducerCoverage =
  | { driven: { spec: string; evidence: string } }
  | { uncovered: string };

const NOTIF = "e2e/journeys/notifications/notifications.spec.ts";
const MONEY = "e2e/journeys/04-money-outcomes.spec.ts";
const MARKET = "e2e/journeys/02-marketplace.spec.ts";
const ADMIN_SAFETY = "e2e/journeys/04-admin-safety.spec.ts";

/* Reasons shared by several producers. Each names the concrete obstacle. */
const CRON = (job: string) =>
  `pg_cron job "${job}" is its only caller and authenticated has no EXECUTE on it (has_function_privilege, prod, 2026-09-26), so no journey door can fire it on demand`;
const SCHEDULED_EDGE =
  "scheduled edge function (cron-invoked with the service-role key); a journey has no door that runs it on demand, and waiting for its schedule does not fit a nightly journey";
const STRIPE_EVENT = (event: string) =>
  `fires on the Stripe webhook event ${event}, which the journeys' test-mode 4242 checkout never produces`;
const STRIKE =
  "writes a strike/violation or a ban-status change against its target; the only targets a journey has are the two shared accounts, and striking them locks every lane (the same lock-out scenarios.ts REAL_BACKEND_UNREACHABLE records). Needs a dedicated seed account the run may strike and restore";
const ADMIN_ONLY = (what: string) =>
  `admin-only (${what}); the admin password exists only as a CI secret and no journey leg drives this door yet — GAP`;
const GAP = (door: string) =>
  `GAP — reachable with the two shared accounts via ${door}, but no journey leg asserts the notification row it writes`;
const FANOUT =
  "fans a funded job out to real Helprs (by parish, or by location for an urgent job); seed jobs were visible publicly when this was written (seed_jobs_hidden_publicly() = false on prod, measured 2026-09-26; true since 2026-10-06, measured 2026-10-14, which also stops the fan-out for is_seed jobs), so a journey job that carried a parish or location could notify real users whenever the switch is off. The journeys keep parish null on purpose";
const SERIES =
  "GAP — a recurring series; no journey posts one between the two shared accounts, and every visit of a funded series is its own Stripe test charge, so the series doors and the notification rows they write are not driven";
const BAN_SETTLE =
  "GAP — runs when an account becomes banned; 04-admin-safety bans a throwaway that holds no live job or series, so the settlement branches that notify the counter-party never fire. A throwaway with a funded job against a shared account is not driven yet";
const DISPUTE =
  "needs an open dispute; every rpc_open_dispute pages #ops-alerts (notify_ops_dispute_filed) and freezes an escrow for an admin, so the journeys do not open one per run (e2e/prod-audit/fundedOpenJob.ts keeps ONE disputed fixture instead)";

// @two-way src/test/notificationProducersCovered.test.ts:an entry whose producer is gone from source fails
export const NOTIFICATION_PRODUCERS: Record<string, ProducerCoverage> = {
  // ── SQL functions ───────────────────────────────────────────────────────
  "sql:identity_notify_posters_before_start": { uncovered: "tells a poster 24 hours before the start that their Helpr has not verified their ID, and only while the identity_check switch is on, which stays off until one real session works; a journey cannot wait out a real start. Proven in src/test/pglite/idCheckTiming.pglite.mjs (sent once, not again on a second run)." },
  "sql:admin_reverse_violation": { uncovered: ADMIN_ONLY("reverses a violation from the admin user view") },
  "sql:apply_consequence_ladder": { uncovered: STRIKE },
  "sql:sweep_unanswered_applications": { uncovered: "needs a pending application 24 to 72 hours old in daytime; the journeys apply and answer in the same pass. Proven in src/test/pglite/applicantNudgesAndFilledNotice.pglite.mjs." },
  "sql:nudge_confirm": { uncovered: "a Nudge needs a booked job inside its day-before window with the other side unconfirmed; the journeys book same-pass seed jobs that never sit in that window. Proven in src/test/pglite/confirmRepost.pglite.mjs (sent, too soon, already confirmed, not a party, restricted)." },
  "sql:end_recurring_series_by_platform": { uncovered: "ends a recurring series for the platform (an admin with a reason, or a chargeback); the journeys create no recurring series with a booked Helpr, and Stripe is live, so a chargeback cannot be made. Proven in src/test/pglite/seriesEndByPlatform.pglite.mjs and src/test/edge/chargebackEndsSeries.test.ts." },
  "sql:sweep_unfilled_series_visit_reminders": { uncovered: "tells a poster a funded series visit is still empty the day before it; the journeys create no recurring series, and the sweep runs once a day. Proven on a fixed clock in src/test/pglite/unfilledSeriesVisitReminder.pglite.mjs." },
  "sql:sweep_job_post_drafts": { uncovered: "one reminder for a draft left a while, only for real (non-seed) members who have not posted since; the journeys' accounts are seed accounts (skipped by design) and a journey cannot wait that out. Proven in src/test/pglite/jobPostDrafts.pglite.mjs." },
  "sql:sweep_idv_review_waiting": { uncovered: "an hourly sweep tells every admin when a REAL (non-seed) member's ID check has sat in manual review over 24 hours; the journeys' shared accounts are seed accounts (skipped by design) and a journey cannot wait 24 h. Proven on a fixed clock in src/test/pglite/idvReviewWaitingClock.pglite.mjs and in src/test/pglite/idvRestartAfterManualReview.pglite.mjs (seed skip, history vs updated_at, grants)." },
  "sql:sweep_backout_notice_reminders": { uncovered: "re-pushes only an unacknowledged back-out 30+ minutes old inside 24 h of a start; a journey cannot wait that out. Proven in src/test/pglite/backoutNotices.pglite.mjs." },
  "sql:sweep_confirm_reminders_and_repost": { uncovered: "reminds every 3 h and reposts at T-2h only on jobs posted by real (non-seed) accounts; the journeys post as is_seed and are exempt by design. Proven in src/test/pglite/confirmRepost.pglite.mjs." },
  "sql:send_new_member_daily_summary": { uncovered: "the daily cron (13:11 UTC, service_role only) sends each admin ONE notice naming the real members who confirmed since the last run (owner, 2026-10-30; it replaced the per-member \"New member joined\"); the journeys' shared accounts confirmed long ago and are test accounts, skipped by design, and a journey cannot click a real verification email or wait out the cron. Proven in src/test/pglite/newMemberDailySummary.pglite.mjs." },
  "sql:notify_admins_support_ticket": { uncovered: "rings every admin when a real member or a guest files a support ticket; the journeys' shared accounts are test accounts (skipped by design), and a guest ticket would ring the real admins. Proven in src/test/pglite/supportTicketAdminBell.pglite.mjs." },
  "sql:expire_unanswered_schedule_changes": { uncovered: "the auto-expire-jobs sweep (service_role only) tells the asker once when their date/time request is still unanswered at the job's start; a journey cannot wait out a real start. Proven in src/test/pglite/scheduleChangeExpiryNotice.pglite.mjs (asker told once, a second run sends nothing, answered rows untouched)." },
  "sql:notify_schedule_change_expired": { uncovered: "fires only when a date/time request is answered after its new time or the original start has passed; a journey cannot wait out a real start. Proven in src/test/pglite/scheduleChangeLeadAndExpiry.pglite.mjs (both reasons, the asker told once each)." },
  "sql:apply_job_denial_consequence": { uncovered: STRIKE },
  "sql:apply_low_rating_flag": { uncovered: STRIKE },
  "sql:apply_message_scan_consequence": { uncovered: STRIKE },
  "sql:auto_escalate_reports": {
    uncovered: "fires only when 3+ DISTINCT reporters have open reports on one account inside 90 days; the two shared accounts can supply one reporter against each other",
  },
  "sql:auto_restrict_repeat_violators": { uncovered: STRIKE },
  "sql:block_user_and_settle": {
    uncovered: "blocks the other party; a block between the two shared accounts refuses every hire, message and offer the other lanes drive (are_users_blocked) until it is lifted",
  },
  "sql:referral_settle_for": {
    uncovered: "pays a referral once both the referrer and the referred member have a completed job (20261027201034, called by check_referral_bonus); no referrals row names either shared account (measured on prod 2026-09-26: 0 rows), and a new referred account needs a signup the journeys cannot complete (email verification)",
  },
  "sql:claim_series_dates": { uncovered: SERIES },
  "sql:clear_job_accept_pending": {
    uncovered:
      "tells a Helpr their pending direct accept ended because the poster changed the offer's terms; a pending accept needs a Helpr whose payout setup is unfinished, and every journey account is a seed account whose accept is never pending (helper_accept_missing's seed carve-out). Proven in PGlite instead (src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs S14, P7, P9; Q1185)",
  },
  "sql:complete_job_accept": { driven: { spec: ADMIN_SAFETY, evidence: "rpc/accept_job_offer" } },
  "sql:complete_pending_accepts_on_setup": {
    uncovered:
      "fires only when Stripe reports a Helpr's payout setup and Stripe ID done while their accept is pending; every account a journey has is a seed account whose accept is never pending (helper_accept_missing's seed carve-out), and a journey cannot finish live Stripe onboarding (Stripe is LIVE). Proven in PGlite instead (src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs, Q1180)",
  },
  "sql:complete_pending_crew_confirms_on_setup": {
    uncovered:
      "fires only when Stripe reports payouts ready for a crew member whose Confirm is pending; journey accounts are seed accounts (never pending) and a journey cannot finish live Stripe onboarding (Stripe is LIVE). Proven in PGlite instead (src/test/pglite/crewHireBeforePayout.pglite.mjs C6, 20261007011530)",
  },
  "sql:start_underfilled_crews": {
    uncovered:
      "fires only for a funded crew at its hiring cutoff with a confirmed member and an empty spot; a journey cannot fund a crew on prod (Stripe is LIVE, no 4242). Proven in PGlite instead (src/test/pglite/crewUnderfilledStarts.pglite.mjs, Q1460)",
  },
  "sql:decline_job_offer": { uncovered: STRIKE },
  "sql:deliver_job_match": { uncovered: FANOUT },
  "sql:deliver_parish_match_alert": { uncovered: FANOUT },
  "sql:deliver_saved_search_alert": {
    uncovered:
      "every journey job is is_seed and seed_jobs_hidden_publicly() is true on prod (since 2026-10-06 19:26Z, measured 2026-10-14), so notify_saved_searches_on_new_job never queues a saved-search alert for one; 04-money-outcomes asserts the alert is NOT sent while the switch is on and asserts it sent only when the switch is off. The sent alert is proven in src/test/pglite (savedSearchAlertsWaitForEarlyAccess.test.ts)",
  },
  "sql:detect_stuck_payments": { uncovered: CRON("detect-stuck-payments") },
  "sql:end_recurring_series": { uncovered: SERIES },
  "sql:end_series_for_banned_account": { uncovered: BAN_SETTLE },
  "sql:enforce_retained_payment_ban": {
    uncovered: "needs a banned account's card or payout bank on a new account; live Stripe on prod cannot mint one (Q1324); asserted in src/test/pglite/banEvasionCardBankName.pglite.mjs",
  },
  "sql:expire_pending_direct_offers": {
    uncovered: "called only by the auto-expire-jobs edge function (scheduled) once a direct offer's window has passed; the shortest window is 1 hour",
  },
  "sql:jobs_offer_target_gone_retires_offer": {
    uncovered: "fires only when the Helpr a pending direct offer names deletes their account (purge or the Q448 FK); asserted in src/test/pglite/personFksQ448.pglite.mjs",
  },
  "sql:expire_unanswered_offers": {
    uncovered: "called only by the auto-expire-jobs edge function (scheduled) once a hire's response deadline has passed, and it records a no-response strike on the Helpr",
  },
  "sql:helper_abort_job": { uncovered: STRIKE },
  "sql:helper_cancel_booking": { uncovered: STRIKE },
  "sql:job_access_notes_changed": {
    uncovered: "Q1461: fires when the poster changes the access notes of a hired job; no journey edits them on a hired job yet (asserted in src/test/pglite/jobAccessNotes.pglite.mjs) — GAP",
  },
  "sql:mark_helper_arrival": { uncovered: GAP("the 02-marketplace day-of ladder and settleForward (mark_helper_arrival)") },
  "sql:notify_helper_application_viewed": { uncovered: GAP("02-marketplace J3 (the poster opens the applicant)") },
  "sql:notify_helper_on_direct_offer": {
    uncovered:
      "fires only on the job's FIRST funding (Q2093, owner 2026-10-17: no offer before the money is paid) and a nightly never pays in LIVE mode (owner 2026-09-27); notifications.spec.ts asserts the unfunded half on prod (an unpaid offer writes NO type=eq.new_offers row), and the funded half is proven in src/test/pglite/directOfferWaitsForFunding.pglite.mjs",
  },
  "sql:notify_helpr_of_booking_clash": {
    uncovered: "Q1326: fires when the test Helpr is hired for two funded journey jobs at overlapping times; no journey books two at once (asserted in src/test/pglite/helprDoubleBookingNotice.pglite.mjs). Not sent when a CREW job is moved (crew jobs leave jobs.helper_id NULL; the card notice still shows it) — GAP",
  },
  "sql:notify_helper_on_tip": { driven: { spec: MONEY, evidence: "type=eq.financial_alerts" } },
  "sql:notify_message_recipient": { driven: { spec: NOTIF, evidence: "type=eq.message" } },
  "sql:jobs_open_edit_tells_applicants": { uncovered: "tells a job's waiting applicants when its poster edits the date, time, place or details (at most hourly); the journeys never edit a job after someone applies. Proven in src/test/pglite/openJobEditTellsApplicants.pglite.mjs." },
  "sql:notify_on_application": { driven: { spec: MARKET, evidence: "poster gets a notification for the application" } },
  "sql:notify_on_job_update": { uncovered: GAP("the 02-marketplace hire and day-of ladder (jobs status updates)") },
  "sql:notify_on_payment_escrowed": { uncovered: GAP("any funded journey job (stripe-webhook flips payment_status to escrow)") },
  "sql:notify_poster_on_status_change": { uncovered: GAP("the 02-marketplace day-of ladder") },
  "sql:notify_user_on_review": {
    uncovered: GAP("02-marketplace J5 reviews both ways (the row is written after the blind-period reveal)"),
  },
  "sql:offer_series_dates": { uncovered: SERIES },
  "sql:open_dispute_as": { uncovered: DISPUTE },
  "sql:poster_cancel_job": {
    uncovered: GAP("poster_cancel_job on an unfunded or unhired job (the notifying branches need a hired Helpr, which records a cancel_with_helper strike on the poster)"),
  },
  "sql:quote_notify_to": {
    uncovered:
      "the 'quotes' switch is created OFF (feature_switches, 20261015091114) and every caller (submit_job_quote, respond_to_job_quote) refuses with feature_disabled until it is on for the shared accounts; the hire-on-pay notice needs a live escrow payment (Stripe is LIVE, never paid by a journey) and sweep_quote_alerts a 4-hour reply deadline or a closed quote window, so a two-account quote journey waits for the switch to be on for testers (behaviour: src/test/pglite/quoteHireOnPay.pglite.mjs)",
  },
  "sql:rentals_notify": {
    uncovered:
      "Rentals S1 (20261017205605): every caller is a Rentals RPC behind the hidden 'rentals' switch, created OFF, so require_feature refuses the two shared accounts until the switch reaches testers. The rows (landlord told of a new / emergency request and a tenant joining; tenant told of approve / decline; owner told of the ownership check) are proven in src/test/pglite/rentalsMaintenance.pglite.mjs.",
  },
  "sql:rentals_submit_ownership_proof": {
    uncovered:
      "Rentals S3 (20261017223352): the 'Ownership proof waits for review' admin alert; the RPC starts with require_feature('rentals'), the hidden switch created OFF, so it refuses the shared accounts until the switch reaches testers, and a test landlord's upload never pages a real admin (notification_crosses_seed_boundary). Proven in src/test/pglite/rentalsMaintenance.pglite.mjs (one alert per waiting spell to the admin, none to the landlord, the close rule maps it).",
  },
  "sql:rentals_submit_landlord_id": {
    uncovered:
      "Landlord ID by admin review (20261019051407): the 'Landlord ID waits for review' admin alert; the RPC starts with require_feature('rentals'), the hidden switch created OFF, so it refuses the shared accounts until the switch reaches testers, and a test landlord's upload never pages a real admin (notification_crosses_seed_boundary). Proven in src/test/pglite/landlordIdReview.pglite.mjs (one alert per waiting spell, the close rule maps it to rentals-landlord-id-review).",
  },
  "sql:cancel_job_after_failed_bank_payment": {
    uncovered:
      "Q1972 (20261017205845): runs only from the stripe-webhook payment_intent.payment_failed handler (EXECUTE service_role only) when a hired job's bank payment fails; Stripe is live and the journeys never pay, so no bank payment can be made to fail. Proven in src/test/pglite/failedBankPaymentCancelsHiredJob.pglite.mjs (the confirmed Helpr told once, the poster told plainly, no fee, no strike).",
  },
  "sql:rpc_open_refund_request": {
    uncovered:
      "Board 141 refund request (20261021102943): needs a hired job whose money is HELD in escrow, which on prod means a paid live Stripe checkout (Stripe is LIVE and the journeys never pay), and the RPC starts with require_feature('refund_requests'). The Helpr's 'Refund request' notice is proven in src/test/pglite/refundRequests.pglite.mjs (O9: First L., the amount, the 2-day clock).",
  },
  "sql:rpc_answer_refund_request": {
    uncovered:
      "Board 141 refund answer (20261021102943): needs an open refund request on an escrow-funded hired job (a paid live Stripe checkout, which the journeys never make). The poster's 'Refund agreed' and 'Offer to come back and finish' notices are proven in src/test/pglite/refundRequests.pglite.mjs (AG9, FN2).",
  },
  "sql:rpc_withdraw_refund_request": {
    uncovered:
      "Board 141 withdraw (20261021102943): needs an open refund request on an escrow-funded hired job (a paid live Stripe checkout, which the journeys never make). The Helpr's 'Refund request withdrawn' notice is proven in src/test/pglite/refundRequests.pglite.mjs (W2).",
  },
  "sql:refund_requests_sweep": {
    uncovered:
      "Board 141 sweep (20261021102943): service-only, run by the refund-request-sweep cron on a request declined or unanswered for 2 days on an escrow-funded job (a paid live Stripe checkout, never made by a journey). The poster's 'Your refund request goes to Helpr' notice is proven in src/test/pglite/refundRequests.pglite.mjs (E3).",
  },
  "sql:refund_agreements_due": {
    uncovered:
      "Board 141 held agreement (20261021102943): service-only, run by the refund-request-sweep cron on an agreed refund on an escrow-funded job (a paid live Stripe checkout, never made by a journey) whose poster or Helpr is banned, suspended, under a ban review or on a payout hold. Both parties' 'Your refund is waiting on Helpr' notice is proven in src/test/pglite/refundRequests.pglite.mjs (HD-notify).",
  },
  "sql:request_job_schedule_change": { uncovered: GAP("request_job_schedule_change on a hired journey job (the other party answers with respond_job_schedule_change)") },
  "sql:respond_job_schedule_change": { uncovered: GAP("respond_job_schedule_change after the other party asks to move a hired journey job") },
  "sql:withdraw_job_schedule_change": { uncovered: GAP("withdraw_job_schedule_change after asking to move a hired journey job") },
  "sql:request_job_detail_change": { uncovered: GAP("request_job_detail_change on a hired journey job (each booked Helpr answers with respond_job_detail_change)") },
  "sql:respond_job_detail_change": { uncovered: GAP("respond_job_detail_change after the poster asks to change a hired journey job's details") },
  "sql:settle_job_detail_change": { uncovered: GAP("settle_job_detail_change when the last booked Helpr accepts, or a crew member leaves after the rest accepted (Q1500)") },
  "sql:respond_to_direct_offer": { driven: { spec: NOTIF, evidence: "rpc/respond_to_direct_offer" } },
  "sql:review_credential": { uncovered: ADMIN_ONLY("the credential review queue; the shared helper has no pending credential to review") },
  "sql:rpc_decide_crew_dispute": { uncovered: DISPUTE },
  "sql:rpc_decide_dispute": { uncovered: DISPUTE },
  "sql:rpc_escalate_dispute": { uncovered: DISPUTE },
  "sql:rpc_group_member_mark_arrival": {
    uncovered: "group jobs are withdrawn (GROUP_JOBS_ENABLED = false in src/lib/groupJobs.ts), so no journey can post one",
  },
  "sql:rpc_group_member_mark_done": {
    uncovered: "group jobs are withdrawn (GROUP_JOBS_ENABLED = false in src/lib/groupJobs.ts), so no journey can post one; the 'Your offer closed' notice is asserted in src/test/pglite/crewUnconfirmedSpot.pglite.mjs (U2)",
  },
  "sql:rpc_supersede_dispute_decision": { uncovered: DISPUTE },
  "sql:series_holds_on_hire": { uncovered: SERIES },
  "sql:series_release_dates": { uncovered: SERIES },
  "sql:settle_one_off_jobs_for_banned_account": { uncovered: BAN_SETTLE },
  "sql:sweep_daily_job_digest": { uncovered: CRON("sweep-daily-job-digest") },
  "sql:sweep_dayof_confirm_reminders": { uncovered: CRON("sweep-dayof-confirm-reminders") },
  "sql:sweep_expired_auto_bans": { uncovered: CRON("sweep-expired-auto-bans") },
  "sql:sweep_job_start_reminders": { uncovered: CRON("sweep-job-start-reminders") },
  "sql:sweep_no_show_alerts": { uncovered: CRON("sweep-no-show-alerts") },
  "sql:sweep_open_ban_settlement_reviews": { uncovered: CRON("ban-review-watch") },
  "sql:sweep_release_last_chance": { uncovered: CRON("sweep-release-last-chance") },
  "sql:sweep_helpr_start_reminders": { uncovered: CRON("sweep-helpr-start-reminders") },
  // Declutter (20261014210518 / 20261014224914): behind the hidden 'declutter' switch; no journey trades yet.
  "sql:bill_helpr_fault_card_fee": { uncovered: "the Helpr's 'Card fee added' notice after an admin rules the Helpr at fault (J4, 20261019015301): called only by create-payment's full-refund path (EXECUTE service_role only), which needs a real paid job refunded, and journeys never pay on live Stripe. Proven in src/test/edge/create-payment.test.ts (the bill call and its cents) and src/test/helprFaultFullRefund.test.ts." },
  "sql:declutter_notify_strict": { uncovered: "GAP — the one notification writer of the Declutter RPCs and sweeps (offers, cart, checkout, strikes, handover, pickup reminders, listing submitted, questions), since 20261028162048: it types each notice with its Declutter kind (declutter_notice_type) and raises on failure; declutter_notify wraps it and logs instead. Declutter is behind the hidden 'declutter' switch and no journey leg drives a Declutter trade yet. Its rows are proven in src/test/pglite/declutterNoticeKinds.pglite.mjs (routing per kind, the push gate per Declutter switch, seed rule, a lost notice logged, a failed pickup reminder retried) and src/test/pglite/declutterSlice3.pglite.mjs." },
  "sql:guarantee_tell": { uncovered: "GAP: the one notification writer of the Helpr Guarantee (Q2450, 20261027200455): a request opened, the Helpr answering, marked fixed, the poster answering, the sweep escalating or closing. No journey leg completes a job and opens a request yet. Its rows are proven in src/test/pglite/helprGuarantee.pglite.mjs (the Helpr is told on opening; each answer and the sweep tell the other side)." },
  "sql:declutter_wanted_notify": { uncovered: "GAP — the one notification writer of Declutter wanted posts (20261016053541): the seller's 'Someone near you wants one' and the poster's 'A match for what you want'. Behind the hidden 'declutter' + 'declutter_wanted' switches and no journey leg posts a wanted item yet; called only from declutter_create_wanted and the 'declutter-wanted' cron (EXECUTE service_role only). Proven in src/test/pglite/declutterWantedPriceHint.pglite.mjs (wording, caps, blocks, mutes, seed isolation, stamps only on a written row)." },
  "sql:declutter_record_ai_check": { uncovered: "GAP — the photo check's verdict on a live listing (LEAD-POST-SLOW, 20261031152545): a flag takes the listing down and tells the seller 'Your listing is waiting for a check' and each offer or cart buyer 'Listing changed'; a flag on a reserved or sold listing holds the payout and sends every admin an admin_alert (test accounts skipped). service_role only, called by the declutter-ai-check edge function; Declutter is behind the hidden 'declutter' switch and no journey leg posts a listing the check flags. Proven in src/test/pglite/declutterCheckAfterPost.pglite.mjs." },
  "sql:declutter_hold_unchecked_listings": { uncovered: "GAP — the 15-minute sweep for listings whose photo check never came back (LEAD-POST-SLOW, 20261031152545): it holds the listing and tells the seller 'Your listing is waiting for a check' (or 'Your sale is waiting for a check' with an admin_alert to every admin, test accounts skipped, when it was reserved or sold) and each offer or cart buyer 'Listing changed'. service_role only, run by cron; a journey cannot wait 15 minutes on an unchecked live listing. Proven in src/test/pglite/declutterCheckAfterPost.pglite.mjs." },
  "sql:declutter_price_drop_alert": { uncovered: "GAP — the AFTER UPDATE OF current_price_cents trigger on declutter_items (20261027204745, Q2429) that tells an item's watchers its price dropped or it is now free; it replaced the evening sweep's inline notice. Declutter is behind the hidden 'declutter' switch and no journey leg watches an item and lowers its price yet. Proven in src/test/pglite/declutterPriceDropAlerts.pglite.mjs (never the seller, blocked pairs skipped, 3-day per-item rate limit, a hidden seller tells nobody) and, on a uuid notifications.id like prod's (its old bigint v_notified rolled every alert back), src/test/pglite/declutterNoticeKinds.pglite.mjs." },
  "sql:track_revision_scope_creep": {
    uncovered: "notifies only on a job's THIRD revision request, and files a fraud_flags scope_creep row against the poster (a shared account) when it does",
  },

  // ── Edge functions ──────────────────────────────────────────────────────
  "edge:admin-support-reply": { uncovered: ADMIN_ONLY("an admin's reply to a support ticket; it emails the ticket's member, and the shared journey accounts file no support ticket") },
  "edge:admin-update-email": { uncovered: ADMIN_ONLY("changes another account's email; on a shared journey account it would lock that account's sign-in") },
  "edge:admin-user-actions": { uncovered: ADMIN_ONLY("ban / warning / verification actions on another account — see e2e/journeys/adminWritePaths.ts") },
  "edge:arrival-confirm-reminder": { uncovered: SCHEDULED_EDGE },
  "edge:auto-expire-jobs": { uncovered: SCHEDULED_EDGE },
  "edge:auto-release-payment": { uncovered: SCHEDULED_EDGE },
  "edge:auto-resolve-disputes": { uncovered: SCHEDULED_EDGE },
  "edge:auto-tip-charge": { uncovered: SCHEDULED_EDGE },
  "edge:cash-out-credits": {
    uncovered: "cashes out referral credits; neither shared account holds any (referral_credits, measured on prod 2026-09-26: 0 rows)",
  },
  "edge:card-hold-sweep": { uncovered: SCHEDULED_EDGE },
  "edge:charge-recurring-visits": { uncovered: SCHEDULED_EDGE },
  "edge:check-pro-subscription": {
    uncovered: "writes on a Pro subscription state change; the shared accounts are free tier and a Pro checkout is a recurring charge the journeys do not start",
  },
  "edge:create-notification": { driven: { spec: NOTIF, evidence: 'template: "test"' } },
  "edge:create-payment": { driven: { spec: MONEY, evidence: '"Refund issued: $*"' } },
  "edge:execute-dispute-split": { uncovered: DISPUTE },
  "edge:expire-subscriptions": { uncovered: SCHEDULED_EDGE },
  "edge:expiring-jobs-push": { uncovered: SCHEDULED_EDGE },
  "edge:instant-payout": {
    uncovered: "GAP — an instant payout moves the shared helper's available Connect balance out; not driven, and whether a nightly may drain that test balance is an owner decision",
  },
  "edge:payment-confirm-reminder": { uncovered: SCHEDULED_EDGE },
  "edge:payout-setup-reminders": { uncovered: "reminds a hired Helpr with no payout account (owner 2026-10-25); it sends only while payout_after_hire AND payout_setup are on, and payout_setup is off on prod (Stripe closed the platform account), so no journey can reach it. Proven in src/test/edge/payout-setup-reminders.test.ts and src/test/pglite/payoutAfterHire.pglite.mjs." },
  "edge:process-scheduled-payouts": { uncovered: SCHEDULED_EDGE },
  "edge:release-payout": {
    uncovered: GAP("the release in settleForward / 02-marketplace J5 (its notification rows are not asserted)"),
  },
  "edge:review-nag-cron": { uncovered: SCHEDULED_EDGE },
  "edge:saved-helper-availability-push": { uncovered: SCHEDULED_EDGE },
  "edge:stalled-completion-reminder": { uncovered: SCHEDULED_EDGE },
  // Q768: the turnover notice needs a test-owned STR calendar whose iCal feed has a checkout this week; no journey account has one.
  "edge:str-ical-sync": { uncovered: SCHEDULED_EDGE },
  "edge:stripe-connect": {
    uncovered: "writes on Connect onboarding steps; the shared helper's Connect account is already onboarded and is load-bearing for every money leg",
  },
  "edge:stripe-idv-webhook": {
    uncovered: "fires on a Stripe Identity verification event; the shared helper is already verified and must stay so",
  },
  "edge:_shared/connectGateSync": {
    uncovered:
      "sends \"Payout account verified\" the first time a Helpr's Stripe Connect account turns payouts-enabled (stripe-connect status check or the recheck-pending-accepts sweep); the shared accounts' Connect state is fixed and a journey never completes Connect onboarding on live Stripe",
  },
  "edge:_shared/payDelayNotice": { uncovered: "tells a Helpr a payout is 12 hours past its promised day, on a failed transfer or an account that cannot be paid; never about a test job, and a journey cannot wait out a payout day. Proven in src/test/payDelayNotice.test.ts." },
  "edge:_shared/chargebackClawback": { uncovered: STRIPE_EVENT("charge.dispute.* (a chargeback)") },
  "edge:_shared/checkoutNudge": { uncovered: STRIPE_EVENT("checkout.session.expired on a new job's unpaid checkout (one \"Finish posting your job\" notice, switch checkout_nudge 'testers'); asserted in src/test/edge/checkoutNudge.test.ts") },
  // Q2399 card hold at post: the poster's hold notices and the Helpr's "waiting on payment" notice need a card HOLD
  // (a manual-capture authorization) that the journeys cannot place: Stripe is live on prod and the e2e 05-card-hold
  // legs are test.skip with their reason; the behaviour is asserted in src/test/edge/card-hold.test.ts.
  "edge:_shared/cardHold": { uncovered: STRIPE_EVENT("checkout.session.completed for a card-hold (manual capture) checkout, then a hire's capture") },
  "edge:stripe-webhook/handlers/cardHoldCheckout": { uncovered: STRIPE_EVENT("checkout.session.completed for a card-hold (manual capture or setup) checkout") },
  "edge:_shared/heldTipRepay": { uncovered: STRIPE_EVENT("checkout.session.completed for a tip to a Helpr under a payout hold") },
  "edge:stripe-webhook/handlers/accountUpdated": { uncovered: STRIPE_EVENT("account.updated with a requirements change") },
  "edge:stripe-webhook/handlers/chargeDisputeClosed": { uncovered: STRIPE_EVENT("charge.dispute.closed") },
  "edge:stripe-webhook/handlers/chargeDisputeCreated": { uncovered: STRIPE_EVENT("charge.dispute.created") },
  "edge:stripe-webhook/handlers/_payoutFailedNotice": { uncovered: STRIPE_EVENT("transfer.failed / transfer.canceled on a Helpr payout or cancellation-fee transfer (Stripe fails a transfer only on its own side, never forced on prod); asserted in src/test/edge/transferFailedTellsHelpr.test.ts") },
  "edge:stripe-webhook/handlers/payoutFailed": { uncovered: STRIPE_EVENT("payout.failed on a member's connected account (board 143); a bank must return a real payout, never forced on prod") },
  "edge:stripe-webhook/handlers/chargeRefunded": {
    uncovered: GAP("any cancel_escrow / admin refund (charge.refunded arrives in test mode); its row is not asserted"),
  },
  "edge:_shared/crewBlockFees": {
    uncovered: "tells a crew member their block fee was paid (Q1390); needs a poster to block a committed crew member inside 24h of the start and the job to settle, a live payout on prod; asserted in src/test/edge/process-scheduled-payouts-crew.test.ts",
  },
  "edge:stripe-webhook/handlers/chargeRefundUpdated": { uncovered: STRIPE_EVENT("charge.refund.updated to failed (a refund the bank returned; Q1355), asserted in src/test/edge/chargeRefundUpdated.test.ts") },
  "edge:stripe-webhook/handlers/checkoutSessionExpired": { uncovered: STRIPE_EVENT("checkout.session.expired (an abandoned gift-card shortfall Checkout)") },
  "edge:stripe-webhook/handlers/checkoutSessionCompleted": {
    uncovered: GAP("the tip leg in 04-money-outcomes (it RECORDS whether this handler's \"You received a tip!\" row lands beside the trigger's, but does not assert it: two in-app rows for one tip is a suspected duplicate)"),
  },
  "edge:stripe-webhook/handlers/paymentIntentPaymentFailed": {
    uncovered:
      "fires on payment_intent.payment_failed for an ACH debit that bounced (R01 return); ACH bounces arrive 2–5 business days after checkout and only the expired-session path notifies (stripe_session_id already null). A real ACH R01 return cannot be triggered in automated tests on prod (Stripe is LIVE, no test-mode 4242). Asserted structurally by src/test/declineNoticeWaitsForSessionExpiry.test.ts (ME-046).",
  },
  // Q1714: THE refund notice every refund path sends (in the app and by email).
  // The admin full + partial refund leg asserts its two rows by their refund
  // link and copy.
  "edge:_shared/refundNotice": { driven: { spec: "e2e/journeys/04-admin-safety.spec.ts", evidence: "Refund issued: \\$" } },
  "edge:stripe-webhook/handlers/settleOnboardingFee": {
    uncovered: "fires on the one-time onboarding-fee checkout; both shared accounts paid it long ago",
  },
  "edge:void-cancelled-payments": { uncovered: SCHEDULED_EDGE },
  "edge:weekly-helper-report": { uncovered: SCHEDULED_EDGE },

  // ── create-notification templates (named by the client) ─────────────────
  "template:application_declined": { uncovered: GAP("the poster declining the helper's application") },
  "template:arrival_confirmed": { uncovered: GAP("the 02-marketplace day-of ladder") },
  "template:dispute_resolved": { uncovered: DISPUTE },
  "template:dispute_response": { uncovered: DISPUTE },
  "template:dispute_withdrawn": { uncovered: DISPUTE },
  "template:job_confirmed": { uncovered: GAP("the 02-marketplace hire (the helper confirms)") },
  "template:job_offer": { uncovered: GAP("the 02-marketplace hire (the poster's offer to an applicant)") },
  // J11 reports a THROWAWAY Helpr's no-show and asserts the warning row.
  "template:no_show_reported": { driven: { spec: ADMIN_SAFETY, evidence: '.toContain("⚠️ No-show warning")' } },
  "template:revision_acknowledged": { uncovered: GAP("02-marketplace J5's revision") },
  "template:revision_requested": { uncovered: GAP("02-marketplace J5's revision") },
  "template:work_confirmed": { uncovered: GAP("the 02-marketplace day-of ladder") },
  "template:work_started": { uncovered: GAP("the 02-marketplace day-of ladder") },
};

/** Producers no leg asserts, with the reason — announced by notifications.spec.ts. */
export function uncoveredProducers(): Array<{ producer: string; why: string }> {
  return Object.entries(NOTIFICATION_PRODUCERS).flatMap(([producer, c]) =>
    "uncovered" in c ? [{ producer, why: c.uncovered }] : [],
  );
}
