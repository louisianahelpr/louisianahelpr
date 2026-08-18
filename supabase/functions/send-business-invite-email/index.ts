// Sends a branded "you've been invited to join {business} on Helpr" email
// to a pending business_members.invited_email. The recipient signs up at
// the verified link with the prefilled email; on signup, the existing
// business-members trigger auto-claims their pending row by matching
// (lower(invited_email) = lower(profile.email)).
//
// Auth: requires an authenticated caller who is the business OWNER, checked
// against businesses.owner_id — refusing to spam emails on behalf of
// unauthorized users. See the authorization block below for why owner_id
// rather than a business_members row.
//
// NOTE: this is deliberately narrower than who may invite. As of migration
// 20260818160000 an active admin can create the pending business_members row
// via RLS, but cannot send its email through here — the invite saves and the
// UI falls back to "share this link manually". Widening this check to
// `owner OR is_business_admin(businessId, caller.id)` is the follow-up that
// makes the admin invite flow seamless.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'

const SITE_NAME = 'Helpr'
const FROM_DOMAIN = 'louisianahelpr.com'
const ROOT_DOMAIN = 'louisianahelpr.com'

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

function renderEmail(opts: { businessName: string; inviterName: string; signupUrl: string; recipientEmail: string }): { html: string; text: string } {
  const { businessName, inviterName, signupUrl, recipientEmail } = opts
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="background:#F0F2F4;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px;color:#2E2F22;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px;border:1px solid #CBCFD8;">
    <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;line-height:1.3;">You've been invited to join ${businessName}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#55656D;">
      ${inviterName} added you to the <strong style="color:#2E2F22;">${businessName}</strong> team on Helpr. Once you sign up, you'll be able to post and manage jobs on behalf of the business.
    </p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#55656D;">
      Sign up using <strong>${recipientEmail}</strong> — that's the address that matches your invite.
    </p>
    <a href="${signupUrl}" style="display:inline-block;background:#5E6544;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;font-size:15px;">Sign up + join team</a>
    <p style="font-size:12px;line-height:1.6;margin:32px 0 0;color:#6E7C83;">
      If you didn't expect this invite you can ignore it — your seat will stay pending until you sign up.
    </p>
  </div>
</body></html>`
  const text = `You've been invited to join ${businessName} on Helpr.

${inviterName} added you to the ${businessName} team. Once you sign up at ${recipientEmail}, you'll be able to post and manage jobs on behalf of the business.

Sign up + join team: ${signupUrl}

If you didn't expect this invite, you can safely ignore it.`
  return { html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) ?? ''
  const resendApiKey = Deno.env.get('RESEND_API_KEY')

  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured')
    return new Response(JSON.stringify({ error: 'Email service not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve the calling user from their JWT
  const userClient = createClient(supabaseUrl, authHeader.slice('Bearer '.length))
  const { data: userData } = await userClient.auth.getUser()
  const caller = userData?.user
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { businessId?: string; invitedEmail?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { businessId, invitedEmail } = body
  if (!businessId || !invitedEmail) {
    return new Response(JSON.stringify({ error: 'Missing businessId or invitedEmail' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // Authorization: caller must be the owner of the business.
  //
  // Authorize against businesses.owner_id, NOT business_members. owner_id is the
  // source of truth — it is what is_business_owner() reads and what the client
  // derives is_owner from. adminClient is a service-role client, so it bypasses
  // RLS: a business_members lookup here would trust a membership row on its face,
  // including one RLS should never have let the caller create for a business that
  // isn't theirs. owner_id cannot be forged: the businesses INSERT and UPDATE
  // policies both WITH CHECK (owner_id = auth.uid()).
  const { data: ownerCheck, error: ownerCheckError } = await adminClient
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_id', caller.id)
    .maybeSingle()

  if (ownerCheckError) {
    console.error('Failed to verify business ownership', ownerCheckError)
    return new Response(JSON.stringify({ error: 'Could not verify business ownership' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!ownerCheck) {
    return new Response(JSON.stringify({ error: 'Only the business owner can send invites' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Look up business name + inviter name for the email body
  const [{ data: business }, { data: inviterProfile }] = await Promise.all([
    adminClient.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    adminClient.from('profiles').select('full_name').eq('user_id', caller.id).maybeSingle(),
  ])

  const businessName = business?.name ?? 'a Helpr business'
  const inviterName = (inviterProfile?.full_name?.trim()) || 'A teammate'

  const signupUrl = `https://${ROOT_DOMAIN}/signup?invite=${encodeURIComponent(invitedEmail)}`

  const { html, text } = renderEmail({
    businessName,
    inviterName,
    signupUrl,
    recipientEmail: invitedEmail,
  })

  try {
    await sendWithResend(resendApiKey, {
      to: invitedEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      subject: `You've been invited to join ${businessName} on ${SITE_NAME}`,
      html,
      text,
    })
  } catch (err) {
    console.error('Failed to send business invite email', err)
    return new Response(JSON.stringify({ error: 'Failed to send invite email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
