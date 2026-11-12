/**
 * Deploy-lag guard for the Notifications screen.
 *
 * A new notification_preferences column arrives with its migration via
 * db-deploy.yml, while this bundle ships via Vercel: two pipelines, one merge,
 * a window where the column may not exist yet. Writing a key Postgres has never
 * heard of fails the whole upsert (PGRST204), so EVERY toggle on the screen
 * would break for the length of that window.
 *
 * Each column below defaults to present (a new member with no row must still
 * be able to opt in); only a LOADED row that lacks it proves we are mid-gap,
 * and then the key is stripped from writes. For `email_enabled` the screen also
 * keeps the old derived master reading meanwhile, and the Declutter group stays
 * hidden until its columns are there.
 *
 *   email_enabled              migration 20260907032218
 *   saved_helper_availability  migration 20260915202026
 *   email_quote_reminders      migration 20261023120308 (Q2120)
 *   declutter_* and email_declutter_*  migration 20261028162048 (14 columns)
 *   remind_starting_soon, remind_finish_job, remind_payout_followups  migration 20261030031059 (Job reminders)
 *   remind_two_hours, remind_morning_of, remind_head_out  migration 20261030035326 (Q2483 start reminders)
 *   message_preview            migration 20261030150631 (Messages audit M6)
 *   declutter_questions, email_declutter_questions  migration 20261030170443 (Q2488)
 *   shops_* and email_shops_*  migration 20261108201153 (shops audit 11-08 #6, 6 columns)
 */
const DECLUTTER_KINDS = [
  "declutter_listings", "declutter_offers", "declutter_sales", "declutter_pickups",
  "declutter_refunds", "declutter_price_drops", "declutter_wanted", "declutter_questions",
] as const;

const SHOPS_KINDS = ["shops_orders", "shops_messages", "shops_updates"] as const;

const ADMIN_ACTIVITY_KINDS = ["admin_activity"] as const;

const DEPLOY_LAG_COLUMNS = [
  "email_enabled", "saved_helper_availability", "email_quote_reminders",
  ...DECLUTTER_KINDS,
  ...DECLUTTER_KINDS.map((k) => `email_${k}` as const),
  "remind_starting_soon", "remind_finish_job", "remind_payout_followups",
  "remind_two_hours", "remind_morning_of", "remind_head_out",
  "message_preview",
  ...SHOPS_KINDS,
  ...SHOPS_KINDS.map((k) => `email_${k}` as const),
  ...ADMIN_ACTIVITY_KINDS,
  ...ADMIN_ACTIVITY_KINDS.map((k) => `email_${k}` as const),
] as const;

type LagColumn = (typeof DEPLOY_LAG_COLUMNS)[number];
export type ColumnPresence = Record<LagColumn, boolean>;

export const ALL_PRESENT: ColumnPresence = Object.fromEntries(
  DEPLOY_LAG_COLUMNS.map((c) => [c, true]),
) as ColumnPresence;

/** Which of the deploy-lag columns the loaded row actually carries. */
export const columnsPresentIn = (row: Record<string, unknown>): ColumnPresence =>
  Object.fromEntries(DEPLOY_LAG_COLUMNS.map((c) => [c, c in row])) as ColumnPresence;

/** Every Declutter switch column is deployed (the group is shown only then). */
export const declutterColumnsPresent = (present: ColumnPresence): boolean =>
  DECLUTTER_KINDS.every((k) => present[k] && present[`email_${k}`]);

/** Every Shops switch column is deployed (the Shops group is shown only then). */
export const shopsColumnsPresent = (present: ColumnPresence): boolean =>
  SHOPS_KINDS.every((k) => present[k] && present[`email_${k}`]);

export const adminActivityColumnsPresent = (present: ColumnPresence): boolean =>
  ADMIN_ACTIVITY_KINDS.every((k) => present[k] && present[`email_${k}`]);

/** Drops every key whose column is not deployed yet, so the upsert cannot PGRST204. */
export function stripMissingColumns(payload: object, present: ColumnPresence): void {
  for (const c of DEPLOY_LAG_COLUMNS) if (!present[c]) delete (payload as Record<string, unknown>)[c];
}
