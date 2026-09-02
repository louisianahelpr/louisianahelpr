import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { Webhook } from 'npm:standardwebhooks'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { getAppUrl } from '../_shared/appUrl.ts'
import { FROM_DEFAULT, SENDER_DOMAIN } from '../_shared/resend.ts'

// Supabase Auth "Send Email Hook" handler.
//
// This function replaces Supabase's default unbranded auth emails with
// our React Email templates branded for Helpr. Configuration:
//
//   1. Studio → Authentication → Hooks → enable "Send Email Hook"
//   2. URL: https://<project>.supabase.co/functions/v1/auth-email-hook
//   3. Generate a webhook secret (Studio shows the value once — copy it)
//   4. Set as Supabase function secret: SEND_EMAIL_HOOK_SECRET=v1,whsec_<base64>
//
// Webhook signatures use the standard-webhooks.com spec (svix-style).
// Supabase sends three headers (webhook-id, webhook-timestamp,
// webhook-signature); the standardwebhooks npm package validates them.
//
// The function parses Supabase's payload, renders the appropriate
// React Email template, and enqueues to pgmq.q_auth_emails. The
// process-email-queue cron picks up the message every 5 min and sends
// via Resend.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
}

// Map Supabase email_action_type values to template + subject.
// Supabase's full enum: signup, invite, magiclink, recovery, email_change,
// email_change_current, email_change_new, reauthentication.
const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited to Helpr",
  magiclink: 'Your Helpr login link',
  recovery: 'Reset your Helpr password',
  email_change: 'Confirm your new email',
  email_change_current: 'Email change requested',
  email_change_new: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  email_change_current: EmailChangeEmail,
  email_change_new: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Branding constants — keep in sync with the email templates.
// Sender = apex `louisianahelpr.com` (the domain Resend verified, exported as
// SENDER_DOMAIN from _shared/resend.ts). The DKIM/SPF/MX records on the
// `send.*` subdomain are infrastructure (DKIM signing, SPF authority, bounce
// handler) that prove the apex domain is authorized to send via Resend's AWS
// SES backend.
//
// The LINK host is a different question from the SENDING domain, and this file
// used to answer it locally: it built `https://www.${ROOT_DOMAIN}` while
// send-notification-email, send-account-status-email, admin-user-actions and
// engagement-automations all built apex `https://louisianahelpr.com`. Two
// hosts in the same inbox. Every link now comes from getAppUrl().
const SITE_NAME = 'Helpr'

// Sample data for the /preview endpoint (renders templates without
// signing/enqueuing — useful for visual review). The .test TLD is RFC 6761
// reserved so it can't accidentally hit a real domain.
const SAMPLE_PROJECT_URL = getAppUrl()
const SAMPLE_EMAIL = 'user@example.test'
const SAMPLE_DATA: Record<string, object> = {
  signup: { siteName: SITE_NAME, siteUrl: SAMPLE_PROJECT_URL, recipient: SAMPLE_EMAIL, confirmationUrl: SAMPLE_PROJECT_URL },
  magiclink: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  recovery: { siteName: SITE_NAME, confirmationUrl: SAMPLE_PROJECT_URL },
  invite: { siteName: SITE_NAME, siteUrl: SAMPLE_PROJECT_URL, confirmationUrl: SAMPLE_PROJECT_URL },
  email_change: { siteName: SITE_NAME, email: SAMPLE_EMAIL, newEmail: SAMPLE_EMAIL, confirmationUrl: SAMPLE_PROJECT_URL },
  reauthentication: { token: '123456' },
}

// /preview endpoint — renders a template with sample data so admins can
// visually review what the email looks like. Auth-gated by SEND_EMAIL_HOOK_SECRET
// (anyone with the hook secret is already authorized to read the templates).
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
  if (req.method === 'OPTIONS') return new Response(null, { headers: previewCorsHeaders })

  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  const authHeader = req.headers.get('Authorization')
  if (!hookSecret || authHeader !== `Bearer ${hookSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400, headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]
  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400, headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const html = await renderAsync(React.createElement(EmailTemplate, SAMPLE_DATA[type] || {}))
  return new Response(html, { status: 200, headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
}

// Main webhook handler — verifies Supabase's standard-webhooks signature,
// renders the template, enqueues to pgmq.q_auth_emails for process-email-queue
// to send via Resend.
async function handleWebhook(req: Request): Promise<Response> {
  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  if (!hookSecret) {
    console.error('SEND_EMAIL_HOOK_SECRET not configured — set it in Supabase function secrets')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Strip Supabase's "v1,whsec_" prefix if present — standardwebhooks expects
  // just the base64-encoded secret. Supabase stores the secret with the
  // prefix in Studio, but it accepts both forms when entered as the function secret.
  const secretValue = hookSecret.startsWith('v1,whsec_')
    ? hookSecret.slice('v1,whsec_'.length)
    : hookSecret.startsWith('v1,')
      ? hookSecret.slice('v1,'.length)
      : hookSecret

  // Read raw body for signature verification (don't parse JSON yet).
  const rawBody = await req.text()
  const headers = {
    'webhook-id': req.headers.get('webhook-id') || '',
    'webhook-timestamp': req.headers.get('webhook-timestamp') || '',
    'webhook-signature': req.headers.get('webhook-signature') || '',
  }

  let payload: any
  try {
    const wh = new Webhook(secretValue)
    payload = wh.verify(rawBody, headers)
  } catch (error) {
    console.error('Webhook signature verification failed', { error: error instanceof Error ? error.message : String(error) })
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Supabase "Send Email Hook" payload shape:
  //   { user: { id, email, ... }, email_data: { token, token_hash, redirect_to, email_action_type, ... } }
  const user = payload?.user
  const emailData = payload?.email_data
  if (!user?.email || !emailData?.email_action_type) {
    console.error('Webhook payload missing user.email or email_data.email_action_type', { payload })
    return new Response(JSON.stringify({ error: 'Invalid webhook payload shape' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const emailType = emailData.email_action_type as string
  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email_action_type', { emailType })
    return new Response(JSON.stringify({ error: `Unknown email type: ${emailType}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Build the verification URL Supabase expects users to follow. Per docs,
  // the format is: <site_url>/auth/v1/verify?token=<token_hash>&type=<type>&redirect_to=<redirect_to>
  // We build it on our domain so links are branded.
  const verifyUrl = new URL(`${getAppUrl()}/auth/v1/verify`)
  if (emailData.token_hash) verifyUrl.searchParams.set('token', emailData.token_hash)
  if (emailType) verifyUrl.searchParams.set('type', emailType)
  if (emailData.redirect_to) verifyUrl.searchParams.set('redirect_to', emailData.redirect_to)

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: getAppUrl(),
    recipient: user.email,
    confirmationUrl: verifyUrl.toString(),
    token: emailData.token,
    email: user.email,
    newEmail: user.new_email || emailData.new_email,
  }

  // Render React Email template to HTML + plain text
  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), { plainText: true })

  // Enqueue for async send via process-email-queue → Resend
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
  )

  const messageId = crypto.randomUUID()

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: user.email,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      message_id: messageId,
      to: user.email,
      from: FROM_DEFAULT,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: user.email,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: user.email })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // /preview path renders templates with sample data (admin debugging)
  if (url.pathname.endsWith('/preview')) return handlePreview(req)

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
