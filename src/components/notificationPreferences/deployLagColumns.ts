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
 * keeps the old derived master reading meanwhile.
 *
 *   email_enabled              migration 20260907032218
 *   saved_helper_availability  migration 20260915202026
 *   email_quote_reminders      migration 20261023120308 (Q2120)
 */
const DEPLOY_LAG_COLUMNS = ["email_enabled", "saved_helper_availability", "email_quote_reminders"] as const;

export type ColumnPresence = Record<(typeof DEPLOY_LAG_COLUMNS)[number], boolean>;

export const ALL_PRESENT: ColumnPresence = {
  email_enabled: true,
  saved_helper_availability: true,
  email_quote_reminders: true,
};

/** Which of the deploy-lag columns the loaded row actually carries. */
export const columnsPresentIn = (row: Record<string, unknown>): ColumnPresence => ({
  email_enabled: "email_enabled" in row,
  saved_helper_availability: "saved_helper_availability" in row,
  email_quote_reminders: "email_quote_reminders" in row,
});

/** Drops every key whose column is not deployed yet, so the upsert cannot PGRST204. */
export function stripMissingColumns(payload: object, present: ColumnPresence): void {
  for (const c of DEPLOY_LAG_COLUMNS) if (!present[c]) delete (payload as Record<string, unknown>)[c];
}
