/**
 * The ONLY places a role word may stand in user-visible copy.
 *
 * Every entry carries a reason. An entry with no `text` exempts the whole file
 * (or path prefix); an entry with `text` exempts only strings containing that
 * substring, so a blanket file exemption is never the default.
 *
 * Adding an entry here is a copy decision, not a way to silence the guard: the
 * rule is that the other party on a job is named by what they DID on that job
 * ("the person who posted this job", "the person doing this job"), never by a
 * role held as an identity. The three reasons below are the only ones that have
 * ever justified an exception.
 */
export type RoleCopyException = {
  /** Repo-relative path, or a path prefix ending in "/". */
  file: string;
  /** When set, only copy containing this substring is exempt. */
  text?: string;
  reason: string;
};

export const ROLE_COPY_ALLOWLIST: readonly RoleCopyException[] = [
  // REMOVED 2026-09-20: { file: "src/", text: "Louisiana Helpr" }. It excused
  // nothing — "Helpr" on its own is never a finding, only identity
  // constructions are — while standing open over EVERY string in src/ that
  // mentions the company by name, so "Louisiana Helpr connects posters with
  // Helprs" would have shipped unchallenged. The liveness half of
  // "every allowlist entry ... still matches something" now fails on any entry
  // in this state.
  {
    file: "src/components/admin/",
    reason:
      "admin-only screens. Operators triage by which side of a job a party is on, and the queue labels, CSV headers and refund buttons are their vocabulary; no ordinary user reads them.",
  },
  {
    file: "src/pages/legal/",
    reason:
      "legal pages. Terms, Community Guidelines and Privacy define the contractual parties to a job and their fees; a contract needs the defined term, not a description.",
  },
  {
    file: "src/components/NotificationPanel.tsx",
    text: "cancelled by the poster",
    reason:
      "not copy — a needle matched against STORED notification bodies. Postgres triggers write them (migrations 20260905021859, 20260908155425 and earlier) and every row already in the table says 'cancelled by the poster', so dropping the legacy phrasing would silently remove the quick-action pill from all of them. Reword the trigger in a migration first, then this.",
  },
  {
    file: "src/pages/helpCenter/helpCenterContent.ts",
    text: 'There\'s no separate "poster" or "Helpr" mode',
    reason:
      "the help-center answer that exists to DENY the role distinction. It has to name the two roles in order to say neither is a mode you are in.",
  },

  // supabase/functions/ — scanned since 2026-09-15 (owner: change every
  // user-facing backend string). What stays is read only by admins, operators
  // or logs, never by the two parties to a job.
  {
    file: "supabase/functions/arrival-confirm-reminder/index.ts",
    text: "the poster hasn't confirmed",
    reason: "the 24h admin_alert notification sent only to user_roles admins, who triage by side of the job.",
  },
  {
    file: "supabase/functions/auto-resolve-disputes/index.ts",
    text: "expired without poster action",
    reason: "admin_alert notification sent only to admins.",
  },
  {
    file: "supabase/functions/release-payout/index.ts",
    text: "not a poster problem",
    reason: "admin_alert notification sent only to admins.",
  },
  {
    file: "supabase/functions/create-payment/index.ts",
    text: "to the poster",
    reason:
      "admin dispute-settlement refusals (release/refund on the admin dispute screen, gated by claimDisputeSettlement's adminId); operators decide which SIDE money goes to, so the side is named.",
  },
  {
    file: "supabase/functions/create-payment/index.ts",
    text: "refunding the poster",
    reason: "admin dispute-settlement refusal (same admin-only screen as above).",
  },
  {
    file: "supabase/functions/create-payment/index.ts",
    text: "The poster's cancellation is refunding this escrow",
    reason: "admin dispute-settlement refusal (same admin-only screen as above).",
  },
  {
    file: "supabase/functions/execute-dispute-split/",
    reason: "admin-only endpoint (has_role admin gate): split refusals and refund-ledger reasons are operator and Stripe records.",
  },
  {
    file: "supabase/functions/send-marketing-blast/",
    reason: "admin-only endpoint (has_role admin gate); 'poster segment' is the audience filter's name on the admin screen.",
  },
  {
    file: "supabase/functions/money-reconciliation/",
    reason: "internal reconciliation cron: check descriptions go to ops alerts and the cron result, never to a user.",
  },
  {
    file: "supabase/functions/auto-tip-charge/index.ts",
    text: "the poster",
    reason: "defect strings passed to settleTip's write-failure record (cron result / ops), never shown to a user.",
  },
  {
    file: "supabase/functions/charge-recurring-visits/index.ts",
    text: "poster",
    reason: "cron failure records (fail() / failures.push) that go to the cron result, never to a user.",
  },
  {
    file: "supabase/functions/payment-confirm-reminder/index.ts",
    text: "this poster will be nudged again",
    reason: "cron defect record (markFailures), never shown to a user.",
  },
  {
    file: "supabase/functions/stripe-webhook/handlers/_resolveUser.ts",
    text: "customer email",
    reason: "internal webhook resolution reason; 'customer' is Stripe's object name (the Stripe Customer's email), not a party to a job.",
  },
];

/** True when this copy is an approved exception. */
export function isAllowedRoleCopy(file: string, text: string): boolean {
  return ROLE_COPY_ALLOWLIST.some(
    (e) => file.startsWith(e.file) && (e.text === undefined || text.includes(e.text)),
  );
}
