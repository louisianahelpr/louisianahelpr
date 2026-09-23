// Write one occurrence to public.ops_alert_ledger (docs/OPEN.md Q1).
//
// Called by BOTH Slack transports — postSlackOpsAlert (every edge caller) and
// the slack-ops-alert function (every SQL caller) — so an alert that reaches
// Slack is also an open item that stays open until its detector shows it
// cleared. src/test/opsAlertLedgerCoverage.test.ts fails if a Slack path
// skips this.
//
// Best-effort and never throws: the ledger must not be the reason an alert, a
// payout or a dispute fails. A failed write is logged loudly instead.

export interface LedgerOccurrence {
  sourceKind: 'edge_slack' | 'sql_slack'
  source: string
  title: string
  severity: string
  sample?: string
  sampleRef?: Record<string, unknown>
}

export async function recordOpsAlertLedger(o: LedgerOccurrence): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.warn(`[ops_alert_record] NOT RECORDED (no SUPABASE_URL/SECRET_KEY): ${o.title}`)
    return
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/ops_alert_record`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_source_kind: o.sourceKind,
        p_source: o.source,
        p_title: o.title,
        p_severity: o.severity,
        p_sample: (o.sample ?? o.title).slice(0, 2000),
        p_sample_ref: o.sampleRef ?? {},
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.warn('[ops_alert_record] non-OK', res.status, await res.text())
  } catch (err) {
    console.warn('[ops_alert_record] failed:', err instanceof Error ? err.message : err)
  }
}
