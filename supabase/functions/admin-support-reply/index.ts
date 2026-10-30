import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAppUrl } from '../_shared/appUrl.ts'
import { queueEmail, SUPPORT_EMAIL } from '../_shared/resend.ts'
import { AdminActionEmail } from '../_shared/email-templates/admin-action.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
import { serve } from "../_shared/buildStamp.ts";
import { caughtMessage } from '../_shared/caughtMessage.ts'

/**
 * An admin's reply to a support ticket (owner 2026-10-23, via the lead).
 *
 * Admin Support listed each `reports` row with only Resolve / Dismiss, so the
 * owner had no way to answer the member who wrote in. This sends one reply:
 *
 *   1. records it in `support_replies` (the ticket's thread; if this write fails
 *      NOTHING is sent, so a member can never get a reply the admin cannot see);
 *   2. tells the member in the app, FIRST: a message in their "Louisiana Helpr
 *      Team" thread from the admin (admin_send_team_message as that admin; its
 *      trigger writes the bell notice), or, only if that fails, a `notifications`
 *      row linking to /support. Always the ticket's REPORTER, read from the row
 *      here and never taken from the request;
 *   3. emails the reporter's account address through queueEmail (the one email
 *      path: a pending email_send_log row, then the queue worker sends it, or logs
 *      it suppressed for a test/seed recipient);
 *   4. optionally marks the ticket resolved (pending only);
 *   5. writes admin_audit_log.
 *
 * Steps 2-5 run after the reply is recorded and each reports its own outcome in
 * the response (notified / email_queued / resolved), so the admin sees exactly
 * what reached the member instead of a blanket success.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** Same bound as the support_replies_body_length CHECK. */
const MAX_REPLY_CHARS = 4000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "[Issue Report] App freezes" -> "App freezes" (AdminSupport's subjectFromReason),
 * then one line of at most 120 characters, contact-support's own rule. A member
 * can also insert a support row straight through PostgREST, where `reason` has no
 * length or shape check, and this text goes into an email subject line
 * (lh-authz-rls review r1 #2).
 */
const subjectOf = (reason: string | null | undefined) =>
  (reason ?? '').replace(/^\[.*?\]\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 120).trim()

/** First name for the greeting, "there" when there is none. */
const greetingOf = (fullName: string | null | undefined) => {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  return first.length >= 2 ? first : 'there'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Same budget as admin-user-actions: a looping client or a stolen admin
  // session hits a wall instead of mailing a member without end.
  const rl = await checkRateLimit(req, { windowMs: 300_000, maxRequests: 30, keyPrefix: 'admin-support-reply' })
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace('Bearer ', '')
    const supabaseUser = createClient(supabaseUrl, (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!)
    const { data: userData, error: userError } = await supabaseUser.auth.getUser(token)
    if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)
    const adminId = userData.user.id

    // Fails CLOSED both ways: not an admin -> 403; could not check -> 503.
    const { data: isAdmin, error: roleError } = await admin.rpc('has_role', { _user_id: adminId, _role: 'admin' })
    if (roleError) {
      console.error('[admin-support-reply] has_role check failed:', roleError.message)
      return json({ error: "Couldn't verify permissions. Please retry." }, 503)
    }
    if (!isAdmin) return json({ error: 'Forbidden' }, 403)

    const body = await req.json().catch(() => ({}))
    const reportId = typeof body?.reportId === 'string' ? body.reportId : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const resolve = body?.resolve === true
    if (!UUID.test(reportId)) return json({ error: 'Pick a ticket to reply to.' }, 400)
    if (!message) return json({ error: 'Write a reply first.' }, 400)
    if (message.length > MAX_REPLY_CHARS) {
      return json({ error: `Keep the reply under ${MAX_REPLY_CHARS} characters.` }, 400)
    }

    // The ticket, and from it the ONE member this reply may reach.
    const { data: ticket, error: ticketError } = await admin
      .from('reports')
      .select('id, reporter_id, reported_type, reason, status')
      .eq('id', reportId)
      .maybeSingle()
    if (ticketError) {
      console.error('[admin-support-reply] ticket read failed:', ticketError.message)
      return json({ error: "Couldn't load that ticket. Nothing was sent." }, 503)
    }
    if (!ticket || ticket.reported_type !== 'support') {
      return json({ error: 'That support ticket no longer exists. Nothing was sent.' }, 404)
    }
    const memberId: string | null = ticket.reporter_id
    if (!memberId) {
      // purge_user_data() nulls reporter_id when the member deletes their account.
      return json({ error: 'This member deleted their account, so there is no one to reply to. Nothing was sent.' }, 409)
    }

    const { data: member, error: memberError } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', memberId)
      .maybeSingle()
    if (memberError) {
      console.error('[admin-support-reply] member read failed:', memberError.message)
      return json({ error: "Couldn't load the member's account. Nothing was sent." }, 503)
    }
    if (!member) {
      return json({ error: "This member's account is gone, so there is no one to reply to. Nothing was sent." }, 409)
    }

    // Only a CONFIRMED address is mailed (lh-authz-rls review r1 #1): an
    // unconfirmed account can open a ticket (contact-support is exempt from the
    // Q807 gate so a stuck member can ask for help), and its address may belong
    // to someone else. Such a member is told in the app only.
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(memberId)
    if (authUserError) {
      console.error('[admin-support-reply] member auth read failed:', authUserError.message)
      return json({ error: "Couldn't check the member's email address. Nothing was sent." }, 503)
    }
    const emailConfirmed = !!authUser?.user?.email_confirmed_at
    const mailTo: string | null = member.email && emailConfirmed ? member.email : null

    // 1. The record. Nothing goes to the member unless this lands.
    const { data: replyRows, error: replyError } = await admin
      .from('support_replies')
      .insert({ report_id: reportId, admin_id: adminId, body: message, resolved_on_send: false })
      .select('id')
    const insertedId: string | undefined = replyRows?.[0]?.id
    if (replyError || !insertedId) {
      console.error('[admin-support-reply] reply insert failed:', replyError?.message ?? '0 rows')
      return json({ error: "Couldn't save the reply. Nothing was sent; try again." }, 500)
    }
    const replyId: string = insertedId

    const subject = subjectOf(ticket.reason)

    // Every outcome is written onto the reply AS SOON AS it is known, and the
    // reply is marked outcome_recorded only at the end (lh-silent-failure review
    // r1 #1). Until then the thread reads "delivery not recorded", never "not
    // delivered": a reply that reached the member must not look undelivered, or
    // the admin sends it twice.
    let outcomeOk = true
    const recordOutcome = async (patch: Record<string, unknown>, step: string) => {
      const { data: rows, error } = await admin.from('support_replies').update(patch).eq('id', replyId).select('id')
      if (error || !rows?.length) {
        outcomeOk = false
        console.error(`[admin-support-reply] reply outcome (${step}) not recorded:`, error?.message ?? '0 rows')
      }
    }

    let notificationId: string | null = null
    let emailQueued = false
    const emailSkip: 'no_address' | 'unconfirmed' | null = !member.email ? 'no_address' : !emailConfirmed ? 'unconfirmed' : null
    let emailSkipReason: 'no_address' | 'unconfirmed' | 'not_queued' | null = emailSkip
    let resolveOutcome: 'not_requested' | 'not_attempted' | 'resolved' | 'already_closed' | 'error' | 'skipped_undelivered' =
      resolve ? 'not_attempted' : 'not_requested'
    let failedPartWay = false

    let threadMessageId: string | null = null

    try {
      // 2a. In the member's "Louisiana Helpr Team" thread, FIRST (owner
      //     2026-10-29, B61). Five replies queued 2026-10-27 dead-lettered with
      //     nothing of them in the members' Messages: the in-app half had been a
      //     bell notice to /support only. Sent through admin_send_team_message
      //     on a client carrying the ADMIN's own token, so the message's sender
      //     is the admin who wrote the reply (the RPC re-checks the admin role)
      //     and every messages trigger runs, including the notice to the member.
      //     p_client_id is the reply's id, tying the message to this reply.
      const threadText = subject && `About "${subject}":\n\n${message}`.length <= MAX_REPLY_CHARS
        ? `About "${subject}":\n\n${message}`
        : message
      const asAdmin = createClient(supabaseUrl, (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: threadRow, error: threadError } = await asAdmin.rpc('admin_send_team_message', {
        p_user_id: memberId,
        p_content: threadText,
        p_client_id: replyId,
      })
      threadMessageId = (threadRow as { id?: string } | null)?.id ?? null
      if (threadError || !threadMessageId) {
        console.error('[admin-support-reply] support-thread message not written:', threadError?.message ?? 'no row')
      } else {
        // The notice the message trigger (notify_message_recipient) wrote for it.
        const { data: threadNotice, error: threadNoticeError } = await admin
          .from('notifications')
          .select('id')
          .eq('user_id', memberId)
          .eq('link', `/messages?teamThread=${memberId}&userId=${adminId}`)
          .gte('created_at', (threadRow as { created_at?: string }).created_at ?? new Date(0).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
        if (threadNoticeError) console.error('[admin-support-reply] thread notice read failed:', threadNoticeError.message)
        notificationId = threadNotice?.[0]?.id ?? null
      }

      // 2b. The bell notice to /support, only when the thread message did not
      //     land (one notice either way). Zero rows is a real outcome: a BEFORE
      //     INSERT trigger drops the row (an identical notice in the last 10
      //     minutes, or the seed boundary), so it is reported as not delivered.
      if (!threadMessageId) {
        const { data: noticeRows, error: noticeError } = await admin
          .from('notifications')
          .insert({
            user_id: memberId,
            title: 'Helpr support replied',
            message: subject ? `About "${subject}": ${message}` : message,
            type: 'info',
            link: '/support',
          })
          .select('id')
        notificationId = noticeRows?.[0]?.id ?? null
        if (noticeError) console.error('[admin-support-reply] notification insert failed:', noticeError.message)
        else if (!notificationId) console.error('[admin-support-reply] notification insert matched 0 rows (deduplicated or seed boundary)')
      }
      if (notificationId) await recordOutcome({ notification_id: notificationId }, 'notice')

      // 3. By email, to the CONFIRMED address on the member's account (never one
      //    from the request).
      if (mailTo) {
        const appUrl = getAppUrl()
        const { html, text } = await renderEmail(
          React.createElement(AdminActionEmail, {
            preheader: subject ? `A reply about "${subject}"` : 'A reply from Helpr support',
            title: 'Helpr support replied',
            greetingName: greetingOf(member.full_name),
            paragraphs: [
              ...(subject ? [[`About your message "`, { b: subject }, `":`]] : ['About your message to Helpr support:']),
              // One paragraph per line the admin wrote, so their line breaks survive.
              ...message.split(/\n+/).map((line: string) => line.trim()).filter(Boolean),
            ],
            ctaUrl: `${appUrl}/support`,
            ctaLabel: 'Open Helpr support',
          }),
        )
        const emailResult = await queueEmail(admin, {
          to: mailTo,
          subject: subject ? `Re: ${subject}` : 'A reply from Helpr support',
          html,
          text,
          templateName: 'admin_support_reply',
          // The footer says "just reply to this email": it reaches support.
          replyTo: SUPPORT_EMAIL,
        })
        emailQueued = emailResult.ok
        if (!emailResult.ok) {
          emailSkipReason = 'not_queued'
          console.error('[admin-support-reply] email not queued:', emailResult.error)
        }
        // A failed enqueue is stored on the reply itself (r2 #3): the log row
        // queueEmail meant to mark 'failed' may not exist or may still read pending.
        await recordOutcome({
          email_message_id: emailResult.messageId ?? null,
          ...(emailResult.ok ? {} : { email_skip_reason: 'not_queued' }),
        }, 'email')
      } else {
        await recordOutcome({ email_skip_reason: emailSkip }, 'email skipped')
      }

      // 4. Resolve on send: only a pending ticket moves, and only when the reply
      //    reached the member somehow (lh-silent-failure r1 #4): a reply that
      //    reached no one must not take the member out of the Pending queue.
      if (resolve) {
        if (!threadMessageId && !notificationId && !emailQueued) {
          resolveOutcome = 'skipped_undelivered'
        } else {
          const { data: resolvedRows, error: resolveError } = await admin
            .from('reports')
            .update({ status: 'resolved' })
            .eq('id', reportId)
            .eq('status', 'pending')
            .select('id')
          if (resolveError) console.error('[admin-support-reply] resolve failed:', resolveError.message)
          resolveOutcome = resolveError ? 'error' : (resolvedRows?.length ?? 0) > 0 ? 'resolved' : 'already_closed'
        }
      }
    } catch (stepErr) {
      failedPartWay = true
      console.error('[admin-support-reply] stopped part-way after the reply was recorded:', caughtMessage(stepErr))
    } finally {
      // The outcome and the audit row are written whatever happened above.
      // Finished only when every outcome above was recorded too (r2 #1): a lost
      // notice write must not leave a row that reads "not delivered".
      await recordOutcome({ resolved_on_send: resolveOutcome === 'resolved', outcome_recorded: !failedPartWay && outcomeOk }, 'final')

      // 5. Who replied to whom, and what reached them.
      const { data: auditRows, error: auditErr } = await admin.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'support_reply',
        target_id: reportId,
        target_type: 'report',
        details: {
          reply_id: replyId, member_id: memberId, in_thread: !!threadMessageId, thread_message_id: threadMessageId,
          notified: !!notificationId, email_queued: emailQueued,
          email_skip_reason: emailSkipReason, resolve: resolveOutcome, failed_part_way: failedPartWay,
        },
      }).select('id')
      if (auditErr || !auditRows?.length) {
        const why = auditErr?.message ?? '0 rows'
        console.error('[admin-support-reply] audit log write FAILED — privileged action has no trail:', why)
        try {
          await postSlackOpsAlert({
            kind: 'custom',
            severity: 'warning',
            title: 'Admin action left no audit trail',
            message: `An admin replied to support ticket ${reportId}, but its admin_audit_log row was not written.`,
            fields: { action: 'support_reply', admin_id: adminId, reply_id: replyId, db_error: why.slice(0, 200) },
          })
        } catch (alertErr) {
          console.error('[admin-support-reply] audit-loss alert failed:', caughtMessage(alertErr))
        }
      }
    }

    if (failedPartWay) {
      return json({
        error: 'The reply was saved, but sending stopped part-way. Check the replies on this ticket before sending again.',
        reply_id: replyId,
      }, 500)
    }

    return json({
      success: true,
      reply_id: replyId,
      in_thread: !!threadMessageId,
      notified: !!notificationId,
      email_queued: emailQueued,
      has_email: !!member.email,
      email_unconfirmed: emailSkip === 'unconfirmed',
      resolve: resolveOutcome,
      resolved: resolveOutcome === 'resolved',
      outcome_recorded: outcomeOk,
    })
  } catch (err) {
    console.error('[admin-support-reply] unexpected error:', caughtMessage(err))
    return json({ error: 'Something went wrong sending the reply. Check the ticket before trying again.' }, 500)
  }
})
