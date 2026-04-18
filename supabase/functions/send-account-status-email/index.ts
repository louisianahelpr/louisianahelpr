import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "louisianahelpr.com"
const FROM_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"

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

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">Account verified by Helpr Safety Team 🎉</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Great news — the account has been reviewed and <strong style="color:hsl(158,45%,42%)">verified by the Helpr Safety Team</strong>. Full access to the Helpr platform is now active.
  </p>
  <a href="${ctaUrl}" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Log In Now
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    Welcome to the Helpr community. Questions? Reach out to Helpr Trust & Safety any time.
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

  const text = `Account verified by Helpr Safety Team\n\nHey ${fullName || 'there'},\n\nGreat news — the account has been reviewed and verified by the Helpr Safety Team. Full access to the Helpr platform is now active.\n\nLog in at: ${siteUrl}/login\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderVerifiedEmail(fullName: string, userId: string): Promise<{ html: string; text: string }> {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const ctaUrl = await trackedLink(userId, 'identity_verified', `${siteUrl}/dashboard`)
  const pixelUrl = await trackingPixelUrl(userId, 'identity_verified')

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">Account verified by Helpr Safety Team ✅</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    The identity check is complete and the account has been <strong style="color:hsl(158,45%,42%)">verified by the Helpr Safety Team</strong>. The account is fully cleared to post tasks and help neighbors across Louisiana.
  </p>
  <a href="${ctaUrl}" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Go to Dashboard
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    Welcome to the Helpr community — geaux help out! 🌿
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

  const text = `Account verified by Helpr Safety Team\n\nHey ${fullName || 'there'},\n\nThe identity check is complete and the account has been verified by the Helpr Safety Team. The account is fully cleared to post tasks and help neighbors across Louisiana.\n\nGo to the dashboard: ${siteUrl}/dashboard\n\nWelcome to the Helpr community!`

  return { html, text }
}

async function renderDeniedEmail(fullName: string, userId: string, reason?: string, canRetry?: boolean): Promise<{ html: string; text: string }> {
  const siteUrl = `https://${ROOT_DOMAIN}`
  // Strip the internal "[reason_key] " prefix the webhook adds before showing it to the user
  const cleanReason = reason ? reason.replace(/^\[[a-z_]+\]\s*/i, '') : undefined
  const ctaPath = canRetry ? '/account-pending' : '/login'
  const ctaLabel = canRetry ? 'Try Verification Again' : 'Update My Profile'
  const ctaUrl = await trackedLink(userId, 'account_denied', `${siteUrl}${ctaPath}`)
  const pixelUrl = await trackingPixelUrl(userId, 'account_denied')
  const reasonText = cleanReason
    ? `<div style="background-color:hsl(45,100%,96%);border-left:3px solid hsl(38,92%,50%);padding:14px 16px;border-radius:8px;margin:0 0 20px"><p style="font-size:13px;color:hsl(38,80%,30%);font-weight:600;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px">Here's how to fix it</p><p style="font-size:14px;color:hsl(160,10%,12%);line-height:1.5;margin:0">${cleanReason}</p></div>`
    : ''
  const reasonPlain = cleanReason ? `\nHere's how to fix it: ${cleanReason}` : ''
  const heading = canRetry ? "Almost there — let's try again" : 'Account Update'
  const intro = canRetry
    ? "We weren't quite able to verify your identity, but it's an easy fix."
    : "We've reviewed your account application and unfortunately we're <strong>unable to approve it</strong> at this time."
  const introPlain = canRetry
    ? "We weren't quite able to verify your identity, but it's an easy fix."
    : "We've reviewed your account application and unfortunately we're unable to approve it at this time."

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">${heading}</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">${intro}</p>
  ${reasonText}
  <a href="${ctaUrl}" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    ${ctaLabel}
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    If you believe this was a mistake, please reply to this email or contact our support team.
  </p>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>
</body></html>`

  const text = `${heading}\n\nHey ${fullName || 'there'},\n\n${introPlain}${reasonPlain}\n\n${ctaLabel}: ${siteUrl}${ctaPath}\n\nIf you believe this was a mistake, please contact our support team.`

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

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
        Deno.env.get('SUPABASE_ANON_KEY')!
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

    const { userId, status, reason, canRetry } = await req.json()

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
      subject = 'Your identity is verified ✅ — welcome to Helpr!'
    } else if (status === 'approved') {
      ({ html, text } = await renderApprovedEmail(profile.full_name || '', userId))
      subject = 'Your Helpr account has been approved! 🎉'
    } else {
      ({ html, text } = await renderDeniedEmail(profile.full_name || '', userId, reason, !!canRetry))
      subject = canRetry ? "Almost there — let's try your verification again" : 'Helpr Account Update'
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

      return new Response(JSON.stringify({ error: 'Failed to send email', details: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})