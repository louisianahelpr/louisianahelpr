import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { sanitizeSameOriginLink, timingSafeEqual } from '../_shared/safe-strings.ts'
import { FROM_DEFAULT, sendWithResend } from '../_shared/resend.ts'
import { buildUnsubscribeUrl, unsubscribeHeaders } from '../_shared/unsubscribe.ts'
import { NotificationEmail } from '../_shared/email-templates/notification.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'
import { getAppUrl } from '../_shared/appUrl.ts'

// Map notification "type" values to (a) the email pref column and (b) the
// log category used for admin observability.
// EVERY type in `notifications_type_check`, pointed at the email twin of the
// column `notification_type_pref_map` gates PUSH with. Push and email must
// agree, and until 2026-09-03 they did not:
//
//   * FOUR types had no entry at all — `job_updates`, `expired`, `system_alert`
//     and `verified` — so they fell through to the
//     `email_system_alerts` default below. "Your job expires soon" was gated
//     by the platform-alerts switch for email and by job updates for push.
//   * FOUR more pointed at a different column than push did: `application`
//     (push job_applications / email new_offers), `job_update` and `job_match`
//     (push job_updates / email work_status), and `payment` (push payments /
//     email financial_alerts).
//
// That mattered little while `job_applications`, `job_updates`, `payments` and
// `system_alerts` had no switch on the prefs screen. Now that they do (N-005),
// a divergence here means a user flips a switch and only one of the two
// channels obeys it. `src/test/notificationTypeRegistries.test.ts` diffs this
// table against the DB map's seed rows and fails on any disagreement.
//
// No account's delivery changes by default: every email_* column involved
// DEFAULTs true, so this only takes effect for someone who has actually set a
// preference — which is the entire point.
const TYPE_MAP: Record<string, { prefCol: string; category: string }> = {
  // New granular categories (used by triggers)
  new_offers:        { prefCol: 'email_new_offers',       category: 'new_offers' },
  transit_updates:   { prefCol: 'email_transit_updates',  category: 'transit_updates' },
  work_status:       { prefCol: 'email_work_status',      category: 'work_status' },
  financial_alerts:  { prefCol: 'email_financial_alerts', category: 'financial_alerts' },
  // Legacy
  application:       { prefCol: 'email_job_applications', category: 'job_applications' },
  job_update:        { prefCol: 'email_job_updates',      category: 'job_updates' },
  job_updates:       { prefCol: 'email_job_updates',      category: 'job_updates' },
  job_match:         { prefCol: 'email_job_updates',      category: 'job_updates' },
  expired:           { prefCol: 'email_job_updates',      category: 'job_updates' },
  info:              { prefCol: 'email_work_status',      category: 'work_status' },
  success:           { prefCol: 'email_work_status',      category: 'work_status' },
  warning:           { prefCol: 'email_system_alerts',    category: 'system' },
  system_alert:      { prefCol: 'email_system_alerts',    category: 'system' },
  verified:          { prefCol: 'email_system_alerts',    category: 'system' },
  // Operator mail. Same column `warning` resolved to — the point of the type
  // is that user-facing rows stop SHARING that column, not that admins move.
  admin_alert:       { prefCol: 'email_system_alerts',    category: 'system' },
  message:           { prefCol: 'email_messages',         category: 'messages' },
  payment:           { prefCol: 'email_payments',         category: 'payments' },
  review:            { prefCol: 'email_reviews',          category: 'reviews' },
  // `promotion` is NOT a notifications.type — no CHECK value spells it, and
  // nothing inserts it. It is here for marketing mail that calls this function
  // directly with its own type string, so the registry test asserts coverage
  // of the CHECK set rather than equality with it.
  promotion:         { prefCol: 'email_promotions',       category: 'promotions' },
}

/**
 * `lexilombas05@gmail.com` -> `lexi…@gmail.com`.
 *
 * The caller (create-notification, and through it the "Send a Test" button)
 * needs to tell the user WHICH inbox to check — "Sent a test email to
 * lexi…@gmail.com" is actionable where a bare "Sent" is not. Masked rather
 * than verbatim because this string travels back out through an edge-function
 * response body that an admin caller can request for another user.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '…'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local.slice(0, Math.min(4, local.length))}…${domain}`
}

/**
 * Render the notification email.
 *
 * Both parts come from ONE react-email component: `renderEmail` produces the
 * HTML and asks react-email for the plaintext twin, so the two can never
 * drift, and every interpolated value is escaped by React rather than by a
 * hand-applied htmlEscape() call.
 *
 * `link` is a server-relative path the caller has already run through
 * sanitizeSameOriginLink.
 */
async function renderNotificationEmail(
  title: string,
  message: string,
  link: string | null,
  userName: string,
  unsubscribeUrl?: string,
): Promise<{ html: string; text: string }> {
  const siteUrl = getAppUrl()
  const actionUrl = link ? `${siteUrl}${link}` : siteUrl
  // The one link a recipient actually wants when this email is unwelcome.
  const prefsUrl = `${siteUrl}/profile?tab=notifications`

  return await renderEmail(
    React.createElement(NotificationEmail, {
      title,
      message,
      actionUrl,
      userName,
      prefsUrl,
      host: siteUrl.replace(/^https?:\/\//, ''),
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
    }),
  )
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

    // `notification_preferences` rows were created LAZILY — only when a user
    // opened Profile → Notifications and flipped something — so 85% of prod
    // accounts had none, and the check below read a missing row as "opted out
    // of everything". The measured result: not one notification email had
    // ever reached a user without a row (notification_logs, 2026-09-02 — 46
    // sent, every one to the handful of users who had a row; 6 skipped
    // `preference_off`, every one to a user who did not).
    //
    // A missing row means the user's DEFAULT preference set, not opt-out.
    // Upsert-then-read rather than a default map in TypeScript: the defaults
    // differ per column (email_messages, email_promotions and
    // email_transit_updates default FALSE, the rest TRUE) and restating them
    // here would make this the fourth place that defines them. The DB column
    // defaults stay the single source of truth. `user_id` is UNIQUE
    // (migration 20260312023604), which is what makes onConflict work.
    const { error: ensureError } = await supabase
      .from('notification_preferences')
      .upsert({ user_id }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (ensureError) {
      await logSkip('failed', `preference_row_ensure_failed: ${ensureError.message}`)
      return new Response(
        JSON.stringify({ error: 'Could not resolve notification preferences' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // maybeSingle plus an explicit error check. `.single()` reports "no row"
    // as an error and this call dropped that error, which collapsed "the user
    // opted out" and "we could not read the preference" into the same silent
    // skip. They need different outcomes.
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('user_id', user_id)
      .maybeSingle()

    if (prefsError) {
      await logSkip('failed', `preference_read_failed: ${prefsError.message}`)
      return new Response(
        JSON.stringify({ error: 'Could not read notification preferences' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!prefs || !(prefs as any)[prefColumn]) {
      await logSkip('skipped', 'preference_off')
      // `pref_column` / `category` travel back so the caller can name the exact
      // switch the user has to flip. "Email is off for Work Status" is a fix
      // the user can act on; "email_disabled" is not.
      return new Response(
        JSON.stringify({ skipped: true, reason: 'email_disabled', pref_column: prefColumn, category }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
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
    //
    // Compared lowercased because that is the only form the table ever holds:
    // `resend-webhook` lowercases every address before it upserts, and both
    // columns are plain `text`, not `citext`. Matching `profiles.email` raw
    // meant a mixed-case address never equalled its own suppression row, so
    // the guard read "not suppressed" and mailed a bounced or complained
    // recipient anyway. `engagement-automations` already lowercases both sides
    // at all four of its call sites; this was the one reader that did neither.
    const { data: suppressed, error: suppressedError } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', profile.email.toLowerCase())
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
      return new Response(
        JSON.stringify({ skipped: true, reason: 'suppressed', to: maskEmail(profile.email) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // `promotion` is the one COMMERCIAL entry in TYPE_MAP. Every other
    // notification type is transactional — a job update, a payment, a message
    // — and must never carry an unsubscribe control, because a mail client
    // will happily use one to opt a user out of their own account notices.
    //
    // A promotion, on the other hand, is commercial mail and needs the same
    // treatment as a campaign: the marketing footer with a signed one-click
    // link, and the List-Unsubscribe headers. Nothing in the repo creates a
    // `promotion` notification today, so this is a hole being closed before
    // it is used rather than a live defect.
    const isCommercial = category === 'promotions'
    const unsubscribeUrl = isCommercial
      ? ((await buildUnsubscribeUrl(profile.email)) ?? undefined)
      : undefined

    const { html, text } = await renderNotificationEmail(
      title,
      message,
      safeLink,
      profile.full_name || '',
      unsubscribeUrl,
    )
    const messageId = crypto.randomUUID()

    const emailPayload = {
      to: profile.email,
      from: FROM_DEFAULT,
      subject: title,
      html,
      text,
      message_id: messageId,
      template_name: `notification_${category}`,
      ...(isCommercial ? { headers: await unsubscribeHeaders(profile.email) } : {}),
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

    // How the mail actually left (or didn't). The old code returned a blanket
    // `{ success: true }` from BOTH the happy path and the catch below where
    // the queue AND the direct Resend send had both failed — so a caller (and
    // the "Send a Test" button behind it) was told the email was on its way
    // when recordLog had just written status='failed'. The outcome now travels
    // in the response body.
    let delivery: 'queued' | 'direct' | null = null
    let deliveryError: string | null = null

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
      delivery = 'queued'
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
          // Same headers the queued path would have carried. Without this the
          // fallback would ship a commercial promotion with the footer link
          // but no native unsubscribe control — the two paths must not differ
          // in what the recipient can do about the mail.
          ...(isCommercial ? { headers: await unsubscribeHeaders(profile.email) } : {}),
        })
        await supabase.from('email_send_log').update({ status: 'sent' }).eq('message_id', messageId)
        await recordLog('sent', 'fallback_direct')
        delivery = 'direct'
        console.log(`Notification email sent directly to ${profile.email}: ${title}`)
      } catch (sendErr) {
        const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        console.error('Notification email failed:', sendErrMsg)
        await supabase.from('email_send_log').update({
          status: 'failed',
          error_message: sendErrMsg,
        }).eq('message_id', messageId)
        await recordLog('failed', sendErrMsg)
        deliveryError = sendErrMsg
      }
    }

    if (delivery === null) {
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'send_failed',
          error: deliveryError ?? 'Email delivery failed',
          to: maskEmail(profile.email),
          message_id: messageId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ success: true, delivery, to: maskEmail(profile.email), message_id: messageId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
