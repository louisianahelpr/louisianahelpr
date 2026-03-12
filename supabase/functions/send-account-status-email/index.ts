import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendLovableEmail } from 'npm:@lovable.dev/email-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "notify.louisianahelpr.com"
const FROM_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"

function renderApprovedEmail(fullName: string): { html: string; text: string } {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">You're approved! 🎉</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Great news — your account has been reviewed and <strong style="color:hsl(158,45%,42%)">approved</strong>! You now have full access to the Helpr platform.
  </p>
  <a href="${siteUrl}/login" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Log In Now
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    Welcome to the Helpr community! If you have any questions, don't hesitate to reach out to our support team.
  </p>
</div>
</body></html>`

  const text = `You're approved!\n\nHey ${fullName || 'there'},\n\nGreat news — your account has been reviewed and approved! You now have full access to the Helpr platform.\n\nLog in at: ${siteUrl}/login\n\nWelcome to the Helpr community!`

  return { html, text }
}

function renderDeniedEmail(fullName: string, reason?: string): { html: string; text: string } {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const reasonText = reason
    ? `<p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px"><strong>Reason:</strong> ${reason}</p>`
    : ''
  const reasonPlain = reason ? `\nReason: ${reason}` : ''

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">Account Update</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    We've reviewed your account application and unfortunately we're <strong>unable to approve it</strong> at this time.
  </p>
  ${reasonText}
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    You can update your profile and resubmit for review:
  </p>
  <a href="${siteUrl}/login" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Update My Profile
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    If you believe this was a mistake, please contact our support team.
  </p>
</div>
</body></html>`

  const text = `Account Update\n\nHey ${fullName || 'there'},\n\nWe've reviewed your account application and unfortunately we're unable to approve it at this time.${reasonPlain}\n\nYou can update your profile and resubmit for review at: ${siteUrl}/login\n\nIf you believe this was a mistake, please contact our support team.`

  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify the caller is an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsErr } = await supabaseUser.auth.getClaims(token)
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminId = claims.claims.sub as string

    // Verify admin role
    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: adminId,
      _role: 'admin',
    })

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { userId, status, reason } = await req.json()

    if (!userId || !status || !['approved', 'denied'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get user profile for name and email
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

    const { html, text } = status === 'approved'
      ? renderApprovedEmail(profile.full_name || '')
      : renderDeniedEmail(profile.full_name || '', reason)

    const subject = status === 'approved'
      ? 'Your Helpr account has been approved! 🎉'
      : 'Helpr Account Update'

    const messageId = crypto.randomUUID()
    const apiKey = Deno.env.get('LOVABLE_API_KEY')

    // Log pending
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: `account_${status}`,
      recipient_email: profile.email,
      status: 'pending',
    })

    // Reset denial tracking on approval
    if (status === 'approved') {
      await supabaseAdmin.from('profiles').update({
        denial_email_count: 0,
        last_denial_email_at: null,
        denial_reason: null,
      }).eq('user_id', userId)
    }

    // Send email using sendLovableEmail (transactional, no run_id needed)
    try {
      await sendLovableEmail(
        {
          to: profile.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: `account_${status}`,
        },
        { apiKey: apiKey || '', sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
      )

      // Mark as sent
      await supabaseAdmin.from('email_send_log').update({
        status: 'sent',
      }).eq('message_id', messageId)

      console.log(`Account ${status} email sent directly to ${profile.email}`)
    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      console.error('Direct email send failed, falling back to queue:', errMsg)

      // Fallback: enqueue to transactional_emails queue
      const { error: enqueueError } = await supabaseAdmin.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: profile.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: `account_${status}`,
          queued_at: new Date().toISOString(),
        },
      })

      if (enqueueError) {
        console.error('Failed to enqueue email', enqueueError)
        await supabaseAdmin.from('email_send_log').update({
          status: 'failed',
          error_message: `Direct: ${errMsg}; Queue: ${enqueueError.message}`,
        }).eq('message_id', messageId)

        return new Response(JSON.stringify({ error: 'Failed to send email' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      console.log(`Account ${status} email enqueued for ${profile.email}`)
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
