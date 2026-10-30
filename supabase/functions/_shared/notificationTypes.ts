/**
 * notification type -> (a) the EMAIL preference column that gates it and
 * (b) the `notification_logs.category` both channels log it under.
 *
 * ONE table for both senders (audit E2-12, D4-10, 2026-10-30). Until then
 * `_shared/notificationLog.ts` kept its own copy of the category half "in
 * step" by hand, and it was not: every Declutter push (declutter_listings,
 * _offers, _sales, _pickups ...) logged as `push/system` (measured on prod
 * 2026-10-30: 23 of 23 Declutter pushes in 5 days), and `application`,
 * `job_match`, `job_update(s)`, `expired` and `payment` logged under one
 * category for push and another for email, so an operator filtering the
 * admin log saw only half of one event. send-notification-email reads the
 * whole row; the push log reads only `category`.
 *
 * Push GATING is not decided here: `fan_out_push_on_notification` resolves it
 * in the database from `notification_type_pref_map` before the push function
 * is called. `src/test/notificationTypeRegistries.test.ts` diffs this table
 * against that map (push column X <-> email column email_X).
 */

// History of this table (moved here from send-notification-email/index.ts):
// EVERY type in `notifications_type_check`, pointed at the email twin of the
// column `notification_type_pref_map` gates PUSH with. Push and email must
// agree, and until 2026-09-03 they did not:
//
//   * FOUR types had no entry at all — `job_updates`, `expired`, `system_alert`
//     and `verified` — so they fell through to the
//     `email_system_alerts` default below. "Your job expires soon" was gated
//     by the platform-alerts switch for email and by job updates for push.
//   * FOUR more pointed at a different column than push did: `application`
//     (push job_applications / email new_offers), `job_update` and `job_match`
//     (push job_updates / email work_status), and `payment` (push payments /
//     email financial_alerts).
//
// That mattered little while `job_applications`, `job_updates`, `payments` and
// `system_alerts` had no switch on the prefs screen. Now that they do (N-005),
// a divergence here means a user flips a switch and only one of the two
// channels obeys it. `src/test/notificationTypeRegistries.test.ts` diffs this
// table against the DB map's seed rows and fails on any disagreement.
//
// No account's delivery changes by default: every email_* column involved
// DEFAULTs true, so this only takes effect for someone who has actually set a
// preference — which is the entire point.
export const NOTIFICATION_TYPE_MAP: Record<string, { prefCol: string; category: string }> = {
  // New granular categories (used by triggers)
  new_offers:        { prefCol: 'email_new_offers',       category: 'new_offers' },
  transit_updates:   { prefCol: 'email_transit_updates',  category: 'transit_updates' },
  work_status:       { prefCol: 'email_work_status',      category: 'work_status' },
  financial_alerts:  { prefCol: 'email_financial_alerts', category: 'financial_alerts' },
  // Legacy
  application:       { prefCol: 'email_job_applications', category: 'job_applications' },
  job_update:        { prefCol: 'email_job_updates',      category: 'job_updates' },
  job_updates:       { prefCol: 'email_job_updates',      category: 'job_updates' },
  // Its own column since 2026-09-11 — job_match is the largest type in prod
  // and users need to mute it without muting real updates on their own jobs.
  job_match:         { prefCol: 'email_job_matches',      category: 'job_matches' },
  expired:           { prefCol: 'email_job_updates',      category: 'job_updates' },
  info:              { prefCol: 'email_work_status',      category: 'work_status' },
  success:           { prefCol: 'email_work_status',      category: 'work_status' },
  warning:           { prefCol: 'email_system_alerts',    category: 'system' },
  system_alert:      { prefCol: 'email_system_alerts',    category: 'system' },
  verified:          { prefCol: 'email_system_alerts',    category: 'system' },
  // Operator mail. Same column `warning` resolved to — the point of the type
  // is that user-facing rows stop SHARING that column, not that admins move.
  admin_alert:       { prefCol: 'email_system_alerts',    category: 'system' },
  message:           { prefCol: 'email_messages',         category: 'messages' },
  payment:           { prefCol: 'email_payments',         category: 'payments' },
  review:            { prefCol: 'email_reviews',          category: 'reviews' },
  // `promotion` is NOT a notifications.type — no CHECK value spells it, and
  // nothing inserts it. It is here for marketing mail that calls this function
  // directly with its own type string, so the registry test asserts coverage
  // of the CHECK set rather than equality with it.
  promotion:         { prefCol: 'email_promotions',       category: 'promotions' },
  // Also NOT a notifications.type (Q2120): sweep_quote_alerts' reminders and
  // "Quotes are closed" notice keep the in-app/push type `new_offers` and send
  // their EMAIL as `quote_reminder`, so the member's own "Quote reminders"
  // email switch decides it (owner 2026-10-21).
  quote_reminder:    { prefCol: 'email_quote_reminders',  category: 'quote_reminders' },
  // Declutter (20261028162048): each kind on its own email twin. Only pickup
  // reminders and price drops send email today; the rest are push + bell.
  declutter_listings:    { prefCol: 'email_declutter_listings',    category: 'declutter_listings' },
  declutter_offers:      { prefCol: 'email_declutter_offers',      category: 'declutter_offers' },
  declutter_sales:       { prefCol: 'email_declutter_sales',       category: 'declutter_sales' },
  declutter_pickups:     { prefCol: 'email_declutter_pickups',     category: 'declutter_pickups' },
  declutter_refunds:     { prefCol: 'email_declutter_refunds',     category: 'declutter_refunds' },
  declutter_price_drops: { prefCol: 'email_declutter_price_drops', category: 'declutter_price_drops' },
  declutter_wanted:      { prefCol: 'email_declutter_wanted',      category: 'declutter_wanted' },
  declutter_questions:   { prefCol: 'email_declutter_questions',   category: 'declutter_questions' },
}

/** The route for a type nobody mapped: the platform-alerts switch, logged as System. */
export const UNMAPPED_NOTIFICATION_ROUTE = { prefCol: 'email_system_alerts', category: 'system' } as const

/** The `notification_logs.category` for a type, on every channel. */
export function notificationLogCategory(type?: string | null): string {
  if (!type) return UNMAPPED_NOTIFICATION_ROUTE.category
  return NOTIFICATION_TYPE_MAP[type]?.category ?? UNMAPPED_NOTIFICATION_ROUTE.category
}
