import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { timingSafeEqual } from '../_shared/safe-strings.ts'
import { FROM_DEFAULT, sendWithResend } from '../_shared/resend.ts'
import { AccountStatusEmail } from '../_shared/email-templates/account-status.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'
import { getAppUrl } from '../_shared/appUrl.ts'

function getGreetingName(fullName?: string | null): string {
  const normalized = (fullName || '').trim()
  if (!normalized) return 'there'

  const firstName = normalized.split(/\s+/)[0]?.replace(/[^a-zA-Z'-]/g, '') || ''
  const lowered = firstName.toLowerCase()
  const blockedNames = new Set([
    'helpr',
    'admin',
    'support',
    'team',
    'user',
    'customer',
    'helper',
    'test',
  ])

  if (!firstName || firstName.length < 2 || blockedNames.has(lowered)) {
    return 'there'
  }

  return firstName
}

/**
 * The HMAC key for every tracking URL this function mints.
 *
 * NEVER fall back to '' here. `CRON_SECRET` unset used to mean the key was the
 * empty string — a value anyone can reproduce — so every "signed" pixel and
 * click link we issued was forgeable, and an attacker could mint valid
 * `email-tracking` URLs for an arbitrary uid/type/event. Fail closed instead,
 * exactly the way the verifier on the other side of these links already does
 * (`email-tracking/index.ts`: missing CRON_SECRET -> 500).
 *
 * Same class of bug as the `Bearer undefined` cron-auth bypass this repo
 * already fixed: an unset secret must never resolve to a guessable literal.
 */
function requireSigningSecret(): string {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret) {
    // Thrown, not defaulted. The handler pre-checks this and returns 500
    // before any send; this throw is the backstop for any future call path
    // that forgets to.
    throw new Error('CRON_SECRET not configured — refusing to sign tracking links')
  }
  return secret
}

async function computeSig(uid: string, type: string, event: string): Promise<string> {
  const secret = requireSigningSecret()
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${uid}:${type}:${event}`))
  const bytes = new Uint8Array(sigBuf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function trackingPixelUrl(userId: string, emailType: string): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL')!
  const sig = await computeSig(userId, emailType, 'open')
  return `${base}/functions/v1/email-tracking?uid=${userId}&type=${emailType}&event=open&sig=${sig}`
}

async function trackedLink(userId: string, emailType: string, destination: string): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL')!
  const sig = await computeSig(userId, emailType, 'click')
  return `${base}/functions/v1/email-tracking?uid=${userId}&type=${emailType}&event=click&sig=${sig}&redirect=${encodeURIComponent(destination)}`
}

/**
 * Which tracking `type` (and therefore which HMAC signature) each decision
 * uses. These strings are what `email-tracking` records, so they are part of
 * the analytics contract — do not rename them.
 */
const EMAIL_TYPE = {
  approved: 'account_approved',
  verified: 'identity_verified',
  denied: 'account_denied',
} as const

/**
 * Render an account-decision email.
 *
 * Both parts come from ONE react-email component: `renderEmail` produces the
 * HTML and asks react-email for the plaintext twin, so the two can never drift
 * — the hand-maintained plaintext bodies this replaced had already diverged
 * from their HTML counterparts. Every interpolated value is escaped by React,
 * including the admin-supplied denial `reason`, which used to be interpolated
 * raw into an HTML string (a single stray tag rendered as markup inside a
 * Helpr-branded notice) and then needed a hand-applied htmlEscape() call.
 *
 * The open-rate beacon goes to the template's `trailing` slot, outside the
 * card, so it can never take layout space.
 */
async function renderAccountStatusEmail(
  status: keyof typeof EMAIL_TYPE,
  fullName: string,
  userId: string,
  reason?: string,
): Promise<{ html: string; text: string }> {
  const siteUrl = getAppUrl()
  const emailType = EMAIL_TYPE[status]
  const destination = status === 'verified' ? `${siteUrl}/dashboard` : `${siteUrl}/login`
  const ctaUrl = await trackedLink(userId, emailType, destination)
  const pixelUrl = await trackingPixelUrl(userId, emailType)

  return await renderEmail(
    React.createElement(AccountStatusEmail, {
      status,
      greetingName: getGreetingName(fullName),
      ctaUrl,
      pixelUrl,
      reason,
    }),
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Every email this function sends embeds HMAC-signed tracking URLs. With
    // no CRON_SECRET there is no key to sign them with, so refuse the whole
    // request rather than send links signed with a publishable value. Checked
    // here, up front, so we fail before the email_send_log insert and before
    // Resend — a misconfigured deploy leaves no half-finished state behind.
    if (!Deno.env.get('CRON_SECRET')) {
      console.error('CRON_SECRET not configured — refusing to send signed tracking links')
      return new Response(JSON.stringify({ error: 'Email tracking not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceRoleKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey
    )

    // Allow service-role (server-to-server, e.g. stripe-idv-webhook) OR an admin JWT.
    // The comparison is constant-time: a plain `===` on a secret leaks its
    // matching prefix length through response timing, and this particular
    // secret is the service-role key. An unset key must never compare equal
    // to an empty bearer, hence the explicit truthiness guard.
    const token = authHeader.replace('Bearer ', '')
    const isServiceRole = !!serviceRoleKey && timingSafeEqual(token, serviceRoleKey)

    if (!isServiceRole) {
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!
      )
      const { data: userData, error: userError } = await supabaseUser.auth.getUser(token)
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
        _user_id: userData.user.id,
        _role: 'admin',
      })
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const { userId, status, reason } = await req.json()

    if (!userId || !status || !['approved', 'denied', 'verified'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', userId)
      .single()

    if (!profile?.email) {
      return new Response(JSON.stringify({ error: 'User email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const SUBJECTS: Record<string, string> = {
      verified: 'Your identity is verified — welcome to Louisiana Helpr',
      approved: 'Your account is approved',
      denied: 'An update on your account',
    }
    const subject = SUBJECTS[status as string]
    const { html, text } = await renderAccountStatusEmail(
      status as 'approved' | 'verified' | 'denied',
      profile.full_name || '',
      userId,
      status === 'denied' ? reason : undefined,
    )

    const messageId = crypto.randomUUID()

    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: `account_${status}`,
      recipient_email: profile.email,
      status: 'pending',
    })

    if (status === 'approved' || status === 'verified') {
      await supabaseAdmin.from('profiles').update({
        denial_email_count: 0,
        last_denial_email_at: null,
        denial_reason: null,
      }).eq('user_id', userId)
    }

    try {
      await sendWithResend(resendApiKey, {
        to: profile.email,
        from: FROM_DEFAULT,
        subject,
        html,
        text,
      })

      await supabaseAdmin.from('email_send_log').update({
        status: 'sent',
      }).eq('message_id', messageId)

      console.log(`Account ${status} email sent to ${profile.email}`)
    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      console.error('Email send failed:', errMsg)

      await supabaseAdmin.from('email_send_log').update({
        status: 'failed',
        error_message: errMsg,
      }).eq('message_id', messageId)

      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
