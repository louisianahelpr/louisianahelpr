// contact-support — the ONLY backend path a LOGGED-OUT visitor has to reach
// a human at Helpr.
//
// Why a new function instead of reusing something:
//   • The signed-in support form (src/components/profile/SupportInline.tsx)
//     writes straight to `public.reports`, whose RLS insert policy is
//     `TO authenticated WITH CHECK (auth.uid() = reporter_id)` and whose
//     `reporter_id` / `reported_id` are NOT NULL uuids. A guest has no uuid,
//     so that path structurally cannot serve one — and opening it to `anon`
//     would mean an unauthenticated public INSERT into a moderation table.
//   • send-notification-email is service-role-only and emails a *platform
//     user* about a notification row; send-account-status-email is admin /
//     service-role only and renders account-lifecycle copy. Neither accepts
//     an anonymous caller, and making one of them do so would have meant
//     punching an unauthenticated hole into a function that can already mail
//     arbitrary users. Rejected.
//   • slack-ops-alert takes an unauthenticated POST, but it is Slack-only —
//     no email trail, no way to reply to the person. Used here as a *second*
//     channel, not the delivery mechanism.
//
// So: this function owns exactly one job — take an untrusted, unauthenticated
// support message, validate it, and hand it to the support inbox. It holds no
// admin capability beyond that.
//
// Security posture:
//   • No auth required (config.toml sets verify_jwt = false).
//   • Rate limited per IP via _shared/rate-limit.ts — an open, unauthenticated
//     endpoint that sends mail is a spam relay without it.
//   • Every user-supplied string is length-checked and HTML-escaped
//     (_shared/safe-strings.ts) before it lands in the email template.
//   • The response NEVER varies on whether the submitted email belongs to an
//     existing account — the function does not look the address up at all, so
//     it cannot become an account-enumeration oracle.
//   • Honest failures: if the mail never leaves, the caller gets a non-2xx.
//     We never report "sent" for a message that went nowhere.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { htmlEscape } from '../_shared/safe-strings.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'

const SITE_NAME = 'Helpr'
const FROM_DOMAIN = 'louisianahelpr.com'
// Destination inbox. Overridable via secret so the address can move without a
// code change; defaults to the address already published across the app
// (HelpCenter, AccountPending, ReportDialog…), so no new secret is required
// for this function to work on first deploy.
const SUPPORT_INBOX =
  Deno.env.get('SUPPORT_INBOX_EMAIL') || 'admin@louisianahelpr.com'

// Mirrors SUPPORT_TOPICS in src/lib/supportTopics.ts — edge functions run on
// Deno and cannot import from src/. Change both together.
const TOPIC_LABELS: Record<string, string> = {
  message: 'Admin Message',
  suggestion: 'Suggestion',
  report: 'Issue Report',
  // "help" was merged into "message" in the UI (it submitted to the exact
  // same place); kept here so any in-flight/bookmarked payload still files
  // under a sensible label.
  help: 'Help Request',
}

const NAME_MIN = 2
const NAME_MAX = 100
const EMAIL_MAX = 254
const SUBJECT_MAX = 120
const MESSAGE_MIN = 10
const MESSAGE_MAX = 5000

// Deliberately permissive — the point is to reject obvious garbage and
// anything carrying whitespace/newlines (header-injection shapes), not to
// adjudicate RFC 5322. Real deliverability is Resend's problem.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Trim, strip control characters, and cap length.
 *
 * Two variants on purpose:
 *   clean()     - for the MESSAGE BODY. Keeps tab + newline; a support
 *                 message with paragraphs is normal.
 *   cleanLine() - for anything that reaches an email HEADER (topic, name,
 *                 subject). Strips tabs and newlines outright: a newline
 *                 surviving into the Resend `subject` field is the classic
 *                 header-injection shape, and no legitimate name or subject
 *                 line contains one.
 */
function clean(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''
  return input
    // C0/C1 control chars EXCEPT tab and newline, which the message body
    // legitimately contains.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, max)
}

function cleanLine(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''
  return input
    // EVERY C0/C1 control char, no exceptions - then collapse whitespace runs
    // so a padded-out value can't smuggle layout into the header either.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

async function sendWithResend(
  apiKey: string,
  params: { to: string; from: string; subject: string; html: string; text: string },
) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`Resend ${res.status}: ${body}`)
  }
}

function renderEmail(t: {
  topicLabel: string
  name: string
  email: string
  subject: string
  message: string
  accountLine: string
}): { html: string; text: string } {
  // Every interpolated value is escaped — this body is assembled from
  // untrusted, unauthenticated input.
  const name = htmlEscape(t.name)
  const email = htmlEscape(t.email)
  const subject = htmlEscape(t.subject || 'No subject')
  const topicLabel = htmlEscape(t.topicLabel)
  const accountLine = htmlEscape(t.accountLine)
  // Preserve the writer's line breaks without letting markup through.
  const messageHtml = htmlEscape(t.message).replace(/\n/g, '<br />')

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="background:#F0F2F4;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px;color:#2E2F22;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px;border:1px solid #CBCFD8;">
    <img src="https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;line-height:1.3;">[${topicLabel}] ${subject}</h1>
    <p style="font-size:13px;line-height:1.6;margin:0 0 24px;color:#6E7C83;">Submitted from the public contact form.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;font-size:14px;color:#55656D;">
      <tr><td style="padding:4px 0;width:88px;color:#6E7C83;">From</td><td style="padding:4px 0;color:#2E2F22;"><strong>${name}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6E7C83;">Email</td><td style="padding:4px 0;color:#2E2F22;">${email}</td></tr>
      <tr><td style="padding:4px 0;color:#6E7C83;">Topic</td><td style="padding:4px 0;color:#2E2F22;">${topicLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#6E7C83;">Account</td><td style="padding:4px 0;color:#2E2F22;">${accountLine}</td></tr>
    </table>

    <div style="border-top:1px solid #CBCFD8;padding-top:20px;font-size:15px;line-height:1.6;color:#2E2F22;white-space:normal;">${messageHtml}</div>

    <p style="font-size:12px;line-height:1.6;margin:28px 0 0;padding-top:16px;border-top:1px solid #CBCFD8;color:#6E7C83;">
      Reply directly to <strong>${email}</strong> to answer this person.
    </p>
  </div>
</body></html>`

  const text = `[${t.topicLabel}] ${t.subject || 'No subject'}
Submitted from the public contact form.

From:    ${t.name}
Email:   ${t.email}
Topic:   ${t.topicLabel}
Account: ${t.accountLine}

${t.message}

—
Reply directly to ${t.email} to answer this person.`

  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Unauthenticated + sends mail = spam relay unless throttled. 5 messages per
  // IP per 15 minutes is generous for a human following up on their own
  // ticket and useless for a script.
  const rl = await checkRateLimit(req, {
    windowMs: 15 * 60_000,
    maxRequests: 5,
    keyPrefix: 'contact-support',
  })
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders)

  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const topic = cleanLine(body.topic, 32)
    // hasOwnProperty, not a bare index: `topic` is attacker-controlled, and a
    // plain `TOPIC_LABELS[topic]` would happily resolve "constructor" or
    // "toString" off Object.prototype into a truthy non-string label.
    const topicLabel = Object.prototype.hasOwnProperty.call(TOPIC_LABELS, topic)
      ? TOPIC_LABELS[topic]
      : undefined
    if (!topicLabel) {
      return new Response(JSON.stringify({ error: 'Choose what your message is about.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // topic / name / email / subject all reach an email HEADER, so they go
    // through cleanLine (no newlines survive), not clean.
    let name = cleanLine(body.name, NAME_MAX)
    let email = cleanLine(body.email, EMAIL_MAX).toLowerCase()
    const subject = cleanLine(body.subject, SUBJECT_MAX)
    // Body only - paragraphs are legitimate here.
    const message = clean(body.message, MESSAGE_MAX)

    if (message.length < MESSAGE_MIN) {
      return new Response(
        JSON.stringify({ error: `Please write at least ${MESSAGE_MIN} characters so we can help.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Optional identity ────────────────────────────────────────────────
    // The web client always sends an Authorization header: a real user JWT
    // when signed in, the publishable/anon key when not. Resolving it is
    // best-effort — failure just means "treat this as a guest", never a 401.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey =
      (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    let userId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const anonClient = createClient(
          supabaseUrl,
          (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!,
        )
        const { data } = await anonClient.auth.getUser(authHeader.slice('Bearer '.length))
        if (data?.user) userId = data.user.id
      } catch {
        // Anon key / expired token / gateway hiccup — stays a guest submission.
      }
    }

    // A signed-in sender's identity comes from their profile, NOT from the
    // request body: it's the trustworthy copy, and it means the page never has
    // to ask a logged-in user to retype their own name and email.
    if (userId) {
      const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', userId)
        .maybeSingle()
      if (profileErr) {
        console.error('[contact-support] profile lookup failed', profileErr.message)
      }
      // cleanLine here too: `profiles.full_name` is itself user-supplied, so
      // it gets the same header-safety treatment as a guest's typed name.
      // Only overwrite when the profile actually has a value — a half-filled
      // profile must not blank out what the visitor typed.
      const profileName = cleanLine(profile?.full_name, NAME_MAX)
      const profileEmail = cleanLine(profile?.email, EMAIL_MAX).toLowerCase()
      if (profileName) name = profileName
      if (profileEmail) email = profileEmail
    }

    // Guests must supply both; a signed-in sender has them filled above.
    if (name.length < NAME_MIN) {
      return new Response(JSON.stringify({ error: 'Please tell us your name.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Enter a valid email address so we can reply.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      // Do NOT pretend this succeeded — a support message that silently
      // evaporates is worse than an error the visitor can act on.
      console.error('[contact-support] RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: "Support email isn't available right now. Please email admin@louisianahelpr.com." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const accountLine = userId ? `Signed in (user ${userId})` : 'Not signed in (guest)'
    const { html, text } = renderEmail({
      topicLabel,
      name,
      email,
      subject,
      message,
      accountLine,
    })

    try {
      await sendWithResend(resendApiKey, {
        to: SUPPORT_INBOX,
        from: `${SITE_NAME} Contact <noreply@${FROM_DOMAIN}>`,
        subject: `[${topicLabel}] ${subject || 'No subject'} — ${name}`,
        html,
        text,
      })
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      console.error('[contact-support] Resend send failed:', msg)
      return new Response(
        JSON.stringify({ error: "We couldn't send that just now. Please try again in a moment." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Secondary trail, both best-effort ────────────────────────────────
    // The email above is the delivery guarantee; neither of these may fail
    // the request, but both log loudly rather than swallowing.

    // Signed-in senders also get a row in the admin `reports` queue so
    // /support and the in-app Profile support tab land in the SAME place.
    // Guests cannot: reports.reporter_id is a NOT NULL user uuid.
    let reportLogged = false
    if (userId) {
      const { error: reportErr } = await admin.from('reports').insert({
        reporter_id: userId,
        reported_type: 'support',
        reported_id: userId,
        reason: `[${topicLabel}] ${subject || 'No subject'}`,
        description: `${message}\n\n(Submitted from /support)`,
      })
      if (reportErr) {
        console.error('[contact-support] reports insert failed:', reportErr.message)
      } else {
        reportLogged = true
      }
    }

    // Slack ping so an inbox nobody is watching isn't the only signal.
    // Awaited on purpose: an un-awaited fetch can be cut off when the isolate
    // is torn down after the response, and this is the alert that tells a
    // human someone needs help. postSlackOpsAlert never throws and returns
    // immediately when Slack isn't configured, so it cannot fail the request.
    await postSlackOpsAlert({
      kind: 'custom',
      severity: 'info',
      title: `Support: ${topicLabel}`,
      message: subject || message.slice(0, 200),
      fields: {
        From: name,
        Email: email,
        Account: accountLine,
        'Admin queue': userId ? (reportLogged ? 'logged' : 'INSERT FAILED — email only') : 'guest (email only)',
      },
    })

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[contact-support] unexpected error', err)
    return new Response(
      JSON.stringify({ error: "Something went wrong on our end. Please try again." }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
