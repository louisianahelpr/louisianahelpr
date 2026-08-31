import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { htmlEscape, sanitizeSameOriginLink, timingSafeEqual } from '../_shared/safe-strings.ts'
import { FROM_DEFAULT, sendWithResend } from '../_shared/resend.ts'
import { emailButton, emailH2, emailP, emailShell } from '../_shared/emailLayout.ts'
import { getAppUrl } from '../_shared/appUrl.ts'

// Sign-off used in the body copy. NOT a sender identity — the From header is
// FROM_DEFAULT ("Helpr <noreply@louisianahelpr.com>") for every email in the
// product, defined once in _shared/resend.ts.
const SIGNOFF = 'The Helpr Team'

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

function renderNotificationEmail(title: string, message: string, link: string | null, userName: string): { html: string; text: string } {
  // HTML-escape every interpolated value. The plaintext title/message/userName
  // come from upstream callers (notification triggers, edge functions) but a
  // compromised RPC, a future caller-bug, or a stored-XSS via DB row could
  // smuggle markup; escaping at the render boundary makes that a non-issue.
  // The URL is built from getAppUrl() + a server-relative link path that the
  // caller has already sanitized (sanitizeSameOriginLink) — escaped here as
  // defense-in-depth.
  const siteUrl = getAppUrl()
  const safeTitle = htmlEscape(title)
  const safeMessage = htmlEscape(message)
  const safeUser = htmlEscape(userName || 'there')
  const actionUrl = link ? `${siteUrl}${link}` : siteUrl
  const safeActionUrl = htmlEscape(actionUrl)
  // The one link a recipient actually wants when this email is unwelcome. The
  // HTML footer used to say "Manage your preferences in your profile settings"
  // with NO link at all, while the plaintext part right below it carried one —
  // so the readable version of the email was the harder one to act on.
  const prefsUrl = `${siteUrl}/profile?tab=notifications`
  const safePrefsUrl = htmlEscape(prefsUrl)
  const safeHost = htmlEscape(siteUrl.replace(/^https?:\/\//, ''))

  const html = emailShell({
    // Without a preheader every Helpr notification previewed in the inbox as
    // "Hey there," — the first words of the body.
    preheader: `${safeTitle} — open Helpr for the details.`,
    title: safeTitle,
    body: [
      emailH2(safeTitle),
      emailP(`Hey ${safeUser},`),
      emailP(safeMessage),
      emailButton(safeActionUrl, 'View Details', 190),
      emailP(`<span style="font-size:14px">— ${SIGNOFF}</span>`),
      `<p class="e-footer" style="font-size:12px;color:#6E7C83;line-height:1.6;margin:24px 0 0;padding:16px 0 0;border-top:1px solid #CBCFD8">
        You're receiving this because you enabled email notifications on ${safeHost}.
        <a class="e-footer-link" href="${safePrefsUrl}" style="color:#6E7C83;text-decoration:underline">Manage your notification preferences</a>.
      </p>`,
    ].join('\n'),
  })

  // Text body uses raw (unescaped) values — text/plain doesn't interpret HTML
  // and the only mutator is the caller, who validated lengths already.
  const text = `${title}\n\nHey ${userName || 'there'},\n\n${message}\n\nView details: ${actionUrl}\n\n— ${SIGNOFF}\nManage notifications: ${prefsUrl}`
  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Service-role-only: this endpoint sends a Helpr-branded HTML email to
    // any user_id. Before this gate any caller could POST arbitrary HTML/
    // copy and the function would deliver it as Helpr — a textbook open-
    // phishing relay. supabase/config.toml sets verify_jwt=false for this
    // function so the gateway lets the bearer token through; we then
    // require that bearer to equal SUPABASE_SERVICE_ROLE_KEY.
    const expectedSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SECRET_KEY') ?? ''
    const authHeader = req.headers.get('authorization') ?? ''
    const presentedToken = authHeader.replace(/^Bearer\s+/i, '')
    if (!expectedSecret || !timingSafeEqual(presentedToken, expectedSecret)) {
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { notification_id, user_id, title, message, type, link, job_id } = await req.json()

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sanitize link to a same-origin path. If a non-null link was provided
    // but failed validation, send the email without an action link rather
    // than failing — the email still has useful content and the bad link
    // would have produced a broken "View Details" button anyway.
    const safeLink = link == null ? null : sanitizeSameOriginLink(link)

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

    // Fail closed: `suppressed === null` must mean "confirmed not suppressed",
    // never "we could not check". Dropping the error collapsed those two into
    // the same falsy value, so a failed read sent mail to a bounced or
    // complained address — the case most likely to cost us sender reputation.
    const { data: suppressed, error: suppressedError } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', profile.email)
      .maybeSingle()

    if (suppressedError) {
      await logSkip('failed', `suppression_check_failed: ${suppressedError.message}`)
      return new Response(
        JSON.stringify({ skipped: true, reason: 'suppression_check_failed' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (suppressed) {
      await logSkip('suppressed', 'on_suppression_list')
      return new Response(JSON.stringify({ skipped: true, reason: 'suppressed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { html, text } = renderNotificationEmail(title, message, safeLink, profile.full_name || '')
    const messageId = crypto.randomUUID()

    const emailPayload = {
      to: profile.email,
      from: FROM_DEFAULT,
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
      // supabase-js `.rpc()` RESOLVES with { data, error } — it does not throw on a
      // Postgres-side failure. Without this destructure a missing queue / PGRST202 /
      // RLS denial skipped the catch below, so the direct-send fallback never ran and
      // recordLog('sent') reported a delivery that never happened. This is the
      // highest-volume email path in the product.
      const { error: enqueueError } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: emailPayload,
      })
      if (enqueueError) throw new Error(`enqueue_email failed: ${enqueueError.message}`)
      await recordLog('sent')
      console.log(`Notification email enqueued for ${profile.email}: ${title}`)
    } catch (enqueueErr) {
      const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)
      console.error('Failed to enqueue notification email, falling back to direct send:', errMsg)

      try {
        await sendWithResend(resendApiKey, {
          to: profile.email,
          from: FROM_DEFAULT,
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
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
