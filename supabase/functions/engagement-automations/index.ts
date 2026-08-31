import { createClient } from 'npm:@supabase/supabase-js@2'
import { htmlEscape } from '../_shared/safe-strings.ts'
import { brand } from '../_shared/email-templates/styles.ts'
import { cronResult } from '../_shared/cron-result.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { FROM_DEFAULT } from '../_shared/resend.ts'
import {
  emailButton,
  emailH2,
  emailP,
  emailShell,
  marketingFooter,
  marketingFooterText,
  unsubscribeHeaders,
} from '../_shared/emailLayout.ts'

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

// ─── Email Templates ──────────────────────────────────────────────
//
// SCOPE NOTE (2026-08-31): the three welcome-drip steps ("You're in…",
// "A quick tour…", "Four things great Helprs do.") and the "New jobs are open
// in your area." win-back were DELETED rather than migrated. Their primary
// purpose is promotional, which makes CAN-SPAM's physical-postal-address
// requirement (§7704(a)(5)) bite, and the business has chosen not to publish
// an address. What remains in this cron is account-status mail (the
// approved-but-never-logged-in reminder) and the internal Monday admin digest
// — neither of which is commercial.
//
// The `profiles.drip_step` / `last_drip_at` columns are LEFT ALONE. Nothing
// else in the repo reads them (only the column-lock triggers, which merely
// preserve them), but dropping columns is a migration and this change owns no
// migrations. They simply stop advancing.

/**
 * Wrap body HTML in the shared table layout.
 *
 * Was `<div style="max-width:480px;margin:0 auto">`: Outlook renders HTML with
 * the Word engine, which does not implement `margin:0 auto` on a block, so
 * every one of these emails left-aligned and stretched to the full reading
 * pane there. `emailShell` is the 600px table version, and it also carries the
 * preheader, the dark-mode block, and the 80px wordmark (the old markup had
 * `width="80"` fighting `style="width:150px"`).
 */
function wrapEmail(preheader: string, content: string): string {
  return emailShell({
    preheader,
    body: `${content}\n${marketingFooter()}`,
  })
}

/** CTA. Width is the Outlook-only VML box, so size it to the label. */
const btn = (text: string, href: string): string =>
  emailButton(href, text, Math.max(180, text.length * 10 + 60))

const p = emailP
const h1 = emailH2

// Admin digest email
function adminDigestEmail(stats: {
  newUsers: number
  newJobs: number
  completedJobs: number
  pendingApprovals: number
  openReports: number
  revenue: number
}) {
  const subject = `Louisiana Helpr Weekly Digest — Week of ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  const stat = (label: string, value: string | number) =>
    `<tr><td class="e-text e-rule" style="padding:8px 0;font-size:15px;color:${brand.bodyOlive};border-bottom:1px solid ${brand.hairline}">${label}</td><td class="e-h1 e-rule" style="padding:8px 0;font-size:15px;font-weight:bold;color:${brand.inkDeep};text-align:right;border-bottom:1px solid ${brand.hairline}">${value}</td></tr>`

  const html = wrapEmail(
    `Helpr this week: ${stats.newUsers} signups, ${stats.newJobs} jobs posted, ${stats.completedJobs} completed.`,
    `
    ${h1("Weekly Digest")}
    ${p(`Here's your platform summary for the past 7 days (week of ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}):`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px">
      ${stat("New signups", stats.newUsers)}
      ${stat("Jobs posted", stats.newJobs)}
      ${stat("Jobs completed", stats.completedJobs)}
      ${stat("Pending approvals", stats.pendingApprovals)}
      ${stat("Open reports", stats.openReports)}
      ${stat("Revenue (fees)", `$${stats.revenue.toFixed(2)}`)}
    </table>
    ${btn("Open Admin Dashboard", `${getAppUrl()}/admin`)}
  `,
  )
  const text = `Louisiana Helpr Weekly Digest: ${stats.newUsers} new users, ${stats.newJobs} new jobs, ${stats.completedJobs} completed, ${stats.pendingApprovals} pending approvals, ${stats.openReports} reports, $${stats.revenue.toFixed(2)} revenue. View: ${getAppUrl()}/admin${marketingFooterText()}`
  return { subject, html, text }
}

// ─── Main Handler ──────────────────────────────────────────────────

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

  // `drip` and `reEngagement` counters are gone with the promotional sends
  // they counted (see the SCOPE NOTE above the templates).
  const results = { approvalResend: 0, adminDigest: 0, errors: [] as string[] }

  try {
    // ─── Load suppressed emails to avoid CAN-SPAM violations ─────
    // Fail closed. `suppressedSet` is the only thing standing between this cron
    // and the addresses that bounced, complained, or unsubscribed. Dropping the
    // error meant a failed read produced an EMPTY suppression set, so every
    // drip/approval/win-back sequence below would mail the exact people we are
    // required not to mail — and would look like a normal successful run.
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

    const now = new Date()

    // ─── 1b. Auto-resend Approval Emails ─────────────────────────
    // Approved users who haven't logged in, resend every 3 days up to 3 emails total
    // Only target users approved within the last 14 days — long-approved users
    // should never receive "your account is approved" reminders, even if their
    // counter was bumped manually or by a backfill.
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
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
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
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

      const htmlContent = wrapEmail(
        "Your Helpr account is approved and waiting — sign in whenever you're ready.",
        `
        ${h1("Your account is approved!")}
        ${p(`Hey ${htmlEscape(user.full_name || "there")}, just a reminder — your Louisiana Helpr account has been approved and is ready to go!`)}
        ${p("Browse jobs, post your own, or connect with people in your area. It only takes a minute to get started.")}
        ${btn("Browse Jobs", `${getAppUrl()}/dashboard`)}
        ${p("Open the app whenever you're ready to post or browse.")}
      `,
      )
      const textContent = `Hey ${user.full_name || "there"}, your Louisiana Helpr account is approved! Browse jobs and get started: ${getAppUrl()}/dashboard${marketingFooterText()}`

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
          headers: unsubscribeHeaders(),
          label: 'approval_reminder',
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        results.errors.push(`Approval resend failed for ${user.email}: ${enqueueErr.message}`)
        continue
      }

      await supabase.from('profiles').update({
        approval_email_count: emailCount + 1,
        last_approval_email_at: now.toISOString(),
      }).eq('user_id', user.user_id)

      results.approvalResend++
    }

    // ─── 3. Admin Weekly Digest (Monday mornings only) ───────────
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

      const { subject, html, text } = adminDigestEmail(stats)
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'admin_daily_digest',
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
          purpose: 'transactional',
          headers: unsubscribeHeaders(),
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
    results.errors.push(err.message)
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
