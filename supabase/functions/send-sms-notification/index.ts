// Sends one SMS alert for one notification, through Twilio.
//
// Caller: ONLY the notifications AFTER INSERT trigger
// (public.sms_fan_out_on_notification, migration 20261020022332_sms_alerts),
// which posts { notification_id } with the service-role bearer. Not
// user-callable.
//
// Every decision (consent, seed/test suppression, the sms_alerts switch,
// category toggle, quiet hours, caps, idempotency) is made in ONE place, the
// service-role RPC public.sms_claim(). This function only builds the fixed
// text (_shared/smsPolicy.ts: never the notification's title or body) and
// talks to Twilio.
//
// Without TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID
// the claim is recorded as skipped 'twilio_not_configured' and nothing is sent.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { serve } from '../_shared/buildStamp.ts'
import { timingSafeEqual } from '../_shared/safe-strings.ts'
import { caughtMessage } from '../_shared/caughtMessage.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { buildSmsBody, isSmsKind, twilioConfig } from '../_shared/smsPolicy.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!serviceRoleKey || !timingSafeEqual(presented, serviceRoleKey)) {
    return json(401, { error: 'Unauthorized' })
  }

  let notificationId: unknown
  try {
    notificationId = ((await req.json()) as { notification_id?: unknown })?.notification_id
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (typeof notificationId !== 'string' || !UUID_RE.test(notificationId)) {
    return json(400, { error: 'notification_id must be a uuid' })
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

  const { data: claimData, error: claimError } = await supabase.rpc('sms_claim', {
    p_notification_id: notificationId,
    p_provider_ready: twilio !== null,
  })
  if (claimError) {
    console.error(`[send-sms-notification] sms_claim failed for ${notificationId}: ${claimError.message}`)
    return json(500, { error: 'claim_failed' })
  }
  const claim = (claimData ?? {}) as Claim
  if (claim.action !== 'send') {
    return json(200, { sent: false, reason: claim.reason ?? 'unknown' })
  }
  if (!twilio || !claim.sms_id || !claim.phone || !isSmsKind(claim.kind)) {
    // sms_claim only says 'send' with all of these; anything else is a bug.
    console.error(`[send-sms-notification] malformed claim for ${notificationId}`)
    if (claim.sms_id) await recordResult(claim.sms_id, 'failed', null, 'malformed_claim')
    return json(500, { error: 'malformed_claim' })
  }

  const body = buildSmsBody({
    kind: claim.kind,
    jobId: claim.job_id,
    firstText: claim.first_text === true,
    appUrl: getAppUrl(),
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

  const ok = await recordResult(claim.sms_id, sid ? 'sent' : 'failed', sid, errorCode)
  if (!sid) {
    console.error(`[send-sms-notification] Twilio refused text ${claim.sms_id}: ${errorCode}`)
    return json(502, { sent: false, error_code: errorCode, recorded: ok })
  }
  return json(200, { sent: true, recorded: ok })
})
