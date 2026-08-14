import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { brand } from '../_shared/email-templates/styles.ts'

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "louisianahelpr.com"
const FROM_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"

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

async function sendWithResend(apiKey: string, params: { to: string; from: string; subject: string; html: string; text: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error [${res.status}]: ${body}`)
  }

  return await res.json()
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

async function renderApprovedEmail(fullName: string, userId: string): Promise<{ html: string; text: string }> {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const ctaUrl = await trackedLink(userId, 'account_approved', `${siteUrl}/login`)
  const pixelUrl = await trackingPixelUrl(userId, 'account_approved')
  const greetingName = getGreetingName(fullName)

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:${brand.surface};border-radius:14px;padding:32px 28px;border:1px solid ${brand.hairline}">
  <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
  <h1 style="font-size:24px;font-weight:bold;color:${brand.inkDeep};margin:0 0 16px">You're approved.</h1>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    Hey ${greetingName},
  </p>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    Great news — your account has been reviewed and <strong style="color:${brand.burntSienna}">approved</strong>! You now have full access to the Helpr platform.
  </p>
  <a href="${ctaUrl}" style="display:inline-block;background-color:${brand.bark};color:${brand.surface};font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Log In Now
  </a>
  <p style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">
    Welcome to the Helpr community! If you have any questions, don't hesitate to reach out to our support team.
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

  const text = `You're approved.\n\nHey ${greetingName},\n\nGreat news — your account has been reviewed and approved! You now have full access to the Helpr platform.\n\nLog in at: ${siteUrl}/login\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderVerifiedEmail(fullName: string, userId: string): Promise<{ html: string; text: string }> {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const ctaUrl = await trackedLink(userId, 'identity_verified', `${siteUrl}/dashboard`)
  const pixelUrl = await trackingPixelUrl(userId, 'identity_verified')
  const greetingName = getGreetingName(fullName)

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:${brand.surface};border-radius:14px;padding:32px 28px;border:1px solid ${brand.hairline}">
  <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
  <h1 style="font-size:24px;font-weight:bold;color:${brand.inkDeep};margin:0 0 16px">Verification successful</h1>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    Hey ${greetingName},
  </p>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    Your identity has been <strong style="color:${brand.burntSienna}">verified</strong> and your Helpr account is fully approved. You're cleared to post tasks and start helping your neighbors across Louisiana.
  </p>
  <a href="${ctaUrl}" style="display:inline-block;background-color:${brand.bark};color:${brand.surface};font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Go to Dashboard
  </a>
  <p style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">
    Welcome in. You're set to post tasks and help neighbors across Louisiana.
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

  const text = `Verification successful\n\nHey ${greetingName},\n\nYour identity has been verified and your Helpr account is fully approved. You're cleared to post tasks and start helping your neighbors across Louisiana.\n\nGo to your dashboard: ${siteUrl}/dashboard\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderDeniedEmail(fullName: string, userId: string, reason?: string): Promise<{ html: string; text: string }> {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const ctaUrl = await trackedLink(userId, 'account_denied', `${siteUrl}/login`)
  const pixelUrl = await trackingPixelUrl(userId, 'account_denied')
  const greetingName = getGreetingName(fullName)
  const reasonText = reason
    ? `<p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px"><strong>Reason:</strong> ${reason}</p>`
    : ''
  const reasonPlain = reason ? `\nReason: ${reason}` : ''

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:${brand.surface};border-radius:14px;padding:32px 28px;border:1px solid ${brand.hairline}">
  <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
  <h1 style="font-size:24px;font-weight:bold;color:${brand.inkDeep};margin:0 0 16px">An update on your account</h1>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    Hey ${greetingName},
  </p>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    We've reviewed your account application and unfortunately we're <strong>unable to approve it</strong> at this time.
  </p>
  ${reasonText}
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">
    You can update your profile and resubmit for review:
  </p>
  <a href="${ctaUrl}" style="display:inline-block;background-color:${brand.bark};color:${brand.surface};font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Update My Profile
  </a>
  <p style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">
    If you believe this was a mistake, please contact our support team.
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

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

    // Allow service-role (server-to-server, e.g. stripe-idv-webhook) OR an admin JWT
    const token = authHeader.replace('Bearer ', '')
    const isServiceRole = token === serviceRoleKey

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
        from: `${SITE_NAME} <noreply@${SENDER_DOMAIN}>`,
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