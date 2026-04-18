import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"
const SITE_URL = `https://${ROOT_DOMAIN}`
const FROM_NAME = "The Helpr Team"

// Map notification "type" values to (a) the email pref column and (b) the
// log category used for admin observability.
const TYPE_MAP: Record<string, { prefCol: string; category: string }> = {
  // New granular categories (used by triggers)
  new_offers:        { prefCol: 'email_new_offers',       category: 'new_offers' },
  transit_updates:   { prefCol: 'email_transit_updates',  category: 'transit_updates' },
  work_status:       { prefCol: 'email_work_status',      category: 'work_status' },
  financial_alerts:  { prefCol: 'email_financial_alerts', category: 'financial_alerts' },
  // Legacy
  application:       { prefCol: 'email_new_offers',       category: 'new_offers' },
  job_update:        { prefCol: 'email_work_status',      category: 'work_status' },
  job_match:         { prefCol: 'email_new_offers',       category: 'new_offers' },
  info:              { prefCol: 'email_work_status',      category: 'work_status' },
  success:           { prefCol: 'email_work_status',      category: 'work_status' },
  warning:           { prefCol: 'email_system_alerts',    category: 'system' },
  message:           { prefCol: 'email_messages',         category: 'messages' },
  payment:           { prefCol: 'email_financial_alerts', category: 'financial_alerts' },
  review:            { prefCol: 'email_reviews',          category: 'reviews' },
  promotion:         { prefCol: 'email_promotions',       category: 'promotions' },
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
  <p style="font-size:14px;color:hsl(160,8%,30%);margin:28px 0 4px">— ${FROM_NAME}</p>
  <p style="font-size:12px;color:hsl(160,6%,65%);margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    You're receiving this because you enabled email notifications on ${ROOT_DOMAIN}. Manage your preferences in your profile settings.
  </p>
</div></body></html>`

  const text = `${title}\n\nHey ${userName || 'there'},\n\n${message}\n\nView details: ${actionUrl}\n\n— ${FROM_NAME}\nManage notifications: ${SITE_URL}/profile`
  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { notification_id, user_id, title, message, type, link, job_id } = await req.json()

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const mapping = TYPE_MAP[type] || { prefCol: 'email_system_alerts', category: 'system' }
    const prefColumn = mapping.prefCol
    const category = mapping.category

    const logSkip = async (status: string, reason: string) => {
      await supabase.rpc('log_notification', {
        _user_id: user_id, _category: category, _channel: 'email',
        _status: status, _subject: title, _job_id: job_id ?? null, _error: reason, _message_id: null,
      })
    }

    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('user_id', user_id)
      .single()

    if (!prefs || !(prefs as any)[prefColumn]) {
      await logSkip('skipped', 'preference_off')
      return new Response(JSON.stringify({ skipped: true, reason: 'email_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('user_id', user_id)
      .single()

    if (!profile?.email) {
      await logSkip('skipped', 'no_email')
      return new Response(JSON.stringify({ skipped: true, reason: 'no_email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: suppressed } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', profile.email)
      .maybeSingle()

    if (suppressed) {
      await logSkip('suppressed', 'on_suppression_list')
      return new Response(JSON.stringify({ skipped: true, reason: 'suppressed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { html, text } = renderNotificationEmail(title, message, link, profile.full_name || '')
    const messageId = crypto.randomUUID()

    const emailPayload = {
      to: profile.email,
      from: `${FROM_NAME} <noreply@${SENDER_DOMAIN}>`,
      subject: title,
      html,
      text,
      message_id: messageId,
      template_name: `notification_${category}`,
    }

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: `notification_${category}`,
      recipient_email: profile.email,
      status: 'pending',
    })

    const recordLog = async (status: string, error?: string) => {
      await supabase.rpc('log_notification', {
        _user_id: user_id, _category: category, _channel: 'email',
        _status: status, _subject: title, _job_id: job_id ?? null,
        _error: error ?? null, _message_id: messageId,
      })
    }

    try {
      await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: emailPayload,
      })
      await recordLog('sent')
      console.log(`Notification email enqueued for ${profile.email}: ${title}`)
    } catch (enqueueErr) {
      const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)
      console.error('Failed to enqueue notification email, falling back to direct send:', errMsg)

      try {
        await sendWithResend(resendApiKey, {
          to: profile.email,
          from: `${FROM_NAME} <noreply@${SENDER_DOMAIN}>`,
          subject: title,
          html,
          text,
        })
        await supabase.from('email_send_log').update({ status: 'sent' }).eq('message_id', messageId)
        await recordLog('sent', 'fallback_direct')
        console.log(`Notification email sent directly to ${profile.email}: ${title}`)
      } catch (sendErr) {
        const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        console.error('Notification email failed:', sendErrMsg)
        await supabase.from('email_send_log').update({
          status: 'failed',
          error_message: sendErrMsg,
        }).eq('message_id', messageId)
        await recordLog('failed', sendErrMsg)
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
