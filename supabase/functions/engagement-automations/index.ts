import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cronResult } from '../_shared/cron-result.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { FROM_DEFAULT } from '../_shared/resend.ts'
import { buildUnsubscribeUrl, unsubscribeHeaders } from '../_shared/unsubscribe.ts'
import { scanAll, scanDefect } from '../_shared/paginate.ts'
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

/**
 * Record the send-log row for one outbound message, and DON'T drop the error.
 *
 * All three send paths used to open with a bare
 * `await supabase.from('email_send_log').insert({...})`. supabase-js RESOLVES
 * `{ error }` rather than throwing, so a rejected insert was invisible — and it
 * is not a cosmetic loss. This row is the ONLY handle the failure path has: when
 * `enqueue_email` fails, the code updates `email_send_log` by `message_id` to
 * mark it `failed`. If the insert never landed, that UPDATE matches zero rows
 * and the failure is recorded absolutely nowhere, while the run still counts the
 * enqueue error. The message then exists in no ledger at all.
 */
async function logSend(
  supabase: { from: (t: string) => any },
  row: { message_id: string; template_name: string; recipient_email: string; status: string },
  results: { errors: string[] },
): Promise<void> {
  const { error } = await supabase.from('email_send_log').insert(row)
  if (error) {
    results.errors.push(
      `email_send_log insert failed for ${row.template_name} → ${row.recipient_email} (${error.message}) — this message is now untracked and a later failure cannot be recorded against it`,
    )
  }
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
    //
    // PAGED, and the paging is the fail-closed guard — not a performance note.
    // This read was `.select('email')` with no bound, and PostgREST caps a
    // result at `db-max-rows = 1000` regardless of any `.limit()` (measured:
    // `notifications?limit=5000` returns exactly 1000 of 1,619 rows). Past the
    // 1000th suppression the set silently stops containing the rest, and every
    // `suppressedSet.has(...)` below answers false for a hard-bounced or
    // complained address. The guard would still be here, still be read, and
    // still let the mail out — which is the precise failure it was written to
    // prevent, arriving with a clean 200. `scanAll` pages past the cap AND
    // compares what it read against the server's own exact count, so a partial
    // read is a measured fact rather than an assumption.
    const suppressedScan = await scanAll<{ email: string | null }>(
      'suppressed_emails',
      (countOpt) =>
        supabase.from('suppressed_emails').select('email', countOpt).order('id', { ascending: true }),
    )
    if (suppressedScan.error) {
      console.error('[engagement-automations] suppression list unavailable:', suppressedScan.error.message)
      return new Response(
        JSON.stringify({
          error: 'Suppression list unavailable — aborted before sending.',
          details: suppressedScan.error.message,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    // A PARTIAL suppression list is not a degraded read to note and carry on
    // from — it is indistinguishable, at every call site below, from an address
    // that was never suppressed. Sending is the irreversible half of this run
    // (an unsent campaign can be re-run; one sent to people who bounced or
    // complained cannot be recalled), so an incomplete list aborts exactly as a
    // failed one does.
    if (!suppressedScan.complete) {
      console.error('[engagement-automations] suppression list incomplete:', suppressedScan.shortfall)
      return new Response(
        JSON.stringify({
          error: 'Suppression list incomplete — aborted before sending.',
          details: suppressedScan.shortfall,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const suppressedSet = new Set(
      suppressedScan.rows.map((s) => (s.email ?? '').toLowerCase()).filter((e) => e.length > 0),
    )

    // ─── Load commercial opt-outs ─────────────────────────────────
    // `notification_preferences.email_promotions = false` is the in-app
    // Promotions toggle AND what `email-unsubscribe` writes on a one-click
    // opt-out. Only the COMMERCIAL loops consult it.
    //
    // Fail closed for the same reason the suppression read does: a dropped
    // error here yields an EMPTY opt-out set, and every person who
    // unsubscribed gets the next drip step. An unsent campaign is retryable;
    // one sent to people who opted out is not.
    //
    // Paged for the same reason, with the same abort. One row per user means
    // this table grows with the user base and crosses 1000 well before anything
    // else here does; the first person past that boundary who switched
    // Promotions off is simply absent from `promoOptedOut` and gets the next
    // drip step. Filtering to `email_promotions = false` server-side would
    // shrink the set, but it would not make an unbounded read complete — it
    // would only move the cliff further out, so the read is paged instead.
    const promoScan = await scanAll<{ user_id: string; email_promotions: boolean | null }>(
      'notification_preferences',
      (countOpt) =>
        supabase
          .from('notification_preferences')
          .select('user_id, email_promotions', countOpt)
          .order('id', { ascending: true }),
    )
    if (promoScan.error) {
      console.error('[engagement-automations] promo opt-out list unavailable:', promoScan.error.message)
      return new Response(
        JSON.stringify({
          error: 'Email preference list unavailable — aborted before sending.',
          details: promoScan.error.message,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    if (!promoScan.complete) {
      console.error('[engagement-automations] promo opt-out list incomplete:', promoScan.shortfall)
      return new Response(
        JSON.stringify({
          error: 'Email preference list incomplete — aborted before sending.',
          details: promoScan.shortfall,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const promoOptedOut = new Set(
      promoScan.rows.filter((p) => p.email_promotions === false).map((p) => p.user_id),
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

      await logSend(
        supabase,
        { message_id: messageId, template_name: label, recipient_email: user.email, status: 'pending' },
        results,
      )

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
        // The failure stamp is the ONLY place this message's fate is recorded,
        // so its own failure cannot be dropped too — that would leave a row
        // stuck on 'pending' forever with the reason nowhere.
        const { error: stampErr } = await supabase
          .from('email_send_log')
          .update({ status: 'failed', error_message: `enqueue_email: ${enqueueErr.message}`.slice(0, 1000) })
          .eq('message_id', messageId)
          .select('message_id')
        if (stampErr) {
          results.errors.push(
            `email_send_log failure stamp did not write for ${messageId} (${stampErr.message}) — the row stays 'pending' and the real reason is lost`,
          )
        }
        return enqueueErr.message
      }
      return null
    }

    // ─── 1. Welcome Drip Sequence (COMMERCIAL) ────────────────────
    //
    // The three recipient scans below are paged too, but they do NOT abort the
    // run the way the two consent reads above do. The asymmetry is deliberate
    // and is the whole shape of this function's risk: a truncated SUPPRESSION
    // list makes it mail someone it must not, which is unrecoverable; a
    // truncated RECIPIENT list makes it skip someone it could have mailed,
    // which tomorrow's run fixes by itself. Skipping is still dropped work, so
    // it is recorded as a defect (non-2xx, visible to the cron sweep) rather
    // than passed off as "nobody qualified today".
    type DripUser = {
      user_id: string
      full_name: string | null
      email: string
      drip_step: number | null
      last_drip_at: string | null
      created_at: string
    }
    const dripScan = await scanAll<DripUser>('drip recipients', (countOpt) =>
      supabase
        .from('profiles')
        .select('user_id, full_name, email, drip_step, last_drip_at, created_at', countOpt)
        .order('user_id', { ascending: true })
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
      .eq('marketing_consent', true),
    )
    // Fail loud rather than treating a read failure OR a truncated read as
    // "nobody qualifies": a silent empty result here is indistinguishable from
    // a working run.
    const dripDefect = scanDefect('drip recipient query', dripScan)
    if (dripDefect) results.errors.push(dripDefect)

    for (const user of dripScan.rows) {
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
    //
    // The `error` on this read used to be dropped entirely — `const { data:
    // approvedUsers } = await ...` — so a PostgREST failure produced
    // `undefined`, the loop ran zero times, and the run reported a clean
    // `approvalResend: 0`. Paged and checked, like its two siblings.
    type ApprovedUser = {
      user_id: string
      full_name: string | null
      email: string
      approval_email_count: number | null
      last_approval_email_at: string | null
      created_at: string
    }
    const approvedScan = await scanAll<ApprovedUser>('approval-resend recipients', (countOpt) =>
      supabase
        .from('profiles')
        .select(
          'user_id, full_name, email, approval_email_count, last_approval_email_at, created_at',
          countOpt,
        )
        .order('user_id', { ascending: true })
        .eq('approval_status', 'approved')
        .lt('approval_email_count', 3)
        .gte('created_at', fourteenDaysAgo)
        .not('email', 'is', null)
        .eq('email_verified', true),
    )
    const approvedDefect = scanDefect('approval-resend recipient query', approvedScan)
    if (approvedDefect) results.errors.push(approvedDefect)

    for (const user of approvedScan.rows) {
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

      // Both errors were dropped, and `(count || 0) > 0` made a FAILED count
      // indistinguishable from "this user has done nothing" — so a transient
      // read fault mailed "your account is approved, ready when you are" to
      // someone who had already posted jobs and sent messages. That is the one
      // person this branch exists to exempt. Skip on a failed read rather than
      // guessing the answer that produces a send.
      if (jobsRes.error || msgsRes.error) {
        results.errors.push(
          `approval-resend activity check failed for ${user.user_id} (${jobsRes.error?.message ?? msgsRes.error?.message}) — reminder withheld rather than sent to a possibly-active user`,
        )
        continue
      }

      // If user has posted jobs or sent messages, they're active — stop resending
      if ((jobsRes.count || 0) > 0 || (msgsRes.count || 0) > 0) {
        // The only `profiles` write in this file that was not routed through
        // `advanceCursor`, and it needs it more than most: this is the cursor
        // that STOPS the sequence. A dropped error or a zero-row match here
        // leaves the counter under 3 and the reminder goes out again tomorrow,
        // and every tomorrow after, to a user the code has just established is
        // active. `advanceCursor` proves the row moved and records a defect.
        await advanceCursor(
          supabase,
          user.user_id,
          { approval_email_count: 3 },
          'approval-resend stop',
          results,
        )
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
      await logSend(
        supabase,
        { message_id: messageId, template_name: 'approval_reminder', recipient_email: user.email, status: 'pending' },
        results,
      )

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

    type InactiveUser = {
      user_id: string
      full_name: string | null
      email: string
      last_drip_at: string | null
    }
    const inactiveScan = await scanAll<InactiveUser>('win-back recipients', (countOpt) =>
      supabase
        .from('profiles')
        .select('user_id, full_name, email, last_drip_at', countOpt)
        .order('user_id', { ascending: true })
        .lt('updated_at', fourteenDaysAgo)
        .gt('updated_at', thirtyDaysAgo) // Don't nudge very old inactive accounts
        .gte('drip_step', 3)
        .not('email', 'is', null)
        // "New jobs are open in your area." is unambiguously promotional, so it
        // requires the signup marketing opt-in and a verified address.
        .eq('email_verified', true)
        .eq('marketing_consent', true),
    )
    const inactiveDefect = scanDefect('win-back recipient query', inactiveScan)
    if (inactiveDefect) results.errors.push(inactiveDefect)

    for (const user of inactiveScan.rows) {
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

    // A FAILED STAT READ MUST NOT BECOME A NUMBER IN AN EMAIL.
    //
    // Each of these was `count || 0` with the `error` dropped, so a failed read
    // arrived in an administrator's inbox as "Pending Approvals: 0" and
    // "Revenue: $0.00" — and administrators act on those. Zero pending
    // approvals means nobody opens the queue that day. That is a swallowed
    // error dressed up as a business fact, which is the single defect shape
    // this file has now been bitten by four separate times.
    //
    // The digest is INTERNAL ops mail with no deadline, so the right response
    // is to skip this week's send rather than publish a number derived from a
    // failure. Recorded as a defect so the run answers non-2xx.
    const statReads: Array<[string, { error: { message: string } | null }]> = [
      ['new users', newUsersRes],
      ['new jobs', newJobsRes],
      ['completed jobs', completedJobsRes],
      ['pending approvals', pendingRes],
      ['open reports', reportsRes],
      ['revenue', revenueRes],
    ]
    const statFailures = statReads
      .filter(([, r]) => r.error)
      .map(([name, r]) => `${name} (${r.error!.message})`)

    if (statFailures.length) {
      results.errors.push(
        `admin digest NOT sent — these stats could not be read: ${statFailures.join(', ')}. Mailing a zero derived from a failed read tells an admin there is nothing in the queue.`,
      )
    } else {

    const revenue = (revenueRes.data || []).reduce((sum, j) => sum + (j.platform_fee_amount || 0), 0)

    const stats = {
      newUsers: newUsersRes.count || 0,
      newJobs: newJobsRes.count || 0,
      completedJobs: completedJobsRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      revenue,
    }

    // Send digest to all admins.
    //
    // NOT paged, and that is a judgement rather than an oversight: `user_roles`
    // filtered to `role = 'admin'` is a handful of rows on any plausible day,
    // three orders of magnitude below the 1000-row cap, and a scan here would
    // buy nothing. The `error` IS checked, because an errored read returns
    // `undefined` and would silently skip the whole digest while reporting a
    // clean run — the same shape of bug as an unbounded read, one line earlier.
    if (adminRolesRes.error) {
      results.errors.push(`admin digest recipient query failed: ${adminRolesRes.error.message}`)
    }
    for (const adminRole of adminRolesRes.data || []) {
      // `.single()` errors with PGRST116 on zero rows, and dropping that error
      // made `data` null, `continue` fire, and that admin's digest silently
      // never exist — with `results.adminDigest` and the defect count both
      // reporting clean. Same shape as the read one line above, which is why
      // it gets the same treatment.
      const { data: adminProfile, error: adminProfileErr } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', adminRole.user_id)
        .single()

      if (adminProfileErr) {
        results.errors.push(
          `admin digest profile read failed for ${adminRole.user_id}: ${adminProfileErr.message}`,
        )
        continue
      }
      if (!adminProfile?.email) continue

      // The hard suppression list applies to EVERY send in this file, and the
      // header two hundred lines up says so in as many words: "it applies to
      // EVERY send below, transactional included, because continuing to mail a
      // hard-bounced address is how a sending domain dies." The drip, approval
      // and win-back loops all honour it; this one did not, so a bounced or
      // complained admin address was mailed weekly forever while the run
      // reported clean. An admin is not exempt from a mailbox provider.
      if (suppressedSet.has(adminProfile.email.toLowerCase())) continue

      const { subject, html, text } = await adminDigestEmail(stats)
      const messageId = crypto.randomUUID()

      await logSend(
        supabase,
        { message_id: messageId, template_name: 'admin_weekly_digest', recipient_email: adminProfile.email, status: 'pending' },
        results,
      )

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
        const { error: digestStampErr } = await supabase.from('email_send_log')
          .update({ status: 'failed', error_message: digestEnqueueError.message.slice(0, 1000) })
          .eq('message_id', messageId)
          .select('message_id')
        if (digestStampErr) {
          results.errors.push(
            `email_send_log failure stamp did not write for ${messageId} (${digestStampErr.message})`,
          )
        }
      } else {
        results.adminDigest++
      }
    }
    } // end stat-read guard
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
