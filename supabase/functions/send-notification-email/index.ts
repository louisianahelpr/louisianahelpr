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
const SITE_URL = `https://${ROOT_DOMAIN}`

// Map notification types to preference columns
const TYPE_TO_PREF: Record<string, string> = {
  application: 'email_job_applications',
  job_update: 'email_job_updates',
  info: 'email_job_updates',
  success: 'email_job_updates',
  warning: 'email_system_alerts',
  message: 'email_messages',
  payment: 'email_payments',
  review: 'email_reviews',
  promotion: 'email_promotions',
}

function renderNotificationEmail(title: string, message: string, link: string | null, userName: string): { html: string; text: string } {
  const actionUrl = link ? `${SITE_URL}${link}` : SITE_URL
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif;margin:0;padding:0">
<div style="padding:32px 28px;max-width:480px;margin:0 auto">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:20px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 12px">${title}</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 8px">Hey ${userName || 'there'},</p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">${message}</p>
  <a href="${actionUrl}" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    View Details
  </a>
  <p style="font-size:12px;color:hsl(160,6%,65%);margin:32px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    You're receiving this because you enabled email notifications on ${ROOT_DOMAIN}. Manage your preferences in your profile settings.
  </p>
</div></body></html>`

  const text = `${title}\n\nHey ${userName || 'there'},\n\n${message}\n\nView details: ${actionUrl}\n\nManage notifications: ${SITE_URL}/profile`
  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { notification_id, user_id, title, message, type, link } = await req.json()

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check user's email notification preference for this type
    const prefColumn = TYPE_TO_PREF[type] || 'email_system_alerts'
    
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('user_id', user_id)
      .single()

    // If no prefs row or email is disabled for this type, skip
    if (!prefs || !(prefs as any)[prefColumn]) {
      return new Response(JSON.stringify({ skipped: true, reason: 'email_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get user email and name
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('user_id', user_id)
      .single()

    if (!profile?.email) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no_email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check suppression list
    const { data: suppressed } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', profile.email)
      .maybeSingle()

    if (suppressed) {
      return new Response(JSON.stringify({ skipped: true, reason: 'suppressed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { html, text } = renderNotificationEmail(title, message, link, profile.full_name || '')
    const messageId = crypto.randomUUID()

    // Log pending
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: `notification_${type}`,
      recipient_email: profile.email,
      status: 'pending',
    })

    // Send email
    try {
      await sendLovableEmail(
        {
          to: profile.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject: title,
          html,
          text,
          purpose: 'transactional',
          label: `notification_${type}`,
        },
        { apiKey: apiKey || '', sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
      )

      await supabase.from('email_send_log').update({ status: 'sent' }).eq('message_id', messageId)
      console.log(`Notification email sent to ${profile.email}: ${title}`)
    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      console.error('Notification email failed:', errMsg)

      // Fallback to queue
      await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          message_id: messageId,
          to: profile.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject: title,
          html,
          text,
          purpose: 'transactional',
          label: `notification_${type}`,
          queued_at: new Date().toISOString(),
        },
      })

      await supabase.from('email_send_log').update({
        status: 'queued',
        error_message: `Direct failed: ${errMsg}`,
      }).eq('message_id', messageId)
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