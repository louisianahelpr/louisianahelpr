// The ONE severity policy for #ops-alerts (owner, 2026-09-14: "make alerts few
// and meaningful"). Pure TypeScript, no Deno or network, so vitest imports it
// directly.
//
//   CRITICAL  posts immediately, throttled hard. Prod down, money at risk,
//             deploy failed, security.
//   WARNING   ALSO POSTS, throttled far harder (owner, 2026-09-22).
//   INFO      ALSO POSTS, throttled hardest.
//
// ── WHY THIS CHANGED, 2026-09-22 ───────────────────────────────────────────
// The 2026-09-14 policy was "make alerts few and meaningful": warning and info
// never posted, they waited for the once-a-day digest
// (public.send_ops_daily_digest, 14:40 UTC). That was a reasonable rule with
// one property nobody had tested — THE DIGEST IS ITSELF A CRON.
//
// On 2026-09-22 pg_cron refused to START 457 scheduled runs between 06:00 and
// 15:00 UTC ("job startup timeout" — the jobs did not run late, they did not
// run). `ops-daily-digest` was one of the nine daily jobs killed. So the
// outage was reported at severity 'error', 'error' was routed to the digest,
// and the digest was part of the outage. Nine hours passed with nobody told.
//
// Owner, same day: "I feel like medium and low alerts should show in slack
// also so that can be fixed."
//
// THE ANSWER TO VOLUME IS THROTTLING, NOT SILENCE. Measured over the 7 days to
// 2026-09-22, error_logs carried 629 rows — ~90/day, which would drown
// #ops-alerts and teach everyone to skim it. Throttled one-post-per-source per
// the windows below, those same 7 days would have produced roughly:
//
//     fatal     0.1/day      (10 min window)
//     error     ~7/day       (60 min)
//     warning   ~4/day       (240 min)
//     info      ~1/day       (720 min)
//
// ~12 posts a day, every distinct source still visible within hours, and no
// severity's report depends on a cron surviving.
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

/**
 * Minutes one SOURCE stays quiet after posting, keyed on the `error_logs`
 * severity (four levels) rather than AlertSeverity (three), because the
 * throttle is about how noisy a tier is, not how it is coloured.
 *
 * MIRRORED IN SQL by public.notify_slack_on_error_log — src/test/alertPolicy
 * .test.ts asserts the two agree, the same way it already pins
 * CRITICAL_ERROR_LOG_SOURCES. Change a number here, change it there.
 */
export const SLACK_THROTTLE_MINUTES: Record<string, number> = {
  fatal: 10,
  error: 60,
  warning: 240,
  info: 720,
}

/**
 * Posts to Slack now.
 *
 * Every severity does, as of 2026-09-22 — see the header. What keeps
 * #ops-alerts readable is now SLACK_THROTTLE_MINUTES, applied per source, not
 * a gate that drops whole severities on the floor. A dropped severity is
 * indistinguishable from a healthy system, which is exactly how a nine-hour
 * outage went unreported.
 *
 * Kept as a function, and kept called, because ALWAYS_POST_KINDS still means
 * something: those kinds post regardless of any future gate added here.
 */
export function postsImmediately(_severity: AlertSeverity, _kind?: string): boolean {
  return true
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

/**
 * notifications.type values addressed to an admin AS AN OPERATOR. Only these
 * are mirrored to #ops-alerts when the admin has no push token.
 *
 * WHY (docs/OPEN.md Q2, measured 2026-09-23): the mirror keyed on "the
 * recipient holds the admin role", not on what the notification IS. The
 * owner's own account is an admin AND a party to jobs, so its ordinary user
 * mail — "Did you finish this job?", "We've asked support to step in", "Job
 * auto-cancelled", a chat message from "Perry P." — posted to #ops-alerts as
 * critical pages. `admin_alert` is the operator type (20260903025724);
 * `system_alert` is operator-only in practice (every non-admin recipient on
 * prod is a seed fixture). Operator alerts filed under a user type
 * ('warning' "Job disputed" / "Transfer failed") each have their own Slack
 * path (the dispute_filed trigger, transferFailed.ts), so leaving them out
 * drops nothing. src/test/adminPushMirror.test.ts pins this.
 */
export const OPERATOR_NOTIFICATION_TYPES = ['admin_alert', 'system_alert'] as const

/** True when an admin's notification of this type is an operator alert. */
export function isOperatorNotification(type: string | null | undefined): boolean {
  return (OPERATOR_NOTIFICATION_TYPES as readonly string[]).includes(String(type ?? ''))
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * The job or user an admin notification's link points at, so the mirror can
 * ask whether that subject is seed/E2E data. Reads `job=<uuid>`,
 * `/jobs/<uuid>` and `user=<uuid>`; null when the link names neither.
 */
export function alertSubjectFromLink(link: string | null | undefined): { jobId?: string; userId?: string } | null {
  if (!link) return null
  const l = link.toLowerCase()
  const job = new RegExp(`(?:[?&]job(?:_id)?=|/jobs?/)(${UUID})`).exec(l)?.[1]
  const user = new RegExp(`[?&]user(?:_id)?=(${UUID})`).exec(l)?.[1]
  if (!job && !user) return null
  return { ...(job ? { jobId: job } : {}), ...(user ? { userId: user } : {}) }
}

/** UTC midnight of `now`, as an ISO string: the start of a once-per-day window. */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}
