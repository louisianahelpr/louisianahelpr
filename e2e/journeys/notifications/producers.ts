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
const DISPUTE =
  "needs an open dispute; every rpc_open_dispute pages #ops-alerts (notify_ops_dispute_filed) and freezes an escrow for an admin, so the journeys do not open one per run (e2e/prod-audit/fundedOpenJob.ts keeps ONE disputed fixture instead)";

// @two-way src/test/notificationProducersCovered.test.ts:an entry whose producer is gone from source fails
export const NOTIFICATION_PRODUCERS: Record<string, ProducerCoverage> = {
  // ── SQL functions ───────────────────────────────────────────────────────
  "sql:admin_reverse_violation": { uncovered: ADMIN_ONLY("reverses a violation from the admin user view") },
  "sql:apply_consequence_ladder": { uncovered: STRIKE },
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
  "sql:check_referral_bonus": {
    uncovered: "fires on a referred Helpr's first completed job; no referrals row names either shared account (measured on prod 2026-09-26: 0 rows), and a new referred account needs a signup the journeys cannot complete (email verification)",
  },
  "sql:decline_job_offer": { uncovered: STRIKE },
  "sql:deliver_saved_search_alert": { driven: { spec: MONEY, evidence: "type=eq.job_match" } },
  "sql:detect_stuck_payments": { uncovered: CRON("detect-stuck-payments") },
  "sql:expire_pending_direct_offers": {
    uncovered: "called only by the auto-expire-jobs edge function (scheduled) once a direct offer's window has passed; the shortest window is 1 hour",
  },
  "sql:expire_unanswered_offers": {
    uncovered: "called only by the auto-expire-jobs edge function (scheduled) once a hire's response deadline has passed, and it records a no-response strike on the Helpr",
  },
  "sql:helper_abort_job": { uncovered: STRIKE },
  "sql:helper_cancel_booking": { uncovered: STRIKE },
  "sql:mark_helper_arrival": { uncovered: GAP("the 02-marketplace day-of ladder and settleForward (mark_helper_arrival)") },
  "sql:notify_helper_application_viewed": { uncovered: GAP("02-marketplace J3 (the poster opens the applicant)") },
  "sql:notify_helper_on_direct_offer": { driven: { spec: NOTIF, evidence: "type=eq.new_offers" } },
  "sql:notify_helper_on_tip": { driven: { spec: MONEY, evidence: "type=eq.financial_alerts" } },
  "sql:notify_helpers_on_job_post": {
    uncovered: "notifies EVERY eligible Helpr in the funded job's parish; seed jobs are visible publicly (seed_jobs_hidden_publicly() = false on prod, measured 2026-09-26), so a journey job with a parish would notify real users. The journeys keep parish null on purpose",
  },
  "sql:notify_message_recipient": { driven: { spec: NOTIF, evidence: "type=eq.message" } },
  "sql:notify_on_application": { driven: { spec: MARKET, evidence: "poster gets a notification for the application" } },
  "sql:notify_on_job_update": { uncovered: GAP("the 02-marketplace hire and day-of ladder (jobs status updates)") },
  "sql:notify_on_payment_escrowed": { uncovered: GAP("any funded journey job (stripe-webhook flips payment_status to escrow)") },
  "sql:notify_poster_on_status_change": { uncovered: GAP("the 02-marketplace day-of ladder") },
  "sql:notify_user_on_review": {
    uncovered: GAP("02-marketplace J5 reviews both ways (the row is written after the blind-period reveal)"),
  },
  "sql:open_dispute_as": { uncovered: DISPUTE },
  "sql:poster_cancel_job": {
    uncovered: GAP("poster_cancel_job on an unfunded or unhired job (the notifying branches need a hired Helpr, which records a cancel_with_helper strike on the poster)"),
  },
  "sql:respond_to_direct_offer": { driven: { spec: NOTIF, evidence: "rpc/respond_to_direct_offer" } },
  "sql:review_credential": { uncovered: ADMIN_ONLY("the credential review queue; the shared helper has no pending credential to review") },
  "sql:rpc_decide_dispute": { uncovered: DISPUTE },
  "sql:rpc_escalate_dispute": { uncovered: DISPUTE },
  "sql:rpc_group_member_mark_arrival": {
    uncovered: "group jobs are withdrawn (GROUP_JOBS_ENABLED = false in src/lib/groupJobs.ts), so no journey can post one",
  },
  "sql:rpc_supersede_dispute_decision": { uncovered: DISPUTE },
  "sql:sweep_daily_job_digest": { uncovered: CRON("sweep-daily-job-digest") },
  "sql:sweep_dayof_confirm_reminders": { uncovered: CRON("sweep-dayof-confirm-reminders") },
  "sql:sweep_expired_auto_bans": { uncovered: CRON("sweep-expired-auto-bans") },
  "sql:sweep_job_start_reminders": { uncovered: CRON("sweep-job-start-reminders") },
  "sql:sweep_no_show_alerts": { uncovered: CRON("sweep-no-show-alerts") },
  "sql:sweep_release_last_chance": { uncovered: CRON("sweep-release-last-chance") },
  "sql:track_revision_scope_creep": {
    uncovered: "notifies only on a job's THIRD revision request, and files a fraud_flags scope_creep row against the poster (a shared account) when it does",
  },

  // ── Edge functions ──────────────────────────────────────────────────────
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
  "edge:charge-recurring-visits": { uncovered: SCHEDULED_EDGE },
  "edge:check-pro-subscription": {
    uncovered: "writes on a Pro subscription state change; the shared accounts are free tier and a Pro checkout is a recurring charge the journeys do not start",
  },
  "edge:complete-signup": {
    uncovered: "runs once per account at signup; the two shared accounts completed signup long ago and a new account needs email verification the journeys cannot complete",
  },
  "edge:create-notification": { driven: { spec: NOTIF, evidence: 'template: "test"' } },
  "edge:create-payment": { driven: { spec: MONEY, evidence: '"Refund issued"' } },
  "edge:daily-match-digest": { uncovered: SCHEDULED_EDGE },
  "edge:execute-dispute-split": { uncovered: DISPUTE },
  "edge:expire-subscriptions": { uncovered: SCHEDULED_EDGE },
  "edge:expiring-jobs-push": { uncovered: SCHEDULED_EDGE },
  "edge:instant-job-match": {
    uncovered: "matches an urgent funded job to nearby Helprs by location; like the parish fan-out it would reach real users near any location a journey job carries",
  },
  "edge:instant-payout": {
    uncovered: "GAP — an instant payout moves the shared helper's available Connect balance out; not driven, and whether a nightly may drain that test balance is an owner decision",
  },
  "edge:payment-confirm-reminder": { uncovered: SCHEDULED_EDGE },
  "edge:process-scheduled-payouts": { uncovered: SCHEDULED_EDGE },
  "edge:release-payout": {
    uncovered: GAP("the release in settleForward / 02-marketplace J5 (its notification rows are not asserted)"),
  },
  "edge:review-nag-cron": { uncovered: SCHEDULED_EDGE },
  "edge:saved-helper-availability-push": { uncovered: SCHEDULED_EDGE },
  "edge:stalled-completion-reminder": { uncovered: SCHEDULED_EDGE },
  "edge:stripe-connect": {
    uncovered: "writes on Connect onboarding steps; the shared helper's Connect account is already onboarded and is load-bearing for every money leg",
  },
  "edge:stripe-idv-webhook": {
    uncovered: "fires on a Stripe Identity verification event; the shared helper is already verified and must stay so",
  },
  "edge:stripe-webhook/handlers/_chargebackClawback": { uncovered: STRIPE_EVENT("charge.dispute.* (a chargeback)") },
  "edge:stripe-webhook/handlers/accountUpdated": { uncovered: STRIPE_EVENT("account.updated with a requirements change") },
  "edge:stripe-webhook/handlers/chargeDisputeClosed": { uncovered: STRIPE_EVENT("charge.dispute.closed") },
  "edge:stripe-webhook/handlers/chargeDisputeCreated": { uncovered: STRIPE_EVENT("charge.dispute.created") },
  "edge:stripe-webhook/handlers/chargeRefunded": {
    uncovered: GAP("any cancel_escrow / admin refund (charge.refunded arrives in test mode); its row is not asserted"),
  },
  "edge:stripe-webhook/handlers/checkoutSessionCompleted": {
    uncovered: GAP("the tip leg in 04-money-outcomes (it RECORDS whether this handler's \"You received a tip!\" row lands beside the trigger's, but does not assert it: two in-app rows for one tip is a suspected duplicate)"),
  },
  "edge:stripe-webhook/handlers/paymentIntentPaymentFailed": { uncovered: STRIPE_EVENT("payment_intent.payment_failed") },
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
  "template:no_show_reported": {
    uncovered: "sent after report_helper_no_show, which strikes the shared helper — see OUTCOME_UNDRIVEN[\"no-show\"] in e2e/journeys/scenarios.ts",
  },
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
