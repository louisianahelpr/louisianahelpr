// Resend bounce / complaint webhook → `public.suppressed_emails`.
//
// WHY THIS EXISTS
// ---------------
// `suppressed_emails` is READ on every send path that matters:
//   • send-notification-email  — fails CLOSED if the read errors
//   • engagement-automations   — aborts the whole run if the read errors
// …and until now NOTHING in the entire repo ever INSERTED a row. `grep -rn
// "suppressed_emails" supabase/functions` returned reads only. The table has
// been empty since the migration that created it (20260312162845), so both
// of those carefully written guards were no-ops: every hard bounce and every
// spam complaint was mailed again on the next cron tick, which is precisely
// how a sending domain's reputation dies.
//
// This function closes that loop. Resend POSTs `email.bounced` and
// `email.complained`; each recipient address is appended to the suppression
// list, and every send path picks it up from the next message onward.
//
// ─────────────────────────────────────────────────────────────────────────
// DEPLOYMENT — TWO THINGS THE OWNER MUST DO
//
//   1. SECRET.  Create the webhook in Resend (Dashboard → Webhooks) for the
//      events `email.bounced` and `email.complained`, pointing at
//         https://<project>.supabase.co/functions/v1/resend-webhook
//      Resend shows a signing secret once, of the form `whsec_<base64>`.
//      Store it as a Supabase function secret:
//         supabase secrets set RESEND_WEBHOOK_SECRET=whsec_xxxxxxxx
//      Signature verification is the SDK's own `resend.webhooks.verify()`,
//      so the signing scheme and the event payload types are the vendor's
//      problem rather than ours.
//
//      If RESEND_WEBHOOK_SECRET is NOT set this function refuses every
//      request with 503. It deliberately does not run unsigned: the endpoint
//      writes to an append-only table that permanently stops mail to an
//      address, so an unauthenticated caller could silently blackhole any
//      user's email.
//
//   2. GATEWAY.  `supabase/config.toml` needs
//         [functions.resend-webhook]
//           verify_jwt = false
//      because Resend sends a webhook signature, not a Supabase JWT. Without
//      it the gateway rejects every delivery before this code runs. That file
//      is outside this change's edit scope — it must be added separately.
//      (Same for a `KNOWN_UNREFERENCED` entry in
//      scripts/check-dead-edge-functions.mjs: this function is invoked by
//      Resend over HTTPS, so nothing in the repo names it.)
// ─────────────────────────────────────────────────────────────────────────
//
// REPLAY SAFETY
// Deliveries are retried by Resend and may arrive more than once. Every write
// is an `ON CONFLICT DO NOTHING` upsert keyed on the unique `email` column,
// so a replay is a no-op rather than an error, and the handler always answers
// 200 once the signature checks out.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@6.25.0'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'

/** Events we act on. Anything else is acknowledged and ignored. */
const BOUNCE_EVENT = 'email.bounced'
const COMPLAINT_EVENT = 'email.complained'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Every recipient address on the event, lowercased and de-duplicated. */
function recipientsOf(data: Record<string, unknown> | undefined): string[] {
  if (!data) return []
  const raw = data.to ?? data.email ?? data.recipient
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const cleaned = list
    .filter((v): v is string => typeof v === 'string')
    // Resend may send "Name <addr@example.com>" — keep only the address.
    .map((v) => {
      const angled = v.match(/<([^>]+)>/)
      return (angled ? angled[1] : v).trim().toLowerCase()
    })
    .filter((v) => v.includes('@'))
  return [...new Set(cleaned)]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) {
    // Fail CLOSED. See the header note: an unsigned caller here can blackhole
    // any address permanently.
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET not configured — refusing unsigned webhook')
    return json({ error: 'Webhook signing secret not configured' }, 503)
  }

  const rawBody = await req.text()

  // The SDK verifies the standard-webhooks signature and hands back a typed
  // event. `verify` THROWS on a bad signature, a replayed timestamp, or a
  // malformed body — all of which are a 401, never a 200.
  let payload: { type?: string; data?: Record<string, unknown>; created_at?: string }
  try {
    payload = new Resend(Deno.env.get('RESEND_API_KEY') ?? 'unused').webhooks.verify({
      payload: rawBody,
      headers: req.headers,
      webhookSecret: secret,
    }) as typeof payload
  } catch (err) {
    console.error('[resend-webhook] signature verification failed:', err instanceof Error ? err.message : String(err))
    return json({ error: 'Invalid signature' }, 401)
  }

  const eventType = typeof payload?.type === 'string' ? payload.type : ''
  if (eventType !== BOUNCE_EVENT && eventType !== COMPLAINT_EVENT) {
    // 200 on purpose: an unhandled event is not a delivery failure, and a
    // non-2xx would make Resend retry it forever.
    return json({ ok: true, ignored: eventType || 'unknown' })
  }

  const data = payload.data ?? {}
  const emails = recipientsOf(data)
  if (emails.length === 0) {
    console.warn('[resend-webhook] event carried no usable recipient', { eventType })
    return json({ ok: true, suppressed: 0, reason: 'no_recipient' })
  }

  const isComplaint = eventType === COMPLAINT_EVENT
  // Resend bounce classes: Permanent | Transient | Undetermined. A Transient
  // bounce is a full mailbox or a greylist — suppressing on one would
  // permanently cut off a perfectly good address, so only hard/unknown
  // bounces suppress. Complaints always suppress.
  const bounce = (data.bounce ?? {}) as { type?: string; subType?: string; message?: string }
  const bounceType = typeof bounce.type === 'string' ? bounce.type : 'Undetermined'
  if (!isComplaint && bounceType.toLowerCase() === 'transient') {
    console.log('[resend-webhook] transient bounce — not suppressing', { emails, subType: bounce.subType })
    return json({ ok: true, suppressed: 0, reason: 'transient_bounce' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
  )

  const rows = emails.map((email) => ({
    email,
    reason: isComplaint ? 'complaint' : 'bounce',
    metadata: {
      event: eventType,
      received_at: new Date().toISOString(),
      resend_email_id: typeof data.email_id === 'string' ? data.email_id : null,
      bounce_type: isComplaint ? null : bounceType,
      bounce_sub_type: isComplaint ? null : (bounce.subType ?? null),
      bounce_message: isComplaint ? null : (bounce.message ?? null),
    },
  }))

  // `ignoreDuplicates` emits ON CONFLICT DO NOTHING, which is what makes this
  // replay-safe: `suppressed_emails` is append-only (no UPDATE policy) and a
  // redelivered webhook must not error.
  const { error: upsertError } = await supabase
    .from('suppressed_emails')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })

  if (upsertError) {
    // Non-2xx so Resend retries — losing a suppression is exactly the failure
    // this function exists to prevent.
    console.error('[resend-webhook] suppression write failed:', upsertError.message)
    return json({ error: 'Failed to record suppression' }, 500)
  }

  console.log('[resend-webhook] suppressed', { eventType, count: rows.length })
  return json({ ok: true, suppressed: rows.length })
})
