// Twilio's inbound-message webhook for the SMS alerts number (set as the
// Messaging Service's "Request URL"; see ~/.lh-wt/TWILIO-SETUP-FOR-OWNER.md).
//
// verify_jwt = false (supabase/config.toml): Twilio sends no Supabase JWT.
// Instead EVERY request must carry a valid X-Twilio-Signature, an
// HMAC-SHA1 of the public URL plus the POST params keyed with
// TWILIO_AUTH_TOKEN, compared in constant time. Anything else is 403 and
// changes nothing.
//
// STOP-family words opt the number out (public.sms_inbound_keyword). "YES
// 4821" (the code from the confirmation text) opts in the account that
// confirmation was sent for; a bare START re-subscribes the account that last
// left by STOP; a bare YES gets a hint to add the code; a confirmed "YES 4821" gets SMS_OPTED_IN_REPLY. HELP gets the fixed
// help reply. Every other message is ignored (empty TwiML).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { serve } from '../_shared/buildStamp.ts'
import { timingSafeEqual } from '../_shared/safe-strings.ts'
import { SMS_CONFIRM_HINT, SMS_HELP_REPLY, SMS_OPTED_IN_REPLY, classifyInboundKeyword, parseConfirmCode, twilioSignature, twiml } from '../_shared/smsPolicy.ts'

const XML = { 'Content-Type': 'text/xml' }

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')?.trim() ?? ''
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  if (!authToken || !supabaseUrl) {
    return new Response('Not configured', { status: 503 })
  }

  const raw = await req.text()
  const form = new URLSearchParams(raw)
  const params: Record<string, string> = {}
  for (const [k, v] of form) params[k] = v

  // Twilio signs the URL it was configured with, which is the PUBLIC one; the
  // request URL inside the edge runtime is not, so it is rebuilt here.
  const publicUrl = `${supabaseUrl}/functions/v1/twilio-inbound`
  const expected = await twilioSignature(authToken, publicUrl, params)
  const presented = req.headers.get('X-Twilio-Signature') ?? ''
  if (!timingSafeEqual(presented, expected)) {
    return new Response('Forbidden', { status: 403 })
  }

  const action = classifyInboundKeyword(params.Body)
  if (action === 'help') {
    return new Response(twiml(SMS_HELP_REPLY), { status: 200, headers: XML })
  }
  if (action === 'stop' || action === 'start') {
    const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const code = action === 'start' ? parseConfirmCode(params.Body) : null
    const { data: changed, error } = await supabase.rpc('sms_inbound_keyword', {
      p_phone: params.From ?? '',
      p_action: action,
      p_code: code,
    })
    if (error) {
      // 500 so Twilio's webhook log shows the failure; Twilio's own opt-out
      // list still blocks texts to a STOPped number at the carrier.
      console.error(`[twilio-inbound] sms_inbound_keyword(${action}) failed: ${error.message}`)
      return new Response('Error', { status: 500 })
    }
    // A bare YES (no code) changed nothing: say what to send instead. START is
    // a carrier keyword that Twilio answers itself, so it gets no extra reply.
    if (action === 'start' && code === null && changed === 0 && /^\s*yes\b/i.test(params.Body ?? '')) {
      return new Response(twiml(SMS_CONFIRM_HINT), { status: 200, headers: XML })
    }
    // A YES <code> that left this number opted in: the confirmation auto-reply Twilio's A2P review requires (owner,
    // 2026-10-23). 1 row = opted in now: the code matched, or (wrong code) a number that sent STOP in the last 30 days
    // was re-subscribed (sms_inbound_keyword's START branch). 0 = nothing changed, no reply. A bare START gets none:
    // Twilio answers that carrier keyword itself.
    if (action === 'start' && code !== null && changed === 1) {
      return new Response(twiml(SMS_OPTED_IN_REPLY), { status: 200, headers: XML })
    }
  }
  // STOP/START replies are sent by Twilio's own opt-out handling.
  return new Response(twiml(), { status: 200, headers: XML })
})
