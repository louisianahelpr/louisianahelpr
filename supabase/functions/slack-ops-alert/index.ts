// Slack ops-alerts dispatcher.
// Posts critical platform events (disputes, fraud flags, payout failures,
// auto-suspensions) into a Slack channel via the Slack Web API.
//
// Fire-and-forget by design: callers should NOT await the result for
// latency-sensitive flows. Failures are logged but never thrown back to
// callers — Slack outages must never break a dispute or payout.

import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'

const SLACK_API_URL = 'https://slack.com/api'
const DEFAULT_CHANNEL = Deno.env.get('SLACK_OPS_CHANNEL') || '#ops-alerts'

type AlertSeverity = 'critical' | 'warning' | 'info'
type AlertKind =
  | 'dispute_filed'
  | 'fraud_flag'
  | 'payout_failed'
  | 'auto_suspended'
  | 'stripe_webhook_error'
  | 'custom'

interface AlertBody {
  kind: AlertKind
  severity?: AlertSeverity
  title: string
  message: string
  // Optional structured fields rendered as a fields block
  fields?: Record<string, string | number | null | undefined>
  // Optional admin deep link (e.g. /admin?tab=disputes&job=...)
  link?: string
  // Override the destination channel (defaults to SLACK_OPS_CHANNEL or #ops-alerts)
  channel?: string
}

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
}

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#3b82f6',
}

function buildBlocks(body: AlertBody, severity: AlertSeverity) {
  const icon = SEVERITY_ICON[severity]
  const fieldEntries = Object.entries(body.fields || {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).length > 0
  )

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${icon} ${body.title}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: body.message },
    },
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

  if (body.link) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${body.link}|Open in admin →>` }],
    })
  }

  return blocks
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Internal-only endpoint — callers must present CRON_SECRET or SERVICE_ROLE_KEY.
  // Without this gate, any unauthenticated caller can inject arbitrary messages
  // into the ops Slack channel (alert spam, phishing links, social engineering).
  const cronSecret     = Deno.env.get('CRON_SECRET')
  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader     = req.headers.get('Authorization') ?? ''
  const authorized =
    (cronSecret     && authHeader === `Bearer ${cronSecret}`) ||
    (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`)
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const slackKey = Deno.env.get('SLACK_API_KEY')

    if (!slackKey) {
      console.error('slack-ops-alert: missing SLACK_API_KEY')
      return new Response(
        JSON.stringify({ skipped: true, reason: 'slack_not_configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = (await req.json()) as AlertBody
    if (!body?.kind || !body?.title || !body?.message) {
      return new Response(
        JSON.stringify({ error: 'kind, title, and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const severity: AlertSeverity = body.severity ?? 'warning'
    const channel = body.channel || DEFAULT_CHANNEL
    const blocks = buildBlocks(body, severity)

    const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text: `${SEVERITY_ICON[severity]} ${body.title} — ${body.message}`,
        blocks,
        attachments: [
          { color: SEVERITY_COLOR[severity], blocks: [] },
        ],
      }),
    })

    const data = await res.json()
    if (!res.ok || data?.ok === false) {
      console.error('slack-ops-alert: Slack API error', { status: res.status, data })
      return new Response(
        JSON.stringify({ ok: false, error: data?.error || `http_${res.status}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ ok: true, ts: data.ts, channel: data.channel }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('slack-ops-alert: unexpected error', err)
    // Never propagate failures to caller.
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
