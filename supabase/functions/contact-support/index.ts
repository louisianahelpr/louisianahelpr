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
//   • Every user-supplied string is length-checked and control-character
//     stripped (clean/cleanLine below) before it lands in the email template,
//     and the template escapes it: the body is a react-email component, so
//     each value is a JSX child that React escapes by construction. The old
//     hand-applied htmlEscape() calls are gone with the HTML string they
//     protected — see _shared/email-templates/support-request.tsx.
//   • The response NEVER varies on whether the submitted email belongs to an
//     existing account — the function does not look the address up at all, so
//     it cannot become an account-enumeration oracle.
//   • Honest failures: if the mail never leaves, the caller gets a non-2xx.
//     We never report "sent" for a message that went nowhere.

import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
// Sending, the From header, and the destination inbox all come from the one
// Resend module now — this function used to carry its own copy of each.
//
// SUPPORT_EMAIL is the same value the local SUPPORT_INBOX constant computed:
// `Deno.env.get('SUPPORT_INBOX_EMAIL') || 'admin@louisianahelpr.com'`. The
// address stays overridable by secret so it can move without a code change,
// and still defaults to the one published across the app (HelpCenter,
// AccountPending, ReportDialog…), so no new secret is required to deploy.
//
// FROM_CONTACT keeps the "Helpr Contact" display name for this INTERNAL relay
// only — it makes the support inbox sortable at a glance and never reaches a
// customer. It is defined in exactly one place now (_shared/resend.ts).
import { FROM_CONTACT, SUPPORT_EMAIL, sendWithResend } from '../_shared/resend.ts'
// The email itself is a react-email component now (see the note on
// renderSupportEmail below), so nothing in this file builds HTML by hand.
import { SupportRequestEmail } from '../_shared/email-templates/support-request.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'

// Mirrors SUPPORT_TOPICS in src/lib/supportTopics.ts — edge functions run on
// Deno and cannot import from src/. Change both together.
const TOPIC_LABELS: Record<string, string> = {
  message: 'Admin Message',
  suggestion: 'Suggestion',
  report: 'Issue Report',
  other: 'Other',
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

/**
 * Render the support-inbox email.
 *
 * Both parts come from ONE react-email component: `renderEmail` produces the
 * HTML and asks react-email for the plaintext twin, so the two can never
 * drift. The hand-written plaintext block that used to live here had to be
 * kept in step with the HTML by eye, and every interpolated value needed its
 * own htmlEscape() call — React escapes them now.
 */
async function renderSupportEmail(t: {
  topicLabel: string
  name: string
  email: string
  subject: string
  message: string
  accountLine: string
}): Promise<{ html: string; text: string }> {
  return await renderEmail(React.createElement(SupportRequestEmail, t))
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
    const { html, text } = await renderSupportEmail({
      topicLabel,
      name,
      email,
      subject,
      message,
      accountLine,
    })

    try {
      await sendWithResend(resendApiKey, {
        to: SUPPORT_EMAIL,
        from: FROM_CONTACT,
        subject: `[${topicLabel}] ${subject || 'No subject'} — ${name}`,
        html,
        text,
        // The footer says "Reply directly to <them>", but the envelope is
        // noreply@ — without this the support agent has to copy the address
        // out of the body by hand. `email` has already been through
        // cleanLine() + EMAIL_RE above, so no newline can reach this header.
        replyTo: email,
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
