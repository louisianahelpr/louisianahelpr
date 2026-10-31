export interface Prefs {
  // Legacy (kept for backward compat / write-through)
  job_applications: boolean;
  job_updates: boolean;
  messages: boolean;
  payments: boolean;
  reviews: boolean;
  promotions: boolean;
  system_alerts: boolean;
  /** Push master switch. Gates every per-category push column WITHOUT
      overwriting any of them — see `fan_out_push_on_notification`. */
  push_enabled: boolean;
  /** Email master switch — the twin of `push_enabled`, added in migration
      `20260907032218_email_master_switch_own_column.sql`.

      Before that column existed the Email master was derived ("at least one
      `email_*` is true") and toggling it blanket-wrote every `email_*` column,
      so a master off → on cycle reset explicit opt-outs — including
      `email_promotions` — back to true. It is a real column for the same
      reason `push_enabled` is: the restore is a consent record and has to
      survive a fresh device and a cleared client. */
  email_enabled: boolean;
  email_job_applications: boolean;
  email_job_updates: boolean;
  email_messages: boolean;
  /** Messages audit M6 (20261030150631): new-message bell and push show the
      first words (true, default) or only "Sent you a message." (false).
      Emails never carry the words. */
  message_preview: boolean;
  email_payments: boolean;
  email_reviews: boolean;
  /** Three-valued since 20261021135832 (Q2299): null = never chosen (the
      sign-up box decides the welcome and come-back emails; the switch shows
      src/lib/promotionsEmail.ts), true = on, false = off. The whole-row
      writes on this screen send null back unchanged, so touching any other
      switch never turns a never-chosen Promotions into a choice. */
  email_promotions: boolean | null;
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
  /** New work matching your parish or a saved search (`notifications.type
      = 'job_match'`). Its own column since 2026-09-11: it is the largest
      notification type in prod and used to be gated by `new_offers`,
      `job_updates`, or nothing at all depending on which of the four
      producers fired. Defaults true — nobody loses matches silently. */
  job_matches: boolean;
  email_job_matches: boolean;
  /** Declutter (20261028162048), one push column and its email twin per
      kind, shown as the "Declutter" group. All default true; price drops and
      Wanted matches were backfilled from `new_offers`, the switch that used to
      gate them. Only pickups, price drops and Wanted matches send email today, so the
      other four rows show no Email switch (`noEmailSwitch` in constants.tsx). */
  declutter_listings: boolean;
  email_declutter_listings: boolean;
  declutter_offers: boolean;
  email_declutter_offers: boolean;
  declutter_questions: boolean;
  email_declutter_questions: boolean;
  declutter_sales: boolean;
  email_declutter_sales: boolean;
  declutter_pickups: boolean;
  email_declutter_pickups: boolean;
  declutter_refunds: boolean;
  email_declutter_refunds: boolean;
  declutter_price_drops: boolean;
  email_declutter_price_drops: boolean;
  declutter_wanted: boolean;
  email_declutter_wanted: boolean;
  /** Email-only (Q2120, 20261023120308): quote reminders and the "Quotes are
      closed" notice, send-notification-email type `quote_reminder`. Their
      in-app row and push ride `new_offers`. Default true. Standalone like
      `saved_helper_availability`, not a `rows` category. */
  email_quote_reminders: boolean;
  /** RETIRED for job matches (Q1585, owner 2026-10-12): the "Daily Match
      Digest" switch is gone, the server ignores this column for job matches
      and a trigger holds it false. Kept so the row type still matches the
      table (and older builds that still send it). */
  match_digest_mode: boolean;
  /** Opt-in (default FALSE): "<Helpr> updated availability" nudges for saved
      Helprs, sent by the saved-helper-availability-push cron. A STANDALONE
      preference (like `match_digest_mode` and quiet hours) read directly by
      the cron, NOT routed through `notification_type_pref_map` — so it does
      not belong in the per-category `rows` grid and is not part of the
      six-registry closed type set. Owner, 2026-09-15: off unless turned on. */
  saved_helper_availability: boolean;
  /** Job reminders (owner 2026-10-29, 20261030031059): the switchable ones,
      shown in the "Job reminders" group from public.job_reminder_types. All
      default true. Off = the reminder is not sent at all (the notifications
      insert gate drops it). The always-on reminders have no column. */
  remind_starting_soon: boolean;
  remind_finish_job: boolean;
  remind_payout_followups: boolean;
  /** Q2483 (20261030035326): 2 hours before, 8 AM on the day, time to head out. */
  remind_two_hours: boolean;
  remind_morning_of: boolean;
  remind_head_out: boolean;
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
  [K in keyof Prefs]: Prefs[K] extends boolean | null ? K : never;
}[keyof Prefs];

export interface Row {
  key: BoolPrefKey;
  emailKey: BoolPrefKey;
  label: string;
  /** One line under the label, for a row whose name alone doesn't say what it covers. */
  description?: string;
  icon: React.ReactNode;
  /** Set when this kind has no email to switch: the row shows a dash in the
      Email column (this text is its tooltip and screen-reader label) instead of
      a switch that would do nothing. */
  noEmailSwitch?: string;
}
