import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendLovableEmail } from 'npm:@lovable.dev/email-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "notify.louisianahelpr.com"
const FROM_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"

function renderDenialReminderEmail(fullName: string, reason?: string, attemptNumber?: number): { html: string; text: string } {
  const siteUrl = `https://${ROOT_DOMAIN}`
  const reasonText = reason
    ? `<p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px"><strong>Reason:</strong> ${reason}</p>`
    : ''
  const reasonPlain = reason ? `\nReason: ${reason}` : ''

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">We'd love to have you on Helpr</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Hey ${fullName || 'there'},
  </p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">
    Just a friendly reminder — your account application wasn't approved, but you can update your profile and resubmit anytime.
  </p>
  ${reasonText}
  <a href="${siteUrl}/login" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">
    Update & Resubmit
  </a>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    If you have questions, please reach out to our support team.
  </p>
</div>
</body></html>`

  const text = `We'd love to have you on Helpr\n\nHey ${fullName || 'there'},\n\nJust a friendly reminder — your account application wasn't approved, but you can update your profile and resubmit anytime.${reasonPlain}\n\nUpdate & resubmit at: ${siteUrl}/login`

  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const apiKey = Deno.env.get('LOVABLE_API_KEY')

    // Find denied profiles where:
    // - denial_email_count < 3
    // - last_denial_email_at is more than 3 days ago
    // - approval_status is still 'denied'
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    const { data: profiles, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, user_id, full_name, email, denial_email_count, denial_reason')
      .eq('approval_status', 'denied')
      .lt('denial_email_count', 3)
      .lt('last_denial_email_at', threeDaysAgo)

    if (fetchErr) {
      console.error('Failed to fetch denied profiles:', fetchErr)
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!profiles || profiles.length === 0) {
      console.log('No denial emails to resend')
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let sentCount = 0

    for (const profile of profiles) {
      if (!profile.email) continue

      const newCount = (profile.denial_email_count || 0) + 1
      const { html, text } = renderDenialReminderEmail(
        profile.full_name || '',
        profile.denial_reason || undefined,
        newCount
      )

      const messageId = crypto.randomUUID()

      // Log pending
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'denial_reminder',
        recipient_email: profile.email,
        status: 'pending',
      })

      // Send directly using sendLovableEmail
      try {
        await sendLovableEmail(
          {
            run_id: crypto.randomUUID(),
            to: profile.email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: `Reminder: Update your Helpr profile to get approved`,
            html,
            text,
            purpose: 'transactional',
            label: 'denial_reminder',
          },
          { apiKey: apiKey || '', apiBaseUrl: Deno.env.get('LOVABLE_SEND_URL') || 'https://api.lovable.dev' }
        )

        await supabase.from('email_send_log').update({
          status: 'sent',
        }).eq('message_id', messageId)

        console.log(`Denial reminder #${newCount} sent to ${profile.email}`)
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        console.error(`Failed to send denial reminder to ${profile.email}:`, errMsg)

        await supabase.from('email_send_log').update({
          status: 'failed',
          error_message: errMsg,
        }).eq('message_id', messageId)
        continue
      }

      // Update tracking
      await supabase
        .from('profiles')
        .update({
          denial_email_count: newCount,
          last_denial_email_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

      sentCount++
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
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
