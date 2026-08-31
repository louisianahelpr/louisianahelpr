import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { brand } from '../_shared/email-templates/styles.ts'
import { htmlEscape, timingSafeEqual } from '../_shared/safe-strings.ts'
import { FROM_DEFAULT, sendWithResend } from '../_shared/resend.ts'
import { emailButton, emailH1, emailNote, emailP, emailShell } from '../_shared/emailLayout.ts'
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

async function computeSig(uid: string, type: string, event: string): Promise<string> {
  const secret = Deno.env.get('CRON_SECRET') || ''
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

/** Open-rate beacon. Kept out of the card body so it can never take layout space. */
function trackingPixel(pixelUrl: string): string {
  return `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`
}

async function renderApprovedEmail(fullName: string, userId: string): Promise<{ html: string; text: string }> {
  const siteUrl = getAppUrl()
  const ctaUrl = await trackedLink(userId, 'account_approved', `${siteUrl}/login`)
  const pixelUrl = await trackingPixelUrl(userId, 'account_approved')
  const greetingName = getGreetingName(fullName)

  const html = emailShell({
    preheader: 'Your Helpr account is approved — you can log in now.',
    title: "You're approved.",
    body: [
      emailH1("You're approved."),
      emailP(`Hey ${greetingName},`),
      emailP(`Great news — your account has been reviewed and <strong class="e-accent" style="color:${brand.burntSienna}">approved</strong>! You now have full access to the Helpr platform.`),
      emailButton(ctaUrl, 'Log In Now', 200),
      emailNote("Welcome to the Helpr community! If you have any questions, don't hesitate to reach out to our support team."),
    ].join('\n'),
    trailing: trackingPixel(pixelUrl),
  })

  const text = `You're approved.\n\nHey ${greetingName},\n\nGreat news — your account has been reviewed and approved! You now have full access to the Helpr platform.\n\nLog in at: ${siteUrl}/login\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderVerifiedEmail(fullName: string, userId: string): Promise<{ html: string; text: string }> {
  const siteUrl = getAppUrl()
  const ctaUrl = await trackedLink(userId, 'identity_verified', `${siteUrl}/dashboard`)
  const pixelUrl = await trackingPixelUrl(userId, 'identity_verified')
  const greetingName = getGreetingName(fullName)

  const html = emailShell({
    preheader: 'Your identity check passed. Your Helpr account is ready.',
    title: 'Verification successful',
    body: [
      emailH1('Verification successful'),
      emailP(`Hey ${greetingName},`),
      emailP(`Your identity has been <strong class="e-accent" style="color:${brand.burntSienna}">verified</strong> and your Helpr account is fully approved. You're cleared to post jobs and start helping your neighbors across Louisiana.`),
      emailButton(ctaUrl, 'Go to Dashboard', 200),
      emailNote("Welcome in. You're set to post jobs and help neighbors across Louisiana."),
    ].join('\n'),
    trailing: trackingPixel(pixelUrl),
  })

  const text = `Verification successful\n\nHey ${greetingName},\n\nYour identity has been verified and your Helpr account is fully approved. You're cleared to post jobs and start helping your neighbors across Louisiana.\n\nGo to your dashboard: ${siteUrl}/dashboard\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderDeniedEmail(fullName: string, userId: string, reason?: string): Promise<{ html: string; text: string }> {
  const siteUrl = getAppUrl()
  const ctaUrl = await trackedLink(userId, 'account_denied', `${siteUrl}/login`)
  const pixelUrl = await trackingPixelUrl(userId, 'account_denied')
  const greetingName = getGreetingName(fullName)
  // `reason` is admin-supplied free text that lands in a stranger's mail
  // client. It used to be interpolated raw, so a single stray tag (or a
  // deliberate one) rendered as markup inside a Helpr-branded notice.
  const reasonText = reason
    ? emailP(`<strong>Reason:</strong> ${htmlEscape(reason)}`)
    : ''
  const reasonPlain = reason ? `\nReason: ${reason}` : ''

  const html = emailShell({
    preheader: 'An update on your Helpr account application.',
    title: 'An update on your account',
    body: [
      emailH1('An update on your account'),
      emailP(`Hey ${greetingName},`),
      emailP("We've reviewed your account application and unfortunately we're <strong>unable to approve it</strong> at this time."),
      reasonText,
      emailP('You can update your profile and resubmit for review:'),
      emailButton(ctaUrl, 'Update My Profile', 220),
      emailNote('If you believe this was a mistake, please contact our support team.'),
    ].filter(Boolean).join('\n'),
    trailing: trackingPixel(pixelUrl),
  })

  const text = `An update on your account\n\nHey ${greetingName},\n\nWe've reviewed your account application and unfortunately we're unable to approve it at this time.${reasonPlain}\n\nYou can update your profile and resubmit for review at: ${siteUrl}/login\n\nIf you believe this was a mistake, please contact our support team.`

  return { html, text }
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

    let html: string, text: string, subject: string
    if (status === 'verified') {
      ({ html, text } = await renderVerifiedEmail(profile.full_name || '', userId))
      subject = 'Your identity is verified — welcome to Louisiana Helpr'
    } else if (status === 'approved') {
      ({ html, text } = await renderApprovedEmail(profile.full_name || '', userId))
      subject = 'Your account is approved'
    } else {
      ({ html, text } = await renderDeniedEmail(profile.full_name || '', userId, reason))
      subject = 'An update on your account'
    }

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
