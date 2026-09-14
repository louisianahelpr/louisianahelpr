// The ONE severity policy for #ops-alerts (owner, 2026-09-14: "make alerts few
// and meaningful"). Pure TypeScript, no Deno or network, so vitest imports it
// directly.
//
//   CRITICAL  posts to #ops-alerts immediately. Reserved for:
//               - prod down (scheduler blackout, a cron that stopped firing)
//               - money at risk (payout/transfer/refund/dispute/charge failures)
//               - deploy failed (GitHub Actions, posted by the workflow itself)
//               - security (fraud flags, signature failures, suspensions)
//   WARNING   never posts on its own. Recorded in error_logs and summarised by
//   INFO      the once-a-day digest (public.send_ops_daily_digest, 14:40 UTC).
//
// ALWAYS_POST_KINDS is the third case: not an operator page, but not something
// that can wait a day either. A person asking for help (`support_request`) has
// to reach #ops-alerts now — the digest would answer them tomorrow — and it
// keeps INFO wording and colouring so it never reads as an outage.
//
// A KIND floor sits under the caller's severity: an alert whose kind is money
// or security is critical whatever severity the call site passed, so a money
// alert cannot be demoted to the digest by a stale `severity: 'warning'`.
//
// The SQL half is public.notify_slack_on_error_log — see
// supabase/migrations/20260914183932_alerts_critical_only_and_outage_aware_cron_liveness.sql.
// CRITICAL_ERROR_LOG_SOURCES below must match the array there
// (src/test/alertPolicy.test.ts checks).

export type AlertSeverity = 'critical' | 'warning' | 'info'

/** Kinds that always page. `dispute_won` is deliberately absent (good news). */
export const CRITICAL_KINDS = [
  'dispute_filed',
  'dispute_lost',
  'fraud_flag',
  'payout_failed',
  'payout_reversed',
  'auto_suspended',
  'stripe_webhook_error',
  'money_at_risk',
  'security',
] as const

/**
 * error_logs `tags.source` values written server-side for money or security
 * conditions that no other path posts. (The cron watchers — cron-dead,
 * cron-http, cron-silent, cron-blackout, instant-payout-reaper — post their
 * own roll-up and are NOT here, so a roll-up never also posts per row.)
 */
export const CRITICAL_ERROR_LOG_SOURCES = [
  'detect_stuck_payments',
  'auto_start_due_jobs',
  'detect_suspicious_user_patterns',
  'rls-escalation-refused',
] as const

/**
 * Coerce whatever a caller sent into a severity. The SQL watchers send
 * `'error'`, which has always meant critical here; any other unknown string is
 * treated as critical too, because an alert whose severity cannot be read is
 * not one to quietly downgrade. A MISSING severity is a warning.
 */
export function normalizeSeverity(raw: unknown): AlertSeverity {
  if (raw === 'critical' || raw === 'warning' || raw === 'info') return raw
  if (raw === undefined || raw === null) return 'warning'
  return 'critical'
}

/** The caller's severity, raised to critical for a money or security kind. */
export function effectiveSeverity(kind: string | undefined, raw: unknown): AlertSeverity {
  if (kind && (CRITICAL_KINDS as readonly string[]).includes(kind)) return 'critical'
  return normalizeSeverity(raw)
}

/**
 * Kinds that post whatever their severity, WITHOUT being dressed as critical.
 * `digest` is the daily roll-up itself; `support_request` is a human waiting
 * for an answer. Neither is in CRITICAL_KINDS on purpose: they post with their
 * own severity's icon and colour, so a page still means "something is broken".
 */
export const ALWAYS_POST_KINDS = ['digest', 'support_request'] as const

/** Posts to Slack now, or waits for the daily digest. */
export function postsImmediately(severity: AlertSeverity, kind?: string): boolean {
  return severity === 'critical' || (!!kind && (ALWAYS_POST_KINDS as readonly string[]).includes(kind))
}

/**
 * Stable id for ONE support request, used as its `oncePerDayKey`.
 *
 * A support request has no row id to dedupe on — a guest never gets one, and
 * the `reports` insert happens after the email — so the identity of the
 * request is its content: the same person sending the same thing twice (a
 * double-tapped Send, a retried submit) is one request and posts once.
 * Different text is a different request and posts again, same day or not.
 *
 * FNV-1a rather than crypto.subtle so this stays synchronous and testable in
 * vitest; it is a dedupe key, not a security boundary.
 */
export function supportRequestKey(p: { email?: string | null; subject?: string | null; message?: string | null }): string {
  const material = [p.email ?? '', p.subject ?? '', p.message ?? '']
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('\u0000')
  let h = 0x811c9dc5
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `support-request:${h.toString(16).padStart(8, '0')}`
}

/**
 * Admin notifications known to be informational. Anything NOT matched here is
 * critical: an admin alert nobody classified is assumed to need a person.
 */
const ADMIN_INFO_TITLES = /^\W*(new (member|user|signup)|member joined|signup pending|account (pending|awaiting)|dispute auto-resolved)\b/i

/** Severity for an admin push that fell back to Slack (no push token). */
export function adminPushSeverity(title: string): AlertSeverity {
  return ADMIN_INFO_TITLES.test(title) ? 'info' : 'critical'
}

/**
 * Dedupe key for an admin fallback: one EVENT, not one kind of text. The same
 * notification fanned out to every admin shares title AND link (the link
 * carries the job/dispute id), so it collapses to one post; two different
 * jobs with the same title are two events and both post.
 */
export function adminPushEventKey(p: { title: string; link?: string | null; thread_id?: string | null }): string {
  const ref = p.link || p.thread_id || ''
  return `admin-push:${p.title.trim().toLowerCase().slice(0, 80)}|${ref.slice(0, 160)}`
}

/** UTC midnight of `now`, as an ISO string: the start of a once-per-day window. */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}
