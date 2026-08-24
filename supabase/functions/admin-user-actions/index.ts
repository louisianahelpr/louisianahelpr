import { createClient } from 'npm:@supabase/supabase-js@2'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
import { brand } from '../_shared/email-templates/styles.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SITE_NAME = 'Helpr'
const SENDER_DOMAIN = 'louisianahelpr.com'
const ROOT_DOMAIN = 'louisianahelpr.com'
const SITE_URL = `https://${ROOT_DOMAIN}`

type ActionType =
  | 'manual_verify'
  | 'request_id_reupload'
  | 'reset_password'
  | 'formal_warning'

async function sendEmail(apiKey: string, to: string, subject: string, html: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${SITE_NAME} <noreply@${SENDER_DOMAIN}>`,
      to: [to],
      subject,
      html,
      text,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend error [${res.status}]: ${body}`)
  }
  return res.json()
}

function wrapEmail(title: string, bodyHtml: string, ctaUrl?: string, ctaLabel?: string) {
  const cta = ctaUrl
    ? `<a href="${ctaUrl}" style="display:inline-block;background-color:${brand.bark};color:${brand.surface};font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">${ctaLabel || 'Open Helpr'}</a>`
    : ''
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:${brand.surface};border-radius:14px;padding:32px 28px;border:1px solid ${brand.hairline}">
  <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
  <h1 style="font-size:24px;font-weight:bold;color:${brand.inkDeep};margin:0 0 16px">${title}</h1>
  ${bodyHtml}
  ${cta}
  <p style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">
    Questions? Reply to this email or contact our support team at any time.
  </p>
</div>
</body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceRoleKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace('Bearer ', '')
    const supabaseUser = createClient(supabaseUrl, (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!)
    const { data: userData, error: userError } = await supabaseUser.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Distinguish "not an admin" from "couldn't check". This still fails
    // CLOSED, but a transient RPC failure now returns a truthful 503 instead of
    // telling a legitimate admin they are Forbidden.
    const { data: isAdmin, error: roleError } = await admin.rpc('has_role', { _user_id: userData.user.id, _role: 'admin' })
    if (roleError) {
      console.error('[admin-user-actions] has_role check failed:', roleError.message)
      return new Response(JSON.stringify({ error: "Couldn't verify permissions. Please retry." }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const action: ActionType = body.action
    const targetUserId: string = body.userId
    const note: string = (body.note || '').toString().slice(0, 1000)
    const reasonCategory: string = (body.reasonCategory || '').toString().slice(0, 100)
    const bypassStrike: boolean = body.bypassStrike === true

    if (!action || !targetUserId) {
      return new Response(JSON.stringify({ error: 'Missing action or userId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // NO `role`: `profiles.role` was DROPPED when accounts were unified
    // (2026-05). PostgREST 400s the whole select on an unknown column, so the
    // profileErr guard below fired on EVERY call and every admin account action
    // — ban, manual verify, formal warning, the lot — returned 500 "Could not
    // load user profile. Please try again." The value was never read anyway.
    const { data: profile, error: profileErr } = await admin.from('profiles')
      .select('full_name, email, user_id')
      .eq('user_id', targetUserId).maybeSingle()

    // A dropped error here maps a transient DB failure to "User email not found"
    // (404), hiding the real cause from admins trying to perform account actions.
    if (profileErr) {
      return new Response(JSON.stringify({ error: 'Could not load user profile. Please try again.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!profile?.email) {
      return new Response(JSON.stringify({ error: 'User email not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const fullName = profile.full_name || 'there'

    // ---- Action handlers ----
    if (action === 'manual_verify') {
      const { error: verifyErr } = await admin.from('profiles').update({
        idv_status: 'verified',
        idv_confidence: 100,
        idv_failure_reason: null,
        approval_status: 'approved',
        legacy_manual_review: true,
      } as any).eq('user_id', targetUserId)
      if (verifyErr) throw new Error(`Failed to verify user: ${verifyErr.message}`)

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'manual_verify_user',
        target_id: targetUserId,
        target_type: 'user',
        details: { note },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      await admin.from('notifications').insert({
        user_id: targetUserId,
        title: 'Manually verified',
        message: 'An admin has manually verified your identity. You have full access to Helpr.',
        type: 'success',
        link: '/dashboard',
      })

      if (resendApiKey) {
        const html = wrapEmail(
          'You\'re verified ✅',
          `<p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Hey ${fullName},</p>
           <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">An admin has personally <strong style="color:${brand.burntSienna}">verified your account</strong>. You now have full access to post or accept jobs on Helpr.</p>`,
          `${SITE_URL}/dashboard`,
          'Go to Dashboard',
        )
        const text = `Hey ${fullName},\n\nAn admin has manually verified your account. You now have full access to Helpr.\n\nGo to your dashboard: ${SITE_URL}/dashboard`
        await sendEmail(resendApiKey, profile.email, 'You\'re verified on Helpr ✅', html, text).catch((e) => console.error('email failed', e))
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'request_id_reupload') {
      const { error: reuploadErr } = await admin.from('profiles').update({
        idv_status: 'action_needed',
        idv_failure_reason: note || 'ID document was unclear. Please re-upload.',
      } as any).eq('user_id', targetUserId)
      if (reuploadErr) throw new Error(`Failed to update IDV status: ${reuploadErr.message}`)

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'request_id_reupload',
        target_id: targetUserId,
        target_type: 'user',
        details: { note },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      await admin.from('notifications').insert({
        user_id: targetUserId,
        title: 'Please re-upload your ID',
        message: note || 'Your ID photo was a bit blurry. Snap a clearer one so we can get you started.',
        type: 'warning',
        link: '/profile',
      })

      if (resendApiKey) {
        const html = wrapEmail(
          'Quick fix needed on your ID',
          `<p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Hey ${fullName},</p>
           <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Your ID photo was a bit hard to read on our end. Can you snap a clearer one so we can finish setting you up?</p>
           ${note ? `<p style="font-size:14px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px;padding:12px;border-radius:8px;background-color:hsl(45,90%,95%);border:1px solid hsl(45,80%,85%)"><strong>Admin note:</strong> ${note}</p>` : ''}`,
          `${SITE_URL}/profile`,
          'Re-upload ID',
        )
        const text = `Hey ${fullName},\n\nYour ID photo was a bit hard to read. Please re-upload a clearer one.\n${note ? `\nAdmin note: ${note}\n` : ''}\nUpdate it here: ${SITE_URL}/profile`
        await sendEmail(resendApiKey, profile.email, 'Helpr — please re-upload your ID', html, text).catch((e) => console.error('email failed', e))
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'reset_password') {
      // Generate a Supabase recovery link
      const { data: linkData, error: linkErr } = await (admin.auth.admin as any).generateLink({
        type: 'recovery',
        email: profile.email,
        options: { redirectTo: `${SITE_URL}/reset-password` },
      })
      if (linkErr) {
        return new Response(JSON.stringify({ error: linkErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const actionLink = linkData?.properties?.action_link || `${SITE_URL}/forgot-password`

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'send_password_reset',
        target_id: targetUserId,
        target_type: 'user',
        details: {},
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      if (resendApiKey) {
        const html = wrapEmail(
          'Reset your password',
          `<p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Hey ${fullName},</p>
           <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">An admin sent you a password reset link. Click the button below to choose a new password. This link expires in 1 hour.</p>`,
          actionLink,
          'Reset Password',
        )
        const text = `Hey ${fullName},\n\nReset your Helpr password using this link (expires in 1 hour):\n${actionLink}`
        await sendEmail(resendApiKey, profile.email, 'Reset your Helpr password', html, text).catch((e) => console.error('email failed', e))
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'formal_warning') {
      // 3-strike system: 1st = warning, 2nd = final warning (banner shown in app), 3rd = 7-day auto-suspension
      // Count prior strikes (warning + final_warning) to determine escalation tier
      const { count: priorStrikes } = await admin.from('user_violations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .in('action_taken', ['warning', 'final_warning'])

      // If admin chose to bypass the next strike (one-time courtesy), keep
      // strike number at the current level (still log the warning, but don't escalate).
      const effectivePriorStrikes = bypassStrike ? Math.max(0, (priorStrikes || 0) - 1) : (priorStrikes || 0)
      const strikeNumber = effectivePriorStrikes + 1
      let actionTaken: 'warning' | 'final_warning' | 'suspension' = 'warning'
      let banStatusUpdate: any = { ban_status: 'warned' }
      let notifTitle = '⚠️ Formal warning (Strike 1 of 3)'
      let notifMsg = note || 'You\'ve received a formal warning for a platform rule violation. Please review the platform rules.'
      let emailSubject = 'Helpr — Formal warning issued'
      let emailHeading = 'Formal warning (Strike 1 of 3)'
      // Backticks, not quotes: this string interpolates a brand token. As a
      // single-quoted literal the ${...} would have shipped verbatim into the
      // email body.
      let escalationHtml = `<p style="font-size:14px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">This is your <strong>1st strike</strong>. A 2nd strike will trigger a final warning banner across the app; a 3rd will result in a 7-day account suspension.</p>`

      if (strikeNumber === 2) {
        actionTaken = 'final_warning'
        banStatusUpdate = { ban_status: 'final_warning' }
        notifTitle = '🚨 Final warning (Strike 2 of 3)'
        notifMsg = (note || 'You\'ve received a final warning.') + ' One more violation will result in a 7-day suspension. A warning banner will appear at the top of your app.'
        emailSubject = 'Helpr — FINAL warning'
        emailHeading = 'Final warning (Strike 2 of 3)'
        escalationHtml = '<p style="font-size:14px;color:hsl(0,70%,45%);line-height:1.6;margin:0 0 20px;padding:12px;border-radius:8px;background-color:hsl(0,80%,97%);border:1px solid hsl(0,70%,90%)"><strong>⚠️ This is your final warning.</strong> One more violation will result in an automatic 7-day suspension. A warning banner is now visible at the top of your app.</p>'
      } else if (strikeNumber >= 3) {
        actionTaken = 'suspension'
        const suspendUntil = new Date()
        suspendUntil.setDate(suspendUntil.getDate() + 7)
        banStatusUpdate = { ban_status: 'temp_banned', auto_suspended_until: suspendUntil.toISOString() }
        notifTitle = '🚫 Account suspended for 7 days (Strike 3)'
        notifMsg = `Your account is suspended until ${suspendUntil.toLocaleDateString()}. ${note ? 'Reason: ' + note : 'You exceeded the 3-strike limit.'} Active bids have been cancelled.`
        emailSubject = 'Helpr — Account suspended (7 days)'
        emailHeading = 'Account suspended for 7 days'
        escalationHtml = `<p style="font-size:14px;color:hsl(0,70%,45%);line-height:1.6;margin:0 0 20px;padding:12px;border-radius:8px;background-color:hsl(0,80%,97%);border:1px solid hsl(0,70%,90%)"><strong>Your account has reached 3 strikes and is now suspended.</strong> Access will be restored on <strong>${suspendUntil.toLocaleDateString()}</strong>. All active bids have been cancelled.</p>`

        // Cancel all pending applications (active bids)
        await admin.from('applications').update({ status: 'rejected' } as any)
          .eq('helper_id', targetUserId).eq('status', 'pending')

        postSlackOpsAlert({
          kind: 'auto_suspended',
          severity: 'critical',
          title: 'User auto-suspended (3 strikes)',
          message: `User has been auto-suspended for 7 days after a 3rd violation.`,
          fields: {
            'User ID': targetUserId,
            'User name': fullName,
            'Suspended until': suspendUntil.toISOString().slice(0, 10),
            Reason: note?.slice(0, 200) || '—',
          },
          link: `https://www.louisianahelpr.com/admin?tab=users&user=${targetUserId}`,
        })
      }

      const violationDescription = reasonCategory
        ? `[${reasonCategory}] ${note}${bypassStrike ? ' (bypass: previous strike forgiven)' : ''}`
        : `${note}${bypassStrike ? ' (bypass: previous strike forgiven)' : ''}`
      const { error: violationErr } = await admin.from('user_violations').insert({
        user_id: targetUserId,
        violation_type: 'admin_warning',
        description: violationDescription,
        action_taken: actionTaken,
        reported_by: userData.user.id,
      })
      if (violationErr) throw new Error(`Failed to record violation: ${violationErr.message}`)
      const { error: banErr } = await admin.from('profiles').update(banStatusUpdate).eq('user_id', targetUserId)
      if (banErr) throw new Error(`Failed to apply ban status: ${banErr.message}`)

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: actionTaken === 'suspension' ? 'auto_suspend_3_strikes' : (actionTaken === 'final_warning' ? 'final_warning' : 'formal_warning'),
        target_id: targetUserId,
        target_type: 'user',
        details: { note, reason_category: reasonCategory, strike_number: strikeNumber, prior_strikes: priorStrikes || 0, bypass_strike: bypassStrike },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      await admin.from('notifications').insert({
        user_id: targetUserId,
        title: notifTitle,
        message: notifMsg,
        type: 'warning',
        link: '/rules',
      })

      if (resendApiKey) {
        const html = wrapEmail(
          emailHeading,
          `<p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Hey ${fullName},</p>
           <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">${strikeNumber >= 3 ? 'Your account has been automatically suspended due to a third platform policy violation:' : 'You\'ve received a formal warning regarding a platform policy violation:'}</p>
           ${note ? `<p style="font-size:14px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px;padding:12px;border-radius:8px;background-color:hsl(45,90%,95%);border:1px solid hsl(45,80%,85%)">${note}</p>` : ''}
           ${escalationHtml}`,
          `${SITE_URL}/rules`,
          'Review Platform Rules',
        )
        const text = `Hey ${fullName},\n\nStrike ${strikeNumber} of 3.\n${note ? `\nDetails: ${note}\n` : ''}\nReview rules: ${SITE_URL}/rules`
        await sendEmail(resendApiKey, profile.email, emailSubject, html, text).catch((e) => console.error('email failed', e))
      }
      return new Response(JSON.stringify({ success: true, strike_number: strikeNumber, action_taken: actionTaken }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('admin-user-actions error', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
