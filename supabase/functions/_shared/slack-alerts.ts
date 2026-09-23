// Server-side Slack ops alert dispatcher for edge functions.
// Fire-and-forget: callers should NOT await this on latency-sensitive paths,
// and failures NEVER throw — Slack outages must not break platform flows.
//
// TWO TRANSPORTS, tried in order:
//
//   1. SLACK_WEBHOOK_URL — an ordinary Slack Incoming Webhook. One secret, no
//      third party, no bot scopes. This is the preferred setup.
//   2. LOVABLE_API_KEY + SLACK_API_KEY — the original path, relaying through
//      connector-gateway.lovable.dev.
//
// Transport 2 is kept only so an existing deployment configured that way keeps
// working. It is not the recommended setup: it routes production incident
// alerts through a third-party gateway and needs TWO credentials, and its
// `if (!lovableKey || !slackKey) return` guard is why every alert in this
// project silently no-opped — including the two in stripe-webhook that fire
// when payments break. Prefer transport 1.
//
// With neither configured this still returns quietly, but now says so in the
// log rather than vanishing, so a missing alarm is discoverable.

import { effectiveSeverity, postsImmediately, utcDayStartIso, type AlertSeverity } from './alertPolicy.ts'
import { recordOpsAlertLedger } from './opsAlertLedger.ts'

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api'

type SlackAlertSeverity = AlertSeverity

type SlackAlertKind =
  | 'dispute_filed'
  | 'dispute_won'
  | 'dispute_lost'
  | 'fraud_flag'
  | 'payout_failed'
  | 'payout_reversed'
  | 'auto_suspended'
  | 'stripe_webhook_error'
  | 'custom'
  // Money or security conditions without a more specific kind. Always critical
  // (alertPolicy CRITICAL_KINDS), whatever severity the call site passes.
  | 'money_at_risk'
  | 'security'
  // A person asking for help. Posts immediately (alertPolicy
  // ALWAYS_POST_KINDS) but keeps its caller's severity, so it arrives as an
  // ℹ️ note rather than a page.
  | 'support_request'

export interface SlackAlertInput {
  kind: SlackAlertKind
  severity?: SlackAlertSeverity
  title: string
  message: string
  fields?: Record<string, string | number | null | undefined>
  link?: string
  channel?: string
  /**
   * Post at most once per UTC day for this key; later calls that day are only
   * counted in the daily digest. Use it for an event that fans out (one per
   * admin) or repeats. Safe under concurrency: every call records a row first
   * and only the earliest row of the day posts.
   */
  oncePerDayKey?: string
}

type ErrorLogRow = { id: string }

function restConfig(): { url: string; key: string } | null {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return url && key ? { url, key } : null
}

/**
 * Record an alert in error_logs (the digest's source). Severity is never
 * 'critical' here, so trg_error_logs_slack does not post it a second time.
 * Returns the row id, or null if it could not be written.
 */
async function recordAlertRow(
  input: SlackAlertInput,
  severity: SlackAlertSeverity,
  extraTags: Record<string, string>,
): Promise<string | null> {
  const rest = restConfig()
  if (!rest) {
    console.warn(`[postSlackOpsAlert] cannot record alert row (no SUPABASE_URL/SECRET_KEY): ${input.title}`)
    return null
  }
  try {
    const res = await fetch(`${rest.url}/rest/v1/error_logs?select=id`, {
      method: 'POST',
      headers: {
        apikey: rest.key,
        Authorization: `Bearer ${rest.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        severity: severity === 'critical' ? 'error' : severity,
        message: `${input.title} — ${input.message}`.slice(0, 1000),
        tags: { source: 'ops-alert', kind: input.kind, ...extraTags },
        context: { fields: input.fields ?? {}, link: input.link ?? null },
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.warn('[postSlackOpsAlert] alert row insert non-OK', res.status, await res.text())
      return null
    }
    const rows = (await res.json()) as ErrorLogRow[]
    return rows?.[0]?.id ?? null
  } catch (err) {
    console.warn('[postSlackOpsAlert] alert row insert failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Give up the once-per-day token this row is holding.
 *
 * The token is claimed BEFORE the Slack POST (the row has to exist for the
 * "earliest row wins" race to be decidable), so a post that then fails would
 * otherwise suppress every retry for the rest of the UTC day — a support
 * request the sender re-sends verbatim is the same key, so it would never
 * reach the channel and the log line would say it already had. Renaming the
 * tag releases the key while keeping the row for the digest.
 *
 * Tags are rewritten wholesale, not merged, because recordAlertRow built them
 * here and their exact shape is known.
 */
async function releaseAlertKey(rowId: string, input: SlackAlertInput, key: string): Promise<void> {
  const rest = restConfig()
  if (!rest) return
  try {
    await fetch(`${rest.url}/rest/v1/error_logs?id=eq.${rowId}`, {
      method: 'PATCH',
      headers: {
        apikey: rest.key,
        Authorization: `Bearer ${rest.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tags: { source: 'ops-alert', kind: input.kind, undelivered_alert_key: key },
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.warn('[postSlackOpsAlert] could not release alert key:', err instanceof Error ? err.message : err)
  }
}

/**
 * How many alerts of this kind already posted in the last hour. A coarse
 * ceiling for the kinds that post at any severity: `support_request` is
 * reachable from an UNAUTHENTICATED form, and while contact-support rate-limits
 * per IP, the dedupe key is content-derived, so changing one character is a new
 * post. Without a ceiling a scripted sender buries the critical pages this
 * channel exists for.
 *
 * Fails OPEN (returns 0) on a read problem: a noisy channel beats a silenced
 * support request.
 */
async function postsThisHour(kind: string): Promise<number> {
  const rest = restConfig()
  if (!rest) return 0
  try {
    const qs = new URLSearchParams({
      select: 'id',
      'tags->>kind': `eq.${kind}`,
      'tags->>source': 'eq.ops-alert',
      // Rows the cap itself wrote do not count towards it, or one burst would
      // keep the channel closed for an hour after it stopped.
      'tags->>capped': 'is.null',
      created_at: `gte.${new Date(Date.now() - 3600_000).toISOString()}`,
      limit: String(ALWAYS_POST_HOURLY_CAP + 1),
    })
    const res = await fetch(`${rest.url}/rest/v1/error_logs?${qs}`, {
      headers: { apikey: rest.key, Authorization: `Bearer ${rest.key}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return 0
    return ((await res.json()) as ErrorLogRow[])?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * True when `myRowId` is the earliest row today for `key`. Fails OPEN (returns
 * true) on any read problem: a duplicate critical alert beats a lost one.
 */
async function isFirstToday(key: string, myRowId: string): Promise<boolean> {
  const rest = restConfig()
  if (!rest) return true
  try {
    const qs = new URLSearchParams({
      select: 'id',
      'tags->>alert_key': `eq.${key}`,
      created_at: `gte.${utcDayStartIso()}`,
      order: 'created_at.asc,id.asc',
      limit: '1',
    })
    const res = await fetch(`${rest.url}/rest/v1/error_logs?${qs}`, {
      headers: { apikey: rest.key, Authorization: `Bearer ${rest.key}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return true
    const rows = (await res.json()) as ErrorLogRow[]
    return !rows?.[0] || rows[0].id === myRowId
  } catch {
    return true
  }
}

/** Per-hour ceiling for a non-critical ALWAYS_POST kind. Critical never caps. */
const ALWAYS_POST_HOURLY_CAP = 12

const SEVERITY_ICON: Record<SlackAlertSeverity, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
}

const SEVERITY_COLOR: Record<SlackAlertSeverity, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#3b82f6',
}

export async function postSlackOpsAlert(input: SlackAlertInput): Promise<void> {
  // Declared outside the try so the catch below can release it: the once-per-day
  // token must not survive a post that threw.
  let heldKey: { rowId: string; key: string } | null = null
  try {
    const policySeverity = effectiveSeverity(input.kind, input.severity)

    // Every call is an occurrence in the ops alert ledger (docs/OPEN.md Q1),
    // including the ones the hourly cap or the once-per-day key keep out of
    // Slack: those are still alerts, and the ledger is what stays open until
    // the condition is shown cleared. Awaited so it survives the isolate, but
    // it cannot throw.
    await recordOpsAlertLedger({
      sourceKind: 'edge_slack',
      source: `ops-alert:${input.kind}`,
      title: input.title,
      severity: policySeverity,
      sample: `${input.title} — ${input.message}`,
      sampleRef: { link: input.link ?? null, oncePerDayKey: input.oncePerDayKey ?? null },
    })

    // A non-critical kind that posts anyway (today: support_request) gets an
    // hourly ceiling. Critical is never capped: a page must never be
    // rate-limited by this project's own code. ('digest' is not a
    // SlackAlertKind — the SQL digest posts over HTTP, not through here.)
    if (policySeverity !== 'critical') {
      const recent = await postsThisHour(input.kind)
      if (recent >= ALWAYS_POST_HOURLY_CAP) {
        await recordAlertRow(input, policySeverity, { capped: 'hourly' })
        console.warn(
          `[postSlackOpsAlert] ${input.kind} hourly cap (${ALWAYS_POST_HOURLY_CAP}) reached; ` +
          `"${input.title}" is recorded for the digest instead of posted.`,
        )
        return
      }
    }

    /**
     * RECORD THE NON-CRITICAL ONES, THEN POST THEM.
     *
     * This used to read `if (!postsImmediately(...)) { record; return }` —
     * warning and info were written to error_logs and stopped there, waiting
     * for `send_ops_daily_digest`. On 2026-09-22 that policy was reversed
     * (owner: "medium and low alerts should show in slack also"), because the
     * digest is itself a cron and died in that morning's startup-timeout
     * outage together with the report of the outage.
     *
     * `postsImmediately` now always returns true, so that branch became
     * unreachable — and it was the ONLY thing writing the durable row for a
     * non-critical alert. Deleting it silently traded a record for a post.
     * Both matter, and they matter for different reasons: Slack is the
     * notification, error_logs is what survives a Slack outage, a rate limit,
     * or nobody being awake.
     *
     * Critical alerts are not recorded here, as before — their callers own
     * that, and `trg_error_logs_slack` would otherwise post the row a second
     * time (the note above `recordAlertRow` explains the 'error' downgrade
     * that exists for exactly that reason).
     */
    if (policySeverity !== 'critical' && !input.oncePerDayKey) {
      await recordAlertRow(input, policySeverity, {})
    }
    // Placed AFTER the hourly cap on purpose: the capped path writes its own
    // row tagged `capped: 'hourly'`, and recording here as well produced TWO
    // rows for one suppressed alert. A row now means "this was posted", which
    // is also what makes it the right thing for `postsThisHour` to count.

    // The once-per-day token is CLAIMED here and RELEASED below if the post
    // does not actually reach Slack.
    if (input.oncePerDayKey) {
      const rowId = await recordAlertRow(input, policySeverity, { alert_key: input.oncePerDayKey })
      if (rowId && !(await isFirstToday(input.oncePerDayKey, rowId))) {
        console.log(`[postSlackOpsAlert] already posted today for ${input.oncePerDayKey}; counted for the digest`)
        return
      }
      if (rowId) heldKey = { rowId, key: input.oncePerDayKey }
    }

    const webhookUrl = Deno.env.get('SLACK_WEBHOOK_URL')
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    const slackKey = Deno.env.get('SLACK_API_KEY')
    if (!webhookUrl && !(lovableKey && slackKey)) {
      if (heldKey) await releaseAlertKey(heldKey.rowId, input, heldKey.key)
      // Loud on purpose. The silent version of this line meant a critical
      // "payments are broken" alert produced no Slack message AND no trace.
      console.warn(
        `[postSlackOpsAlert] NOT SENT (no transport configured) — ${input.severity ?? 'warning'}: ${input.title}. ` +
        'Set SLACK_WEBHOOK_URL to enable alerts.',
      )
      return
    }

    const severity = policySeverity
    const channel = input.channel || Deno.env.get('SLACK_OPS_CHANNEL') || '#ops-alerts'
    const icon = SEVERITY_ICON[severity]

    const fieldEntries = Object.entries(input.fields || {}).filter(
      ([, v]) => v !== null && v !== undefined && String(v).length > 0,
    )

    const blocks: unknown[] = [
      { type: 'header', text: { type: 'plain_text', text: `${icon} ${input.title}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: input.message } },
    ]

    if (fieldEntries.length) {
      blocks.push({
        type: 'section',
        fields: fieldEntries.slice(0, 10).map(([k, v]) => ({
          type: 'mrkdwn',
          text: `*${k}:*\n${String(v)}`,
        })),
      })
    }

    if (input.link) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<${input.link}|Open in admin →>` }],
      })
    }

    // An Incoming Webhook is bound to one channel at creation, so `channel`
    // is only meaningful on the gateway transport; it is sent anyway because
    // legacy custom-integration webhooks still honour it and modern ones
    // ignore it harmlessly.
    const payload = {
      channel,
      text: `${icon} ${input.title} — ${input.message}`,
      blocks,
      attachments: [{ color: SEVERITY_COLOR[severity], blocks: [] }],
    }

    const res = webhookUrl
      ? await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        })
      : await fetch(`${GATEWAY_URL}/chat.postMessage`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            // The guard at the top of this function already returned unless
            // `webhookUrl` OR (`lovableKey` && `slackKey`) is set, so reaching
            // this branch means both gateway keys are present. TS cannot narrow
            // through that composite condition; assert what the guard proved
            // rather than weaken the guard.
            'X-Connection-Api-Key': slackKey as string,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        })

    if (!res.ok) {
      console.warn('[postSlackOpsAlert] Slack gateway non-OK', res.status, await res.text())
      if (heldKey) await releaseAlertKey(heldKey.rowId, input, heldKey.key)
    }
  } catch (err) {
    console.warn('[postSlackOpsAlert] suppressed error:', err instanceof Error ? err.message : err)
    if (heldKey) await releaseAlertKey(heldKey.rowId, input, heldKey.key)
  }
}
