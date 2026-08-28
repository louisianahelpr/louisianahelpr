export interface Prefs {
  // Legacy (kept for backward compat / write-through)
  job_applications: boolean;
  job_updates: boolean;
  messages: boolean;
  payments: boolean;
  reviews: boolean;
  promotions: boolean;
  system_alerts: boolean;
  push_enabled: boolean;
  email_job_applications: boolean;
  email_job_updates: boolean;
  email_messages: boolean;
  email_payments: boolean;
  email_reviews: boolean;
  email_promotions: boolean;
  email_system_alerts: boolean;
  // New granular categories
  new_offers: boolean;
  email_new_offers: boolean;
  transit_updates: boolean;
  email_transit_updates: boolean;
  work_status: boolean;
  email_work_status: boolean;
  financial_alerts: boolean;
  email_financial_alerts: boolean;
  /** When true, non-urgent job matches are batched into a daily
      digest instead of being pushed individually. Urgent jobs always
      fire realtime regardless. */
  match_digest_mode: boolean;
  /** Local-time `HH:MM` start of the quiet-hours window. NULL when
      quiet hours are disabled. Wired in migration
      `20260609120000_notification_quiet_hours.sql`. */
  quiet_start: string | null;
  /** Local-time `HH:MM` end of the quiet-hours window. NULL when
      quiet hours are disabled. */
  quiet_end: string | null;
}

// Boolean-valued keys only — `Row` references the per-category
// toggles, and Prefs now includes string-valued keys (quiet_start /
// quiet_end) that have no place in the per-category switch grid.
type BoolPrefKey = {
  [K in keyof Prefs]: Prefs[K] extends boolean ? K : never;
}[keyof Prefs];

export interface Row {
  key: BoolPrefKey;
  emailKey: BoolPrefKey;
  label: string;
  icon: React.ReactNode;
}
