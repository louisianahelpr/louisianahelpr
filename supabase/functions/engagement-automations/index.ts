import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cronResult } from '../_shared/cron-result.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { FROM_DEFAULT } from '../_shared/resend.ts'
import { buildUnsubscribeUrl, unsubscribeHeaders } from '../_shared/unsubscribe.ts'
import { AdminDigestEmail, ApprovalReminderEmail } from '../_shared/email-templates/lifecycle.tsx'
import {
  ReEngagementEmail,
  WelcomeDripStep1Email,
  WelcomeDripStep2Email,
  WelcomeDripStep3Email,
} from '../_shared/email-templates/drip.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'

// Declared because line 163 already used it. That reference was the only one
// in the file and resolved to nothing, so the CAN-SPAM fail-closed branch —
// the one that aborts the whole send when the suppression list can't be read —
// threw a ReferenceError instead of returning its intended 503. The outer catch
// swallowed it into results.errors and the run answered HTTP 200 with
// `errors: ["corsHeaders is not defined"]`, which names nothing about
// suppression and is invisible to the cron watcher (it only sees non-2xx).
// Nothing type-checks edge functions before deploy, so this shipped.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Sender identity and every link come from ONE place now: FROM_DEFAULT in
// _shared/resend.ts and getAppUrl() in _shared/appUrl.ts. This file used to
// declare SITE_NAME = "Louisiana Helpr" — a THIRD display name, alongside
// "Helpr" and "The Helpr Team" elsewhere — plus its own SENDER_DOMAIN /
// FROM_DOMAIN and an apex SITE_URL that disagreed with auth-email-hook's www
// host, so the same product mailed people from four identities across two
// domains.

// ─── What this cron sends, and under which rules ──────────────────────
//
// The templates live in `_shared/email-templates/`; this file only supplies
// the data and decides who gets what.
//
// COMMERCIAL — welcome drip steps 1/2/3 and the "New jobs are open in your
// area." win-back (`drip.tsx`). Deleted in fa6a7898 when the business chose
// not to publish a postal address; RESTORED 2026-08-31 by owner decision with
// that gap knowingly open (see the constant note in `_shared/resend.ts`).
// Every one of them:
//   • is gated on EXPLICIT consent — `profiles.marketing_consent` (the signup
//     opt-in box) AND `notification_preferences.email_promotions`. Both reads
//     fail CLOSED. This is STRICTER than the pre-deletion code, which gated
//     drip steps 1–3 on neither: it mailed promotional content to every
//     verified approved profile, including the people who left the opt-in box
//     unticked. `marketing_consent` DEFAULTS TO FALSE (migration
//     20260708011322), so expect the drip volume to be a fraction of what it
//     was — that is the correct number, not a regression.
//   • carries `<MarketingFooter>` with the recipient's own signed one-click
//     unsubscribe link, and `List-Unsubscribe` / `List-Unsubscribe-Post`
//     headers pointing at the same link.
//
// TRANSACTIONAL — the approved-but-never-logged-in reminder. Account-status
// mail under §7702(17)(A)(iv). It carries the plain transactional footer and
// NO `List-Unsubscribe`: it is not gated on marketing consent (you should
// hear that your account was approved regardless), so advertising an opt-out
// it would then ignore would be a lie. See the note on the component.
//
// INTERNAL — the Monday admin digest. Ops mail to this platform's own
// administrators about this platform. Not commercial, not a mailing list, and
// no longer carrying an unsubscribe control that would have flipped an admin's
// own `marketing_consent` if they ever tapped Gmail's button.

interface RenderedEmail {
  subject: string
  html: string
  text: string
}

async function adminDigestEmail(stats: {
  newUsers: number
  newJobs: number
  completedJobs: number
  pendingApprovals: number
  openReports: number
  revenue: number
}): Promise<RenderedEmail> {
  const subject = `Louisiana Helpr Weekly Digest — Week of ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  // Both parts come from the one component — react-email renders the plaintext
  // twin, so the two can no longer drift.
  const { html, text } = await renderEmail(
    React.createElement(AdminDigestEmail, {
      stats,
      adminUrl: `${getAppUrl()}/admin`,
      weekOf: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    }),
  )
  return { subject, html, text }
}

/** The three welcome-drip steps, keyed by step number. */
const DRIP_STEPS = {
  1: {
    component: WelcomeDripStep1Email,
    subject: "You're in. Here's where to start on Louisiana Helpr.",
  },
  2: {
    component: WelcomeDripStep2Email,
    subject: "A quick tour of how Louisiana Helpr works.",
  },
  3: {
    component: WelcomeDripStep3Email,
    subject: "Four things great Helprs do.",
  },
} as const

// ─── Main Handler ──────────────────────────────────────────────────

/**
 * Advance a per-user send cursor and PROVE it moved.
 *
 * Every automation below is "decide from a column, send mail, write the column
 * back". The write is the only thing that stops tomorrow's run re-sending the
 * same mail to the same person — and all three of them used to be a bare
 * `await supabase.from('profiles').update(...).eq(...)` with the result thrown
 * away. Two failure modes, both silent and both indistinguishable from success:
 * a PostgREST error (supabase-js RESOLVES with `{ error }`, it never throws, so
 * no try/catch would have caught it) and a zero-row match, which returns
 * `{ data: [], error: null }`.
 *
 * The consequence is not a lost log line. The drip cursor decides
 * `drip_step === 0 && daysSinceSignup >= 1`, so a failed write re-sends the
 * same commercial drip EVERY DAY, forever. The win-back cursor is worse: its
 * eligibility window is `14 < inactive < 30 days` measured on `updated_at`,
 * which only a successful profile write advances — so a failed write re-sends
 * the same marketing email daily for sixteen consecutive days, to someone whose
 * defining characteristic is that they stopped engaging with us.
 *
 * Returns true only when exactly the intended row was written. Callers must
 * treat false as a DEFECT (it dropped work), not as an outcome.
 */
async function advanceCursor(
  supabase: { from: (t: string) => any },
  userId: string,
  patch: Record<string, unknown>,
  label: string,
  results: { errors: string[] },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select('user_id')
  if (error || (data?.length ?? 0) === 0) {
    results.errors.push(
      `${label} cursor NOT advanced for ${userId} (${error?.message ?? 'zero rows matched'}) — this send will repeat on the next run`,
    )
    return false
  }
  return true
}

Deno.serve(async (_req) => {
  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = _req.headers.get('Authorization');
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const results = { drip: 0, approvalResend: 0, reEngagement: 0, adminDigest: 0, errors: [] as string[] }

  try {
    // ─── Load suppressed emails to avoid CAN-SPAM violations ─────
    // Fail closed. `suppressedSet` is the only thing standing between this cron
    // and the addresses that bounced, complained, or unsubscribed. Dropping the
    // error meant a failed read produced an EMPTY suppression set, so every
    // drip/approval/win-back sequence below would mail the exact people we are
    // required not to mail — and would look like a normal successful run.
    //
    // This is the HARD list (bounces + spam complaints, written by
    // resend-webhook). It applies to EVERY send below, transactional included,
    // because continuing to mail a hard-bounced address is how a sending
    // domain dies. It is NOT where a commercial opt-out is recorded — that is
    // the two consent columns below, which is what keeps someone who left the
    // promo list still receiving their payout mail.
    const { data: suppressedList, error: suppressedError } = await supabase
      .from('suppressed_emails')
      .select('email')
    if (suppressedError) {
      console.error('[engagement-automations] suppression list unavailable:', suppressedError.message)
      return new Response(
        JSON.stringify({
          error: 'Suppression list unavailable — aborted before sending.',
          details: suppressedError.message,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const suppressedSet = new Set((suppressedList || []).map(s => s.email.toLowerCase()))

    // ─── Load commercial opt-outs ─────────────────────────────────
    // `notification_preferences.email_promotions = false` is the in-app
    // Promotions toggle AND what `email-unsubscribe` writes on a one-click
    // opt-out. Only the COMMERCIAL loops consult it.
    //
    // Fail closed for the same reason the suppression read does: a dropped
    // error here yields an EMPTY opt-out set, and every person who
    // unsubscribed gets the next drip step. An unsent campaign is retryable;
    // one sent to people who opted out is not.
    const { data: promoPrefs, error: promoPrefsError } = await supabase
      .from('notification_preferences')
      .select('user_id, email_promotions')
    if (promoPrefsError) {
      console.error('[engagement-automations] promo opt-out list unavailable:', promoPrefsError.message)
      return new Response(
        JSON.stringify({
          error: 'Email preference list unavailable — aborted before sending.',
          details: promoPrefsError.message,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const promoOptedOut = new Set(
      (promoPrefs || []).filter((p) => p.email_promotions === false).map((p) => p.user_id),
    )

    const now = new Date()
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

    /**
     * Enqueue one COMMERCIAL email.
     *
     * The unsubscribe URL is built per recipient and used TWICE — inside the
     * footer and in the `List-Unsubscribe` headers — so the native Gmail /
     * Apple Mail control and the visible link land on the same handler and
     * have the same effect.
     */
    const queueCommercial = async (
      user: { user_id: string; email: string; full_name: string | null },
      element: (unsubscribeUrl: string) => unknown,
      subject: string,
      label: string,
    ): Promise<string | null> => {
      const unsubscribeUrl =
        (await buildUnsubscribeUrl(user.email)) ?? `${getAppUrl()}/profile?tab=notifications`
      const { html, text } = await renderEmail(element(unsubscribeUrl))
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: label,
        recipient_email: user.email,
        status: 'pending',
      })

      // `.rpc()` RESOLVES { data, error }; it does not throw. Without the
      // destructure a failed enqueue would still bump the counter and advance
      // the drip step, so the recipient would silently skip a step forever.
      const { error: enqueueErr } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: user.email,
          from: FROM_DEFAULT,
          subject,
          html,
          text,
          // Advisory marker on the queue payload — nothing reads it today, but
          // it is the one place a queued message says which body of rules it
          // was sent under.
          purpose: 'commercial',
          headers: await unsubscribeHeaders(user.email),
          label,
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        await supabase
          .from('email_send_log')
          .update({ status: 'failed', error_message: `enqueue_email: ${enqueueErr.message}`.slice(0, 1000) })
          .eq('message_id', messageId)
        return enqueueErr.message
      }
      return null
    }

    // ─── 1. Welcome Drip Sequence (COMMERCIAL) ────────────────────
    const { data: dripUsers, error: dripUsersError } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, drip_step, last_drip_at, created_at')
      .lt('drip_step', 3)
      .not('email', 'is', null)
      // Automated lifecycle mail previously went to EVERY profile with an
      // address — including unverified addresses and accounts an admin had
      // denied. send-marketing-blast already gated on these two columns; the
      // cron loops did not.
      .eq('email_verified', true)
      .eq('approval_status', 'approved')
      // The signup opt-in. NEW versus the pre-deletion code, which gated the
      // drip on nothing of the sort — see the header note.
      .eq('marketing_consent', true)
    if (dripUsersError) {
      // Fail closed rather than treating a read failure as "nobody qualifies":
      // a silent empty result here is indistinguishable from a working run.
      results.errors.push(`drip recipient query failed: ${dripUsersError.message}`)
    }

    for (const user of dripUsers || []) {
      if (suppressedSet.has((user.email || '').toLowerCase())) continue
      if (promoOptedOut.has(user.user_id)) continue

      const signupDate = new Date(user.created_at)
      const daysSinceSignup = (now.getTime() - signupDate.getTime()) / (1000 * 60 * 60 * 24)

      // Which step is due, from days since signup.
      let targetStep: 1 | 2 | 3 | -1 = -1
      if (user.drip_step === 0 && daysSinceSignup >= 1) targetStep = 1
      else if (user.drip_step === 1 && daysSinceSignup >= 3) targetStep = 2
      else if (user.drip_step === 2 && daysSinceSignup >= 7) targetStep = 3

      if (targetStep === -1) continue

      // Never more than one drip email per day.
      if (user.last_drip_at) {
        const hoursSinceLastDrip = (now.getTime() - new Date(user.last_drip_at).getTime()) / (1000 * 60 * 60)
        if (hoursSinceLastDrip < 20) continue
      }

      const step = DRIP_STEPS[targetStep]
      const failure = await queueCommercial(
        user,
        (unsubscribeUrl) =>
          React.createElement(step.component, {
            greetingName: user.full_name || '',
            dashboardUrl: `${getAppUrl()}/dashboard`,
            unsubscribeUrl,
          }),
        step.subject,
        `welcome_drip_step_${targetStep}`,
      )

      if (failure) {
        results.errors.push(`Drip failed for ${user.email}: ${failure}`)
        continue
      }

      const dripAdvanced = await advanceCursor(
        supabase,
        user.user_id,
        { drip_step: targetStep, last_drip_at: now.toISOString() },
        'drip',
        results,
      )
      if (!dripAdvanced) continue

      results.drip++
    }

    // ─── 1b. Auto-resend Approval Emails (TRANSACTIONAL) ─────────
    // Approved users who haven't logged in, resend every 3 days up to 3 emails total
    // Only target users approved within the last 14 days — long-approved users
    // should never receive "your account is approved" reminders, even if their
    // counter was bumped manually or by a backfill.
    //
    // Deliberately NOT gated on marketing_consent / email_promotions: this is
    // account-status mail. It correspondingly carries no unsubscribe control.
    const { data: approvedUsers } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, approval_email_count, last_approval_email_at, created_at')
      .eq('approval_status', 'approved')
      .lt('approval_email_count', 3)
      .gte('created_at', fourteenDaysAgo)
      .not('email', 'is', null)
      .eq('email_verified', true)

    for (const user of approvedUsers || []) {
      // Skip suppressed emails
      if (suppressedSet.has((user.email || '').toLowerCase())) continue

      const emailCount = user.approval_email_count || 0
      if (emailCount < 1) continue // First email sent on approval, skip if 0

      // Check if 3+ days since last approval email
      if (user.last_approval_email_at) {
        const daysSinceLast = (now.getTime() - new Date(user.last_approval_email_at).getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceLast < 3) continue
      }

      // Check if user has any activity (jobs, messages, recent profile update)
      const [jobsRes, msgsRes] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('customer_id', user.user_id),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', user.user_id),
      ])

      // If user has posted jobs or sent messages, they're active — stop resending
      if ((jobsRes.count || 0) > 0 || (msgsRes.count || 0) > 0) {
        await supabase.from('profiles').update({ approval_email_count: 3 }).eq('user_id', user.user_id)
        continue
      }

      const subject = "Your Louisiana Helpr account is approved — ready when you are."

      const { html: htmlContent, text: textContent } = await renderEmail(
        React.createElement(ApprovalReminderEmail, {
          greetingName: user.full_name || "",
          dashboardUrl: `${getAppUrl()}/dashboard`,
          prefsUrl: `${getAppUrl()}/profile?tab=notifications`,
        }),
      )

      const messageId = crypto.randomUUID()
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'approval_reminder',
        recipient_email: user.email,
        status: 'pending',
      })

      const { error: enqueueErr } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: user.email,
          from: FROM_DEFAULT,
          subject,
          html: htmlContent,
          text: textContent,
          purpose: 'transactional',
          // No List-Unsubscribe: transactional mail must never offer an
          // opt-out control, because a mail client will happily use it to
          // "unsubscribe" someone from their own account notices.
          label: 'approval_reminder',
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        results.errors.push(`Approval resend failed for ${user.email}: ${enqueueErr.message}`)
        continue
      }

      const approvalAdvanced = await advanceCursor(
        supabase,
        user.user_id,
        {
          approval_email_count: emailCount + 1,
          last_approval_email_at: now.toISOString(),
        },
        'approval-resend',
        results,
      )
      if (!approvalAdvanced) continue

      results.approvalResend++
    }

    // ─── 2. Re-engagement Nudges (COMMERCIAL) ─────────────────────
    // Users inactive for 14+ days (no job posted, no message, no login update)
    // who finished the drip (step >= 3), so the two sequences never overlap.
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: inactiveUsers, error: inactiveUsersError } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, last_drip_at')
      .lt('updated_at', fourteenDaysAgo)
      .gt('updated_at', thirtyDaysAgo) // Don't nudge very old inactive accounts
      .gte('drip_step', 3)
      .not('email', 'is', null)
      // "New jobs are open in your area." is unambiguously promotional, so it
      // requires the signup marketing opt-in and a verified address.
      .eq('email_verified', true)
      .eq('marketing_consent', true)
    if (inactiveUsersError) {
      results.errors.push(`win-back recipient query failed: ${inactiveUsersError.message}`)
    }

    for (const user of inactiveUsers || []) {
      if (suppressedSet.has((user.email || '').toLowerCase())) continue
      if (promoOptedOut.has(user.user_id)) continue

      // Only send re-engagement once every 14 days
      if (user.last_drip_at) {
        const daysSinceLastEmail = (now.getTime() - new Date(user.last_drip_at).getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceLastEmail < 14) continue
      }

      const failure = await queueCommercial(
        user,
        (unsubscribeUrl) =>
          React.createElement(ReEngagementEmail, {
            greetingName: user.full_name || '',
            dashboardUrl: `${getAppUrl()}/dashboard`,
            unsubscribeUrl,
          }),
        'New jobs are open in your area.',
        're_engagement',
      )

      if (failure) {
        results.errors.push(`Re-engagement failed for ${user.email}: ${failure}`)
        continue
      }

      // Update last_drip_at to track when we last emailed them
      const winBackAdvanced = await advanceCursor(
        supabase,
        user.user_id,
        { last_drip_at: now.toISOString() },
        're-engagement',
        results,
      )
      if (!winBackAdvanced) continue

      results.reEngagement++
    }

    // ─── 3. Admin Weekly Digest (INTERNAL, Monday mornings only) ──
    const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon
    if (dayOfWeek !== 1) {
      console.log('Skipping admin digest — not Monday')
    } else {
    const yesterday = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() // last 7 days

    const [newUsersRes, newJobsRes, completedJobsRes, pendingRes, reportsRes, revenueRes, adminRolesRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', yesterday),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select('platform_fee_amount').eq('status', 'completed').gte('updated_at', yesterday),
      supabase.from('user_roles').select('user_id').eq('role', 'admin'),
    ])

    const revenue = (revenueRes.data || []).reduce((sum, j) => sum + (j.platform_fee_amount || 0), 0)

    const stats = {
      newUsers: newUsersRes.count || 0,
      newJobs: newJobsRes.count || 0,
      completedJobs: completedJobsRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      revenue,
    }

    // Send digest to all admins
    for (const adminRole of adminRolesRes.data || []) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', adminRole.user_id)
        .single()

      if (!adminProfile?.email) continue

      const { subject, html, text } = await adminDigestEmail(stats)
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'admin_weekly_digest',
        recipient_email: adminProfile.email,
        status: 'pending',
      })

      // `.rpc()` resolves { data, error } rather than throwing — without the
      // destructure a failed enqueue still incremented results.adminDigest and
      // left the email_send_log row stuck on 'pending' with no error recorded.
      const { error: digestEnqueueError } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: adminProfile.email,
          from: FROM_DEFAULT,
          subject,
          html,
          text,
          purpose: 'internal',
          // No List-Unsubscribe. It used to carry one, which meant a stray tap
          // on Gmail's native control would have set marketing_consent=false
          // on an ADMIN's own profile once the handler became real.
          label: 'admin_weekly_digest',
          queued_at: now.toISOString(),
        },
      })

      if (digestEnqueueError) {
        results.errors.push(`admin digest enqueue: ${digestEnqueueError.message}`)
        // `error_message`, not `error` — email_send_log has no `error` column,
        // so this UPDATE was rejected by PostgREST and the row stayed on
        // 'pending' with the failure recorded nowhere.
        await supabase.from('email_send_log')
          .update({ status: 'failed', error_message: digestEnqueueError.message.slice(0, 1000) })
          .eq('message_id', messageId)
      } else {
        results.adminDigest++
      }
    }
    } // end Monday check
  } catch (err) {
    // `catch` binds `unknown`; a non-Error throw here would replace the recorded
    // reason with a second exception and lose the run's whole error report.
    results.errors.push(err instanceof Error ? err.message : String(err))
    console.error('Engagement automation error:', err)
  }

  console.log('Engagement automations completed:', results)

  // `results.errors` collects failed enqueues and anything the top-level catch
  // swallowed. That is exactly where `corsHeaders is not defined` landed — a
  // ReferenceError reported inside a 200 body that nothing was reading. Every
  // entry is a defect (a mail that should have been queued and was not), never
  // a business outcome, so the count decides the status code directly.
  return cronResult(
    'engagement-automations',
    results,
    { count: results.errors.length, reasons: results.errors },
    corsHeaders,
  )
})
