import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { queueEmail, SUPPORT_EMAIL } from '../_shared/resend.ts'
import { banConfirmedMessage, banDismissedMessage, banReviewCopy } from './banReviewCopy.ts'
import { AdminActionEmail, type AdminActionCallout } from '../_shared/email-templates/admin-action.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ActionType =
  | 'manual_verify'
  | 'request_id_reupload'
  // The explicit "no" half of the manual_review queue. Deliberately lands on
  // 'failed' rather than a ban: it is a decision another admin can read, see
  // the reason for, and reverse with manual_verify or request_id_reupload,
  // because the queue lists 'failed' alongside 'manual_review'.
  | 'idv_reject'
  | 'reset_password'
  | 'formal_warning'
  | 'grant_admin'
  // Message-scanner ban review (20260825160000). The offender's own client used
  // to write the permanent ban itself; now the server flags the case
  // `pending_ban_review` and exactly one of these two admin decisions closes it.
  | 'confirm_message_ban'
  | 'dismiss_message_ban_review'

// Every admin email used to go out through a local hand-rolled Resend fetch,
// fired as `sendEmail(...).catch(console.error)`. That swallowed EVERY failure:
// the admin was shown a success, the user got nothing, and no `email_send_log`
// row existed to prove it either way. There is no local sender any more —
// `queueEmail` writes the pending log row AND enqueues, never throws, and
// returns `{ ok }` so each response below can carry an honest partial-success
// flag. The Resend API key now lives only with the queue worker
// (process-email-queue), so this function no longer reads RESEND_API_KEY at all.

// The card layout for all four emails below lives in
// `_shared/email-templates/admin-action.tsx`. It used to be a local
// `wrapEmail()` HTML-string builder here, built on
// `<div style="max-width:480px;margin:0 auto">` — which Outlook's Word engine
// cannot centre — and every call site hand-assembled its own body markup and a
// separate hand-written plaintext twin. Both parts now come from the one
// react-email component via `renderEmail`, so they cannot drift, and React
// escapes every interpolated value instead of a hand-applied htmlEscape().

/** Partial-success fields for a response whose action committed but whose email may not have queued. */
function emailStatusFields(result: { ok: boolean }) {
  return result.ok
    ? { email_sent: true }
    : { email_sent: false, email_error: 'Notification email could not be queued.' }
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

    // Canonical base URL. Was a local `SITE_URL` built from a hardcoded
    // ROOT_DOMAIN, which disagreed with the rest of the product.
    const appUrl = getAppUrl()
    // Passed straight into JSX, which escapes it — and only once, so readers
    // never see &#39; in their mail client the way a double-escaped value would.
    const fullName = profile.full_name || 'there'

    // ---- Action handlers ----
    if (action === 'grant_admin') {
      // The enforce_admin_role_grant_insert trigger on user_roles admits ONLY
      // service_role writes, so AdminSettings' old direct client insert could
      // never succeed — every "add admin" tap failed against the trigger.
      // This service-role path is the sanctioned channel; the caller was
      // already verified as an admin above.
      const { error: grantErr } = await admin.from('user_roles')
        .insert({ user_id: targetUserId, role: 'admin' })
      if (grantErr) {
        if (grantErr.code === '23505') {
          return new Response(JSON.stringify({ error: 'User is already an admin.' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`Failed to grant admin: ${grantErr.message}`)
      }

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'grant_admin_role',
        target_id: targetUserId,
        target_type: 'user',
        details: { name: profile.full_name },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

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

      const { html, text } = await renderEmail(
        React.createElement(AdminActionEmail, {
          preheader: 'An admin verified your identity — you now have full access to Helpr.',
          title: 'You\'re verified',
          greetingName: fullName,
          paragraphs: [
            [
              'An admin has personally ',
              { accent: 'verified your account' },
              '. You now have full access to post or accept jobs on Helpr.',
            ],
          ],
          ctaUrl: `${appUrl}/dashboard`,
          ctaLabel: 'Go to Dashboard',
        }),
      )
      const emailResult = await queueEmail(admin, {
        to: profile.email,
        subject: 'You\'re verified on Helpr',
        html,
        text,
        templateName: 'admin_manual_verify',
        replyTo: SUPPORT_EMAIL,
      })
      if (!emailResult.ok) console.error('[admin-user-actions] manual_verify email not queued:', emailResult.error)

      return new Response(JSON.stringify({ success: true, ...emailStatusFields(emailResult) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'idv_reject') {
      // NOT a terminal punishment. 'failed' is a readable, reversible parking
      // state — the review queue lists it beside 'manual_review' precisely so
      // another admin can pick the person back up. The reason is required by
      // the client and stored, because it is the only thing the Helpr and the
      // next admin have to go on.
      const { data: rejectRows, error: rejectErr } = await admin.from('profiles').update({
        idv_status: 'failed',
        idv_failure_reason: note || 'An admin reviewed this verification and could not approve it.',
      } as any).eq('user_id', targetUserId).select('user_id')
      if (rejectErr) throw new Error(`Failed to reject verification: ${rejectErr.message}`)
      if (!rejectRows || rejectRows.length === 0) {
        throw new Error('Failed to reject verification: no profile row matched.')
      }

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'idv_reject',
        target_id: targetUserId,
        target_type: 'user',
        details: { note },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      await admin.from('notifications').insert({
        user_id: targetUserId,
        title: 'We couldn\'t verify your ID',
        message: note || 'An admin reviewed your verification and could not approve it. Contact support if you think this is wrong.',
        type: 'warning',
        link: '/support',
      })

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'request_id_reupload') {
      // 'action_needed' was never a legal value. profiles_idv_status_check
      // allows only not_started/pending/processing/verified/failed/
      // manual_review/skipped, so every call here threw 23514 and this action
      // has been completely dead. Reconciled to 'not_started' — the state that
      // genuinely means "you may start a verification".
      //
      // The attempt counter is reset in the same write, and that is the point
      // of the action, not a bonus. claim_idv_attempt caps at ONE attempt, so
      // leaving the count alone would send the Helpr an email asking them to
      // re-upload and then refuse them with attempt_limit_reached — a second
      // dead end dressed up as a fix. An admin asking for a re-upload IS the
      // decision to grant another attempt.
      const { data: reuploadRows, error: reuploadErr } = await admin.from('profiles').update({
        idv_status: 'not_started',
        idv_attempt_count: 0,
        idv_failure_reason: note || 'ID document was unclear. Please re-upload.',
      } as any).eq('user_id', targetUserId).select('user_id')
      if (reuploadErr) throw new Error(`Failed to update IDV status: ${reuploadErr.message}`)
      if (!reuploadRows || reuploadRows.length === 0) {
        throw new Error('Failed to update IDV status: no profile row matched.')
      }

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

      const { html, text } = await renderEmail(
        React.createElement(AdminActionEmail, {
          preheader: 'Your ID photo was hard to read — please upload a clearer one.',
          title: 'Quick fix needed on your ID',
          greetingName: fullName,
          paragraphs: [
            'Your ID photo was a bit hard to read on our end. Can you snap a clearer one so we can finish setting you up?',
          ],
          // `note` is admin-authored free text landing in an HTML document. It
          // used to be interpolated raw, then hand-escaped; as a JSX child
          // React escapes it, exactly as in the formal_warning branch.
          callouts: note
            ? [{ tone: 'note' as const, body: [{ b: 'Admin note:' }, ' ', note] }]
            : [],
          ctaUrl: `${appUrl}/profile`,
          ctaLabel: 'Re-upload ID',
        }),
      )
      const emailResult = await queueEmail(admin, {
        to: profile.email,
        subject: 'Helpr — please re-upload your ID',
        html,
        text,
        templateName: 'admin_id_reupload',
        replyTo: SUPPORT_EMAIL,
      })
      if (!emailResult.ok) console.error('[admin-user-actions] request_id_reupload email not queued:', emailResult.error)

      return new Response(JSON.stringify({ success: true, ...emailStatusFields(emailResult) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'reset_password') {
      // Generate a Supabase recovery link
      const { data: linkData, error: linkErr } = await (admin.auth.admin as any).generateLink({
        type: 'recovery',
        email: profile.email,
        options: { redirectTo: `${appUrl}/reset-password` },
      })
      if (linkErr) {
        return new Response(JSON.stringify({ error: linkErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const actionLink = linkData?.properties?.action_link || `${appUrl}/forgot-password`

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: 'send_password_reset',
        target_id: targetUserId,
        target_type: 'user',
        details: {},
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      const { html, text } = await renderEmail(
        React.createElement(AdminActionEmail, {
          preheader: 'An admin sent you a password reset link — it expires in 1 hour.',
          title: 'Reset your password',
          greetingName: fullName,
          paragraphs: [
            'An admin sent you a password reset link. Click the button below to choose a new password. This link expires in 1 hour.',
          ],
          ctaUrl: actionLink,
          ctaLabel: 'Reset Password',
        }),
      )
      const emailResult = await queueEmail(admin, {
        to: profile.email,
        subject: 'Reset your Helpr password',
        html,
        text,
        templateName: 'admin_password_reset',
        replyTo: SUPPORT_EMAIL,
      })
      if (!emailResult.ok) console.error('[admin-user-actions] reset_password email not queued:', emailResult.error)

      return new Response(JSON.stringify({ success: true, ...emailStatusFields(emailResult) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'formal_warning') {
      // 3-strike system: 1st = warning, 2nd = final warning (banner shown in app), 3rd = 7-day auto-suspension
      // Count prior strikes (warning + final_warning) to determine escalation tier
      // Fail CLOSED on a read fault. The error used to be dropped, and that is
      // not a cosmetic omission: on any read failure PostgREST returns
      // `count === null`, `(priorStrikes || 0)` turns that into 0,
      // `strikeNumber` becomes 1, and a user who has earned a 3rd strike (a
      // 7-day auto-suspension) is handed "Formal warning (Strike 1 of 3)"
      // instead. The response still reports `success: true, strike_number: 1`
      // and the `admin_audit_log` row records `prior_strikes: 0`, so the audit
      // trail actively misstates what happened — the consequence ladder is
      // silently reset by a transient database blip.
      const { count: priorStrikes, error: strikeCountErr } = await admin.from('user_violations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .in('action_taken', ['warning', 'final_warning'])
      if (strikeCountErr) {
        console.error('[admin-user-actions] strike count read failed:', strikeCountErr.message)
        return new Response(
          JSON.stringify({ error: "Couldn't read this user's strike history, so the escalation tier can't be determined. Nothing was changed — please try again." }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      // If admin chose to bypass the next strike (one-time courtesy), keep
      // strike number at the current level (still log the warning, but don't escalate).
      const effectivePriorStrikes = bypassStrike ? Math.max(0, (priorStrikes || 0) - 1) : (priorStrikes || 0)
      const strikeNumber = effectivePriorStrikes + 1
      let actionTaken: 'warning' | 'final_warning' | 'suspension' = 'warning'
      let banStatusUpdate: any = { ban_status: 'warned' }
      let notifTitle = 'Formal warning (Strike 1 of 3)'
      let notifMsg = note || 'You\'ve received a formal warning for a platform rule violation. Please review the platform rules.'
      let emailSubject = 'Helpr — Formal warning issued'
      let emailHeading = 'Formal warning (Strike 1 of 3)'
      let emailPreheader = 'A formal warning has been issued on your Helpr account (strike 1 of 3).'
      // The escalation line is DATA now, not an HTML string. It used to be a
      // template literal interpolating a brand token, and HAD to be written
      // with backticks — as a single-quoted literal the ${...} shipped
      // verbatim into the email body. There is no string left to get wrong.
      let escalation: AdminActionCallout = {
        tone: 'plain',
        body: [
          'This is your ',
          { b: '1st strike' },
          '. A 2nd strike will trigger a final warning banner across the app; a 3rd will result in a 7-day account suspension.',
        ],
      }

      if (strikeNumber === 2) {
        actionTaken = 'final_warning'
        banStatusUpdate = { ban_status: 'final_warning' }
        notifTitle = 'Final warning (Strike 2 of 3)'
        notifMsg = (note || 'You\'ve received a final warning.') + ' One more violation will result in a 7-day suspension. A warning banner will appear at the top of your app.'
        emailSubject = 'Helpr — FINAL warning'
        emailHeading = 'Final warning (Strike 2 of 3)'
        emailPreheader = 'This is a final warning on your Helpr account — one more violation means a 7-day suspension.'
        escalation = {
          tone: 'alert',
          body: [
            { b: 'This is your final warning.' },
            ' One more violation will result in an automatic 7-day suspension. A warning banner is now visible at the top of your app.',
          ],
        }
      } else if (strikeNumber >= 3) {
        actionTaken = 'suspension'
        const suspendUntil = new Date()
        suspendUntil.setDate(suspendUntil.getDate() + 7)
        banStatusUpdate = { ban_status: 'temp_banned', auto_suspended_until: suspendUntil.toISOString() }
        notifTitle = 'Account suspended for 7 days (Strike 3)'
        notifMsg = `Your account is suspended until ${suspendUntil.toLocaleDateString()}. ${note ? 'Reason: ' + note : 'You exceeded the 3-strike limit.'} Active bids have been cancelled.`
        emailSubject = 'Helpr — Account suspended (7 days)'
        emailHeading = 'Account suspended for 7 days'
        emailPreheader = `Your Helpr account is suspended for 7 days after a third violation. Access returns on ${suspendUntil.toLocaleDateString()}.`
        escalation = {
          tone: 'alert',
          body: [
            { b: 'Your account has reached 3 strikes and is now suspended.' },
            ' Access will be restored on ',
            { b: suspendUntil.toLocaleDateString() },
            '. All active bids have been cancelled.',
          ],
        }

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
          // `?view=`, not `?tab=`, and `people`, not `users`. Admin.tsx:47
          // reads `searchParams.get("view")` and its `View` union (Admin.tsx:45)
          // has no `users` member — `isRealView` then bounces an unknown view
          // to home, so this alert (the one that pages someone about a 3-strike
          // auto-suspension) landed on the admin landing page and dropped the
          // `?user=` id, which AdminUsers only reads once the people view has
          // actually mounted.
          link: `${appUrl}/admin?view=people&user=${targetUserId}`,
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

      const { html, text } = await renderEmail(
        React.createElement(AdminActionEmail, {
          preheader: emailPreheader,
          title: emailHeading,
          greetingName: fullName,
          paragraphs: [
            strikeNumber >= 3
              ? 'Your account has been automatically suspended due to a third platform policy violation:'
              : 'You\'ve received a formal warning regarding a platform policy violation:',
          ],
          // `note` is admin-authored free text; React escapes it as a JSX child,
          // which is what the hand-applied htmlEscape() used to do here.
          callouts: [
            ...(note ? [{ tone: 'note' as const, body: note }] : []),
            escalation,
          ],
          ctaUrl: `${appUrl}/rules`,
          ctaLabel: 'Review Platform Rules',
        }),
      )
      const emailResult = await queueEmail(admin, {
        to: profile.email,
        subject: emailSubject,
        html,
        text,
        templateName: 'admin_formal_warning',
        replyTo: SUPPORT_EMAIL,
      })
      if (!emailResult.ok) console.error('[admin-user-actions] formal_warning email not queued:', emailResult.error)

      return new Response(JSON.stringify({
        success: true,
        strike_number: strikeNumber,
        action_taken: actionTaken,
        ...emailStatusFields(emailResult),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ---- Ban review (ALL consequence ladders) ----
    // The action names still say "message" for wire compatibility with
    // AdminBanReview.tsx, but this queue has not been message-only since
    // 20260829030000: off_platform, cancel_with_helper, job_denial and (since
    // 20260831183302) no_show all land here. Every sentence a user reads out of
    // this block therefore comes from ./banReviewCopy.ts keyed on the case's own
    // violation_type — never a hard-coded one, which is how a helper banned for
    // no-shows was told it was about messages.
    //
    // Both branches are the ONLY way such a case turns into (or
    // stops being) a ban. The caller was verified as an admin above, and every
    // decision writes an admin_audit_log row, so a permanent ban always names
    // the human who chose it — the old client path named the offender.
    if (action === 'confirm_message_ban' || action === 'dismiss_message_ban_review') {
      const violationId: string | null = body.violationId ?? null
      const confirming = action === 'confirm_message_ban'

      // What kind of case is this? Read it BEFORE anything is written, because
      // both the stored ban reason and the sentence the user is shown are
      // derived from it — and because the close step below sets action_taken,
      // after which the pending rows can no longer be found.
      //
      // Scoped exactly the way the close is scoped: one row when the client
      // named a violation (it always does), otherwise every open case for the
      // user, which is the same set the close will dispose of. If that set
      // spans more than one kind, banReviewCopy() falls back to neutral wording
      // rather than picking one of them.
      const typeQuery = admin.from('user_violations').select('violation_type')
      const { data: caseRows, error: caseErr } = violationId
        ? await typeQuery.eq('id', violationId)
        : await typeQuery.eq('user_id', targetUserId).eq('action_taken', 'pending_ban_review')
      if (caseErr) {
        // Not fatal — a decision must not fail because its label could not be
        // read. The fallback copy is vague but true.
        console.error('[admin-user-actions] could not read violation type for review copy:', caseErr.message)
      }
      const caseTypes: string[] = (caseRows ?? []).map((r: { violation_type: string }) => r.violation_type)
      const copy = banReviewCopy(caseTypes)

      if (confirming) {
        const { error: banErr } = await admin.from('user_bans').insert({
          user_id: targetUserId,
          ban_type: 'permanent',
          reason: note || copy.banReason,
          banned_by: userData.user.id,
        })
        if (banErr) throw new Error(`Failed to record ban: ${banErr.message}`)

        const { error: statusErr } = await admin.from('profiles')
          .update({ ban_status: 'permanently_banned', auto_suspended_until: null })
          .eq('user_id', targetUserId)
        if (statusErr) throw new Error(`Failed to apply ban status: ${statusErr.message}`)
      } else {
        // Dismissed: undo the reversible restriction the ladder applied. Only
        // lift a suspension that is still auto-managed — a manual admin ban
        // (auto_suspended_until IS NULL) must not be washed away by a dismissal.
        const { error: liftErr } = await admin.from('profiles')
          .update({ ban_status: 'active', auto_suspended_until: null })
          .eq('user_id', targetUserId)
          .eq('ban_status', 'temp_banned')
          .not('auto_suspended_until', 'is', null)
        if (liftErr) throw new Error(`Failed to lift restriction: ${liftErr.message}`)
      }

      // Close the queue item so it stops rendering. Scoped to the one row when
      // an id was given, otherwise every open case for this user — either way
      // re-running the same decision is a no-op, so a double-tap is harmless.
      const closeQuery = admin.from('user_violations')
        .update({ action_taken: confirming ? 'permanent_ban' : 'review_dismissed' })
        .eq('action_taken', 'pending_ban_review')
      const { error: closeErr } = violationId
        ? await closeQuery.eq('id', violationId)
        : await closeQuery.eq('user_id', targetUserId)
      if (closeErr) throw new Error(`Failed to close review: ${closeErr.message}`)

      const { error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: userData.user.id,
        action: confirming ? 'confirm_message_ban' : 'dismiss_message_ban_review',
        target_id: targetUserId,
        target_type: 'user',
        details: { note, violation_id: violationId, violation_types: caseTypes },
      })
      if (auditErr) console.error('[admin-user-actions] audit log write FAILED — privileged action has no trail:', auditErr.message)

      await admin.from('notifications').insert(
        confirming
          ? {
              user_id: targetUserId,
              title: 'Account permanently banned',
              // One sentence, built from the case's own violation type — see
              // ./banReviewCopy.ts. This used to be hard-coded to "blocked
              // messages" for every ladder feeding this queue.
              message: banConfirmedMessage(copy, SUPPORT_EMAIL),
              type: 'warning',
              link: '/account-banned',
            }
          : {
              user_id: targetUserId,
              title: 'Restriction lifted',
              // Same source of truth as the ban sentence. This used to end with
              // "Keep chats and payments on Helpr" for every ladder — messaging
              // advice handed to someone whose case was about no-shows.
              message: banDismissedMessage(copy),
              type: 'success',
              link: '/dashboard',
            },
      )

      return new Response(JSON.stringify({ success: true }), {
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
