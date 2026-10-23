// SMS alerts: READ-ONLY Twilio check for Admin -> Settings -> Text alerts.
//
// Admin only (verified JWT + has_role admin). Makes GET requests only; it
// never sends a text:
//   1. GET  messaging.twilio.com/v1/Services/{MG}            (credentials + service exist)
//   2. GET  messaging.twilio.com/v1/Services/{MG}/PhoneNumbers (the sender number(s))
//   3. GET  messaging.twilio.com/v1/Tollfree/Verifications    (toll-free verification status)
// Returns only status words and the service name, never a secret.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { serve } from '../_shared/buildStamp.ts'
import { caughtMessage } from '../_shared/caughtMessage.ts'
import { twilioConfig } from '../_shared/smsPolicy.ts'
import { refuseUnconfirmedEmail } from '../_shared/requireConfirmedEmail.ts'
import { writeAdminAudit } from '../_shared/adminAuditLog.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' })

  const anonClient = createClient(url, anonKey)
  const { data: userData, error: userErr } = await anonClient.auth.getUser(authHeader.slice(7))
  if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' })
  const unconfirmedEmail = refuseUnconfirmedEmail(userData.user, corsHeaders);
  if (unconfirmedEmail) return unconfirmedEmail;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: isAdmin, error: roleError } = await admin.rpc('has_role', { _user_id: userData.user.id, _role: 'admin' })
  if (roleError) {
    console.error('[sms-provider-check] has_role failed:', roleError.message)
    return json(503, { error: "Couldn't verify permissions. Please retry." })
  }
  if (isAdmin !== true) return json(403, { error: 'Forbidden: admin only' })

  // Q76: who looked at the text provider's status, and when. The check itself
  // only reads (GETs), but it uses the Twilio credentials, so it is recorded.
  await writeAdminAudit(admin, {
    adminId: userData.user.id,
    action: 'sms_provider_check',
    targetType: 'sms_provider',
    targetId: 'twilio',
    source: 'sms-provider-check',
  }, postSlackOpsAlert)

  const twilio = twilioConfig((k) => Deno.env.get(k))
  if (!twilio) {
    return json(200, {
      configured: false,
      secrets: {
        TWILIO_ACCOUNT_SID: Boolean(Deno.env.get('TWILIO_ACCOUNT_SID')),
        TWILIO_AUTH_TOKEN: Boolean(Deno.env.get('TWILIO_AUTH_TOKEN')),
        TWILIO_MESSAGING_SERVICE_SID: Boolean(Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')),
      },
    })
  }

  const auth = `Basic ${btoa(`${twilio.accountSid}:${twilio.authToken}`)}`
  const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    try {
      const res = await fetch(`https://messaging.twilio.com/v1/${path}`, { method: 'GET', headers: { Authorization: auth } })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { status: res.status, body }
    } catch (err) {
      console.error(`[sms-provider-check] GET ${path} threw: ${caughtMessage(err)}`)
      return { status: 0, body: {} }
    }
  }

  const service = await get(`Services/${twilio.messagingServiceSid}`)
  if (service.status !== 200) {
    return json(200, {
      configured: true,
      credentials_ok: false,
      http_status: service.status,
      // 401/20003 = wrong SID/token; 404/20404 = no such Messaging Service on this account.
      error_code: typeof service.body.code === 'number' ? service.body.code : null,
    })
  }

  const numbers = await get(`Services/${twilio.messagingServiceSid}/PhoneNumbers?PageSize=20`)
  const phoneNumbers = Array.isArray(numbers.body.phone_numbers)
    ? (numbers.body.phone_numbers as Array<Record<string, unknown>>)
    : []
  const verifications = await get('Tollfree/Verifications?PageSize=20')
  const verificationRows = Array.isArray(verifications.body.verifications)
    ? (verifications.body.verifications as Array<Record<string, unknown>>)
    : []
  const senderSids = new Set(phoneNumbers.map((n) => n.sid))

  return json(200, {
    configured: true,
    credentials_ok: true,
    service_name: typeof service.body.friendly_name === 'string' ? service.body.friendly_name : null,
    inbound_webhook_set: typeof service.body.inbound_request_url === 'string' &&
      (service.body.inbound_request_url as string).endsWith('/functions/v1/twilio-inbound'),
    sender_count: phoneNumbers.length,
    tollfree_verification: verifications.status === 200
      ? verificationRows
          .filter((v) => senderSids.size === 0 || senderSids.has(v.tollfree_phone_number_sid))
          .map((v) => ({ status: typeof v.status === 'string' ? v.status : 'unknown' }))
      : null,
  })
})
