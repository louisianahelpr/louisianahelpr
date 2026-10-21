// Sends SMS alerts through Twilio.
//
// Callers (service-role bearer only; not user-callable):
//   * { drain: true } from the SQL cron sms-dispatch (every 2 minutes)
//     (public.sms_dispatch_due, migration 20261021193738_sms_alerts) when a
//     queued text is due: 3 minutes after its alert, or the end of quiet hours.
//   * { confirm_user_id } from set_sms_consent: the double opt-in text.
//
// Every decision (the alert still unread, consent, seed/test suppression,
// bans, the sms_alerts switch, category toggles, staleness, quiet hours,
// caps, idempotency) is made in ONE place, the service-role RPCs
// public.sms_claim_due() / sms_claim_confirmation(). This function only builds
// the fixed text (_shared/smsPolicy.ts: never the notification's title or
// body) and talks to Twilio.
//
// Without TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID
// every due row is recorded as skipped 'twilio_not_configured' and nothing is sent.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { serve } from '../_shared/buildStamp.ts'
import { timingSafeEqual } from '../_shared/safe-strings.ts'
import { caughtMessage } from '../_shared/caughtMessage.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { buildSmsBody, isSmsKind, twilioConfig, type SmsKind } from '../_shared/smsPolicy.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Rows claimed per batch, and batches per run: at most 4 x 25 texts a run. */
const BATCH = 25
const MAX_BATCHES = 4

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

interface Claim {
  action?: string
  reason?: string
  sms_id?: string
  phone?: string
  kind?: string
  job_id?: string | null
  first_text?: boolean
  /** The confirmation's 4-digit code (kind 'confirm' only). */
  code?: string
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!serviceRoleKey || !timingSafeEqual(presented, serviceRoleKey)) {
    return json(401, { error: 'Unauthorized' })
  }

  let payload: { drain?: unknown; confirm_user_id?: unknown }
  try {
    payload = ((await req.json()) ?? {}) as typeof payload
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const confirmUserId = payload.confirm_user_id
  const isConfirm = typeof confirmUserId === 'string' && UUID_RE.test(confirmUserId)
  const isDrain = payload.drain === true
  if (!isConfirm && !isDrain) {
    return json(400, { error: 'drain: true or confirm_user_id (a uuid) is required' })
  }

  const twilio = twilioConfig((k) => Deno.env.get(k))
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

  const recordResult = async (
    smsId: string,
    status: 'sent' | 'failed',
    sid: string | null,
    errorCode: string | null,
  ): Promise<boolean> => {
    const { data, error } = await supabase.rpc('sms_record_result', {
      p_sms_id: smsId,
      p_status: status,
      p_provider_sid: sid,
      p_error_code: errorCode,
    })
    if (error) {
      console.error(`[send-sms-notification] sms_record_result failed for ${smsId}: ${error.message}`)
      return false
    }
    if (data !== true) {
      console.error(`[send-sms-notification] sms_record_result changed no row for ${smsId}`)
      return false
    }
    return true
  }

  /** Sends one claimed text; records Twilio's answer. true = sent. */
  const sendOne = async (claim: Claim): Promise<{ sent: boolean; errorCode: string | null; recorded: boolean }> => {
    if (!twilio || !claim.sms_id || !claim.phone || !isSmsKind(claim.kind)) {
      // The claims only hand out complete rows; anything else is a bug.
      console.error(`[send-sms-notification] malformed claim ${claim.sms_id ?? '(no id)'}`)
      const recorded = claim.sms_id ? await recordResult(claim.sms_id, 'failed', null, 'malformed_claim') : false
      return { sent: false, errorCode: 'malformed_claim', recorded }
    }
    const body = buildSmsBody({
      kind: claim.kind as SmsKind,
      jobId: claim.job_id,
      firstText: claim.first_text === true,
      appUrl: getAppUrl(),
      confirmCode: claim.code,
    })
    let sid: string | null = null
    let errorCode: string | null = null
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`${twilio.accountSid}:${twilio.authToken}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            MessagingServiceSid: twilio.messagingServiceSid,
            To: claim.phone,
            Body: body,
          }).toString(),
        },
      )
      const out = (await res.json().catch(() => ({}))) as { sid?: string; code?: number | string }
      if (res.ok && typeof out.sid === 'string') {
        sid = out.sid
      } else {
        errorCode = out.code != null ? String(out.code) : `http_${res.status}`
      }
    } catch (err) {
      errorCode = 'network'
      console.error(`[send-sms-notification] Twilio request threw: ${caughtMessage(err)}`)
    }
    const recorded = await recordResult(claim.sms_id, sid ? 'sent' : 'failed', sid, errorCode)
    if (!sid) console.error(`[send-sms-notification] Twilio refused text ${claim.sms_id}: ${errorCode}`)
    return { sent: sid !== null, errorCode, recorded }
  }

  if (isConfirm) {
    const { data, error } = await supabase.rpc('sms_claim_confirmation', {
      p_user_id: confirmUserId,
      p_provider_ready: twilio !== null,
    })
    if (error) {
      console.error(`[send-sms-notification] confirmation claim failed for ${String(confirmUserId)}: ${error.message}`)
      return json(500, { error: 'claim_failed' })
    }
    const claim = (data ?? {}) as Claim
    if (claim.action !== 'send') return json(200, { sent: false, reason: claim.reason ?? 'unknown' })
    const r = await sendOne(claim)
    if (r.errorCode === 'malformed_claim') return json(500, { error: 'malformed_claim' })
    return r.sent ? json(200, { sent: true, recorded: r.recorded }) : json(502, { sent: false, error_code: r.errorCode, recorded: r.recorded })
  }

  // Drain: claim due rows in batches until none are left (or the run's cap).
  let sent = 0
  let failed = 0
  let unrecorded = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await supabase.rpc('sms_claim_due', { p_limit: BATCH, p_provider_ready: twilio !== null })
    if (error) {
      console.error(`[send-sms-notification] sms_claim_due failed: ${error.message}`)
      return json(500, { error: 'claim_failed', sent, failed })
    }
    const claims = (Array.isArray(data) ? data : []) as Claim[]
    for (const claim of claims) {
      const r = await sendOne(claim)
      if (r.sent) sent++
      else failed++
      if (!r.recorded) unrecorded++
    }
    if (claims.length < BATCH) break
  }
  // A text that went out but could not be recorded stays 'queued': loud, so it
  // is looked at (it is never re-sent: only 'pending' rows are claimed).
  if (unrecorded > 0) return json(500, { error: 'result_not_recorded', sent, failed, unrecorded })
  return json(200, { sent, failed })
})
