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

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api'

type SlackAlertSeverity = 'critical' | 'warning' | 'info'

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

export interface SlackAlertInput {
  kind: SlackAlertKind
  severity?: SlackAlertSeverity
  title: string
  message: string
  fields?: Record<string, string | number | null | undefined>
  link?: string
  channel?: string
}

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
  try {
    const webhookUrl = Deno.env.get('SLACK_WEBHOOK_URL')
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    const slackKey = Deno.env.get('SLACK_API_KEY')
    if (!webhookUrl && !(lovableKey && slackKey)) {
      // Loud on purpose. The silent version of this line meant a critical
      // "payments are broken" alert produced no Slack message AND no trace.
      console.warn(
        `[postSlackOpsAlert] NOT SENT (no transport configured) — ${input.severity ?? 'warning'}: ${input.title}. ` +
        'Set SLACK_WEBHOOK_URL to enable alerts.',
      )
      return
    }

    const severity = input.severity ?? 'warning'
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
    }
  } catch (err) {
    console.warn('[postSlackOpsAlert] suppressed error:', err instanceof Error ? err.message : err)
  }
}
