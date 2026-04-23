// Server-side Slack ops alert dispatcher for edge functions.
// Posts directly to the Lovable connector gateway (no extra HTTP hop
// through the slack-ops-alert function). Designed to be fire-and-forget:
// callers should NOT await this for latency-sensitive paths, and
// failures NEVER throw — Slack outages must not break platform flows.

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api'

export type SlackAlertSeverity = 'critical' | 'warning' | 'info'

export type SlackAlertKind =
  | 'dispute_filed'
  | 'fraud_flag'
  | 'payout_failed'
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
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    const slackKey = Deno.env.get('SLACK_API_KEY')
    if (!lovableKey || !slackKey) return

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

    const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': slackKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: `${icon} ${input.title} — ${input.message}`,
        blocks,
        attachments: [{ color: SEVERITY_COLOR[severity], blocks: [] }],
      }),
    })

    if (!res.ok) {
      console.warn('[postSlackOpsAlert] Slack gateway non-OK', res.status, await res.text())
    }
  } catch (err) {
    console.warn('[postSlackOpsAlert] suppressed error:', err instanceof Error ? err.message : err)
  }
}
