import * as React from 'npm:react@18.3.1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { cronResult } from '../_shared/cron-result.ts'
import { getAppUrl } from '../_shared/appUrl.ts'
import { FROM_DEFAULT } from '../_shared/resend.ts'
import { buildUnsubscribeUrl, unsubscribeHeaders } from '../_shared/unsubscribe.ts'
import { scanAll, scanDefect } from '../_shared/paginate.ts'
import { AdminDigestEmail, OwnerDailySummaryEmail, type OwnerDailyStats } from '../_shared/email-templates/lifecycle.tsx'
import {
  ReEngagementEmail,
  WelcomeDripStep1Email,
  WelcomeDripStep2Email,
  WelcomeDripStep3Email,
} from '../_shared/email-templates/drip.tsx'
import { renderEmail } from '../_shared/email-templates/render.ts'
import { serve } from "../_shared/buildStamp.ts";

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
//     opt-in box) — and skips a member whose
//     `notification_preferences.email_promotions` is an explicit `false` (they
//     turned Promotions off, or an unsubscribe link did). Owner, 2026-10-21
//     (Q2299): the sign-up box ALONE is enough for these emails, so a NULL
//     ("never chosen", the column default since 20261021135832) does not stop
//     them. Both reads fail CLOSED. This is STRICTER than the pre-deletion code, which gated
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

/**
 * OPS-1: who gets the owner's ops mail (the daily summary and the weekly digest). Admins only, and never a test
 * account (owner rule: test data never shows; an admin test login is test data too). public.is_test_subject is the
 * one test rule (test_accounts, is_seed, fixture logins); only an answer of `false` counts as real, so a failed or
 * empty check skips that admin and records why. Suppressed addresses are skipped as everywhere in this file.
 */
async function opsMailRecipients(
  supabase: { from: (t: string) => any; rpc: (n: string, a?: unknown) => any },
  suppressedSet: Set<string>,
  results: { errors: string[] },
  label: string,
): Promise<string[]> {
  const { data: roles, error: rolesErr } = await supabase.from('user_roles').select('user_id').eq('role', 'admin')
  if (rolesErr) {
    results.errors.push(`${label} recipient query failed: ${rolesErr.message}`)
    return []
  }
  const out: string[] = []
  for (const role of (roles || []) as Array<{ user_id: string }>) {
    // `.single()` errors with PGRST116 on zero rows; dropping it would skip an admin silently.
    const { data: adminProfile, error: adminProfileErr } = await supabase
      .from('profiles')
      .select('email, full_name, is_seed')
      .eq('user_id', role.user_id)
      .single()
    if (adminProfileErr) {
      results.errors.push(`${label} profile read failed for ${role.user_id}: ${adminProfileErr.message}`)
      continue
    }
    if (!adminProfile?.email || adminProfile.is_seed === true) continue
    const { data: isTest, error: testErr } = await supabase.rpc('is_test_subject', { p_user_id: role.user_id })
    if (testErr) {
      results.errors.push(`${label} test-account check failed for ${role.user_id}: ${testErr.message}`)
      continue
    }
    if (isTest !== false) continue
    if (suppressedSet.has(String(adminProfile.email).toLowerCase())) continue
    out.push(adminProfile.email)
  }
  return out
}

async function ownerDailyEmail(stats: OwnerDailyStats): Promise<RenderedEmail> {
  const dayOf = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })
  const subject = `Louisiana Helpr daily summary: ${stats.newUsers} sign-ups, ${stats.itemsSold} items sold`
  const { html, text } = await renderEmail(
    React.createElement(OwnerDailySummaryEmail, { stats, adminUrl: `${getAppUrl()}/admin`, dayOf }),
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

/**
 * The welcome drip goes ONLY to members who joined in the last 14 days
 * (owner ruling 2026-10-21, Q2303, issue #3509). A member who signed up more
 * than 14 days ago gets no welcome step at all, whatever step they are on;
 * older members who never got the series get only the come-back emails
 * (come-back-emails / claim_come_back_emails, unchanged). Inside the window
 * the step days (1, 3, 7) and the one-a-day rule are as before. Measured
 * from profiles.created_at, the same column the step days use. Exactly 14
 * days is still inside; 14 days and one second is out.
 */
const WELCOME_DRIP_MAX_DAYS = 14

// The dead-lettered re-send (block 0 below) takes at most this many ids per
// call: the 2026-10-27 loss was 26, and a bound keeps one call inside the
// cron's 90-second HTTP limit.
const RESEND_MAX_IDS = 40

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
  row: {
    message_id: string
    template_name: string
    recipient_email: string
    status: string
    metadata?: Record<string, unknown>
  },
  results: { errors: string[] },
): Promise<void> {
  const { error } = await supabase.from('email_send_log').insert(row)
  if (error) {
    results.errors.push(
      `email_send_log insert failed for ${row.template_name} → ${row.recipient_email} (${error.message}) — this message is now untracked and a later failure cannot be recorded against it`,
    )
  }
}

serve(async (_req) => {
  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = _req.headers.get('Authorization');
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
  const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: boundedFetch() } })

  const results = { drip: 0, reEngagement: 0, adminDigest: 0, ownerDaily: 0, errors: [] as string[] }

  try {
    // ─── Load suppressed emails to avoid CAN-SPAM violations ─────
    // Fail closed. `suppressedSet` is the only thing standing between this cron
    // and the addresses that bounced, complained, or unsubscribed. Dropping the
    // error meant a failed read produced an EMPTY suppression set, so every
    // drip/win-back sequence below would mail the exact people we are
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
    // opt-out. Only the COMMERCIAL loops consult it. NULL is "never chosen"
    // (20261021135832) and is NOT an opt-out: for the welcome drip and the
    // win-back the sign-up box alone decides (owner, 2026-10-21, Q2299). The
    // `=== false` below is that rule; `!== true` would mail nobody again.
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
    //
    // `email_enabled` is the Email MASTER (migration 20260907032218). Since
    // that column exists the master no longer writes `false` across the
    // category columns, so a person with the master OFF and Promotions still
    // ON is exactly the state "I muted all email" produces — and reading
    // `email_promotions` alone would mail them. Both gates, read together,
    // the way send-notification-email reads them.
    const promoScan = await scanAll<{ user_id: string; email_promotions: boolean | null; email_enabled?: boolean | null }>(
      'notification_preferences',
      (countOpt) =>
        supabase
          .from('notification_preferences')
          .select('user_id, email_promotions, email_enabled', countOpt)
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
      promoScan.rows
        .filter((p) => p.email_promotions === false || p.email_enabled === false)
        .map((p) => p.user_id),
    )

    // ─── Come-back emails claimed in the last 20 hours (Q2299) ────
    // claim_come_back_emails (20261021113827) skips a member this cron mailed
    // in the last 20 hours (profiles.last_drip_at). This is the other half:
    // the drip and the win-back skip a member who was claimed for a come-back
    // email in the last 20 hours, so two commercial emails never land on the
    // same day (lh-silent-failure review of the come-back emails, finding 6).
    // Read from the claim row rather than by stamping last_drip_at from the
    // claim: that stamp would bump profiles.updated_at, the win-back's own
    // inactivity clock. Fails closed like the consent lists above: an unsent
    // email is retried tomorrow, a second one the same day is not undone.
    // claimed_at, not queued_at, on purpose: a claim the come-back sender has
    // not queued yet (or released) still holds the drip back for 20 hours,
    // which can only send less (lh-silent-failure review, finding 5).
    const comeBackSince = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    const comeBackScan = await scanAll<{ user_id: string }>(
      'come_back_email_sends',
      (countOpt) =>
        supabase
          .from('come_back_email_sends')
          .select('user_id', countOpt)
          .gte('claimed_at', comeBackSince)
          .order('user_id', { ascending: true }),
    )
    if (comeBackScan.error || !comeBackScan.complete) {
      const why = comeBackScan.error?.message ?? comeBackScan.shortfall
      console.error('[engagement-automations] recent come-back emails unavailable:', why)
      return new Response(
        JSON.stringify({
          error: 'Recent come-back email list unavailable — aborted before sending.',
          details: why,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const comeBackRecently = new Set(comeBackScan.rows.map((r) => r.user_id))

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
      metadata?: Record<string, unknown>,
    ): Promise<string | null> => {
      const unsubscribeUrl =
        (await buildUnsubscribeUrl(user.email)) ?? `${getAppUrl()}/profile?tab=notifications`
      const { html, text } = await renderEmail(element(unsubscribeUrl))
      const messageId = crypto.randomUUID()

      await logSend(
        supabase,
        {
          message_id: messageId,
          template_name: label,
          recipient_email: user.email,
          status: 'pending',
          ...(metadata ? { metadata } : {}),
        },
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

    // ─── 0. Re-send dead-lettered welcome-drip steps (one-off, Q2479) ──
    //
    // On 2026-10-27 26 welcome-drip emails sat behind a 181-email backlog,
    // passed the 60-minute queue limit and were dead-lettered UNSENT, while
    // this cron had already moved each member's drip_step past them. The queue
    // copies were cleared on 2026-10-29, so the only way to send them again is
    // to render them again, here, with the same template, subject, sender and
    // the recipient's own signed unsubscribe link (the signing secret lives
    // only in this runtime).
    //
    // A POST body `{ "resend_dead_lettered": ["<email_send_log.message_id>", ...] }`
    // runs ONLY this block and returns. Each id must name a `dlq` row of a
    // welcome-drip step; the step comes from that row, never from the request.
    // Every gate the daily drip applies is applied again (hard suppression,
    // Promotions/Email master off, sign-up opt-in, verified, not a seed,
    // deleted or banned account, a come-back email in the last 20 hours, a
    // drip email in the last 20 hours), and a recipient who already has ANY
    // later row for that same step (the daily drip sent it, or this block
    // already queued it) is skipped, so a second call sends nothing twice.
    // drip_step is NOT touched (the member already moved on); last_drip_at is
    // stamped so the daily drip keeps its one-email-a-day rule.
    let resendIds: string[] | null = null
    try {
      const reqJson = await _req.json()
      if (reqJson && Array.isArray(reqJson.resend_dead_lettered)) {
        resendIds = reqJson.resend_dead_lettered.filter((v: unknown): v is string => typeof v === 'string')
      }
    } catch {
      // The daily cron posts '{}' and a manual run may post nothing at all:
      // an unreadable body is the ordinary daily run, not a re-send request.
      resendIds = null
    }

    if (resendIds !== null) {
      const resend = { queued: 0, skipped: {} as Record<string, number>, errors: [] as string[] }
      const skip = (why: string) => {
        resend.skipped[why] = (resend.skipped[why] ?? 0) + 1
      }
      const ids = [...new Set(resendIds)]
      if (ids.length === 0 || ids.length > RESEND_MAX_IDS) {
        return new Response(
          JSON.stringify({ error: `resend_dead_lettered needs 1 to ${RESEND_MAX_IDS} message ids` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const { data: deadRows, error: deadErr } = await supabase
        .from('email_send_log')
        .select('message_id, template_name, recipient_email, created_at')
        .in('message_id', ids)
        .eq('status', 'dlq')
      if (deadErr) {
        return new Response(
          JSON.stringify({ error: 'Could not read the dead-lettered rows — nothing sent.', details: deadErr.message }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const found = new Set<string>()
      for (const dead of (deadRows ?? []) as Array<{
        message_id: string
        template_name: string
        recipient_email: string | null
        created_at: string
      }>) {
        if (found.has(dead.message_id)) continue
        found.add(dead.message_id)

        const stepMatch = /^welcome_drip_step_([123])$/.exec(dead.template_name ?? '')
        if (!stepMatch) { skip('not_a_welcome_drip_step'); continue }
        const stepNo = Number(stepMatch[1]) as 1 | 2 | 3
        // Matched EXACTLY as logged: the daily drip logs `profiles.email` as
        // stored, and a LIKE pattern would read the `_` in an address as a
        // wildcard and could match someone else's.
        const logged = dead.recipient_email ?? ''
        const address = logged.trim().toLowerCase()
        if (!address) { skip('no_address'); continue }

        // Sent once already? Any later row for this step and address: the
        // daily drip mailed it, or an earlier call of this block queued it.
        const { data: laterRows, error: laterErr } = await supabase
          .from('email_send_log')
          .select('message_id')
          .eq('template_name', dead.template_name)
          .eq('recipient_email', logged)
          .gt('created_at', dead.created_at)
          .limit(1)
        if (laterErr) { resend.errors.push(`later-send check for ${dead.message_id}: ${laterErr.message}`); continue }
        if ((laterRows ?? []).length > 0) { skip('already_has_a_later_row'); continue }

        const { data: people, error: personErr } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, last_drip_at, email_verified, marketing_consent, is_seed, anonymized_at, ban_status')
          .eq('email', logged)
          .limit(2)
        if (personErr) { resend.errors.push(`profile read for ${dead.message_id}: ${personErr.message}`); continue }
        const matches = (people ?? []) as Array<{
          user_id: string
          full_name: string | null
          email: string | null
          last_drip_at: string | null
          email_verified: boolean | null
          marketing_consent: boolean | null
          is_seed: boolean | null
          anonymized_at: string | null
          ban_status: string | null
        }>
        if (matches.length !== 1) { skip(matches.length === 0 ? 'no_account' : 'ambiguous_account'); continue }
        const person = matches[0]
        if (person.email !== logged) { skip('address_changed'); continue }
        if (person.is_seed !== false) { skip('seed'); continue }
        if (person.anonymized_at !== null) { skip('deleted'); continue }
        if (person.ban_status !== 'active') { skip('banned'); continue }
        if (person.email_verified !== true) { skip('unverified'); continue }
        if (person.marketing_consent !== true) { skip('no_marketing_consent'); continue }
        if (suppressedSet.has(address)) { skip('suppressed'); continue }
        if (promoOptedOut.has(person.user_id)) { skip('opted_out'); continue }
        if (comeBackRecently.has(person.user_id)) { skip('come_back_email_in_20h'); continue }
        if (person.last_drip_at) {
          const hoursSince = (now.getTime() - new Date(person.last_drip_at).getTime()) / (1000 * 60 * 60)
          if (hoursSince < 20) { skip('drip_email_in_20h'); continue }
        }

        const step = DRIP_STEPS[stepNo]
        const failure = await queueCommercial(
          { user_id: person.user_id, email: person.email, full_name: person.full_name },
          (unsubscribeUrl) =>
            React.createElement(step.component, {
              greetingName: person.full_name || '',
              dashboardUrl: `${getAppUrl()}/home`,
              unsubscribeUrl,
            }),
          step.subject,
          dead.template_name,
          { resend_of: dead.message_id },
        )
        if (failure) { resend.errors.push(`re-send of ${dead.message_id} not queued: ${failure}`); continue }
        resend.queued++

        const stamped = await advanceCursor(
          supabase,
          person.user_id,
          { last_drip_at: now.toISOString() },
          'drip re-send',
          { errors: resend.errors },
        )
        if (!stamped) continue
      }
      for (const id of ids) if (!found.has(id)) skip('not_a_dead_lettered_row')

      console.log('Dead-lettered welcome drip re-send:', resend)
      return cronResult(
        'engagement-automations',
        resend,
        { count: resend.errors.length, reasons: resend.errors },
        corsHeaders,
      )
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
    const welcomeWindowStart = new Date(now.getTime() - WELCOME_DRIP_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const dripScan = await scanAll<DripUser>('drip recipients', (countOpt) =>
      supabase
        .from('profiles')
        .select('user_id, full_name, email, drip_step, last_drip_at, created_at', countOpt)
        .order('user_id', { ascending: true })
        .lt('drip_step', 3)
        // Joined in the last 14 days only (WELCOME_DRIP_MAX_DAYS, Q2303). The
        // loop below checks the same window again, so a row this filter let
        // through by mistake still gets no welcome step.
        .gte('created_at', welcomeWindowStart)
        .not('email', 'is', null)
      // Automated lifecycle mail previously went to EVERY profile with an
      // address — including unverified addresses. Email verification is the
      // only entry gate (the approval_status read that sat beside this was
      // retired in Q205b).
      .eq('email_verified', true)
      // The signup opt-in. NEW versus the pre-deletion code, which gated the
      // drip on nothing of the sort — see the header note.
      .eq('marketing_consent', true)
      // Not a seed, anonymised (deleted) or banned account: the same people
      // claim_come_back_emails leaves out. These two loops reached nobody
      // until Q2299 let the sign-up box alone decide (lh-authz-rls review,
      // 2026-10-21, finding 2).
      .eq('is_seed', false)
      .is('anonymized_at', null)
      .eq('ban_status', 'active'),
    )
    // Fail loud rather than treating a read failure OR a truncated read as
    // "nobody qualifies": a silent empty result here is indistinguishable from
    // a working run.
    const dripDefect = scanDefect('drip recipient query', dripScan)
    if (dripDefect) results.errors.push(dripDefect)

    for (const user of dripScan.rows) {
      if (suppressedSet.has((user.email || '').toLowerCase())) continue
      if (promoOptedOut.has(user.user_id)) continue
      if (comeBackRecently.has(user.user_id)) continue

      const signupDate = new Date(user.created_at)
      const daysSinceSignup = (now.getTime() - signupDate.getTime()) / (1000 * 60 * 60 * 24)

      // Past the welcome window (joined more than 14 days ago): no welcome
      // step at all (Q2303). An unreadable sign-up date is out too.
      if (!(daysSinceSignup <= WELCOME_DRIP_MAX_DAYS)) continue

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
            dashboardUrl: `${getAppUrl()}/home`,
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

    // ─── 1b. (retired) Auto-resend Approval Emails ───────────────
    // Deleted in Q205b. The series only ever resent to accounts whose
    // approval_email_count was already >= 1, and the one writer of that first
    // email (the admin Approve action / send-account-status-email 'approved')
    // went with the approval step in Q193, so it could not start for anyone.
    // It also read profiles.approval_status, which is being retired.

    // ─── 2. Re-engagement Nudges (COMMERCIAL) ─────────────────────
    // Users inactive for 14+ days (no job posted, no message, no login update)
    // who finished the drip (step >= 3), so the two sequences never overlap.
    // Since the 14-day welcome window (Q2303) a member who joined more than
    // 14 days ago and never reached step 3 (never got the series, or was cut
    // off partway) stays below step 3 and so never gets this win-back either:
    // by the owner's ruling they get only the come-back emails.
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
        .eq('marketing_consent', true)
        // Same exclusions as the drip above (Q2299 review).
        .eq('is_seed', false)
        .is('anonymized_at', null)
        .eq('ban_status', 'active'),
    )
    const inactiveDefect = scanDefect('win-back recipient query', inactiveScan)
    if (inactiveDefect) results.errors.push(inactiveDefect)

    for (const user of inactiveScan.rows) {
      if (suppressedSet.has((user.email || '').toLowerCase())) continue
      if (promoOptedOut.has(user.user_id)) continue
      if (comeBackRecently.has(user.user_id)) continue

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
            dashboardUrl: `${getAppUrl()}/home`,
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

    const [newUsersRes, newJobsRes, completedJobsRes, reportsRes, revenueRes] = await Promise.all([
      // Real members and real jobs only (owner rule: test data never shows to the owner; OPS-1 area, b29 10-31).
      // Revenue below already read is_seed = false; the three counts did not, so a test run's sign-ups and jobs
      // were counted in the admins' digest.
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('is_seed', false).gte('updated_at', yesterday),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      // Real money only: a test job's fee was paid on the Stripe TEST key
      // (owner 2026-10-12, test mode for test accounts) and is not revenue.
      supabase.from('jobs').select('platform_fee_amount').eq('status', 'completed').eq('is_seed', false).gte('updated_at', yesterday),
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
      openReports: reportsRes.count || 0,
      revenue,
    }

    // Send digest to every admin who is not a test account (OPS-1 helper: the same recipients as the daily
    // summary; a failed role, profile or test check is recorded, never a silent skip).
    const digestTo = await opsMailRecipients(supabase, suppressedSet, results, 'admin digest')
    for (const adminEmail of digestTo) {
      const { subject, html, text } = await adminDigestEmail(stats)
      const messageId = crypto.randomUUID()

      await logSend(
        supabase,
        { message_id: messageId, template_name: 'admin_weekly_digest', recipient_email: adminEmail, status: 'pending' },
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
          to: adminEmail,
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

    // ─── 4. Owner daily summary (INTERNAL, every run; OPS-1, owner 10-29) ──
    // The last 24 hours for the owner: sign-ups, posts, sales, what is stuck and the errors real members hit.
    // Built like the weekly digest above: real members and real items only (is_seed = false; test accounts never
    // show), a failed read skips the send instead of mailing a zero, and it goes only to admins who are not test
    // accounts (opsMailRecipients).
    {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const [dUsers, dJobs, dItems, dDone, dReports, dPayouts] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', since),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('created_at', since),
        supabase.from('declutter_items').select('id', { count: 'exact', head: true }).eq('is_seed', false).gte('live_at', since),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('is_seed', false).gte('updated_at', since),
        supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('declutter_payouts').select('id', { count: 'exact', head: true }).eq('status', 'failed').eq('is_seed', false),
      ])
      const salesScan = await scanAll<{ total_cents: number | null }>(
        'declutter sales',
        (countOpt) =>
          supabase.from('declutter_orders').select('total_cents', countOpt).eq('is_seed', false).gte('paid_at', since).order('id', { ascending: true }),
      )
      const errScan = await scanAll<{ user_id: string | null; tags: unknown }>(
        'member errors',
        (countOpt) =>
          supabase.from('error_logs').select('user_id, tags', countOpt).gte('created_at', since)
            .in('severity', ['error', 'fatal']).not('user_id', 'is', null).order('id', { ascending: true }),
      )
      const dailyFailures = ([
        ['sign-ups', dUsers], ['jobs posted', dJobs], ['items posted', dItems], ['jobs completed', dDone],
        ['open reports', dReports], ['failed payouts', dPayouts],
      ] as Array<[string, { error: { message: string } | null }]>)
        .filter(([, r]) => r.error)
        .map(([name, r]) => `${name} (${r.error!.message})`)
      if (salesScan.error || !salesScan.complete) dailyFailures.push(`sales (${salesScan.shortfall ?? salesScan.error?.message})`)
      if (errScan.error || !errScan.complete) dailyFailures.push(`member errors (${errScan.shortfall ?? errScan.error?.message})`)

      // Errors from test runs never count: a seed-tagged row (error_log_is_seed's rule: tags.seed = true or a
      // source ending in '-seed'), or a member who is a seed profile or a test account.
      const isSeedTag = (t: unknown) => {
        if (!t || typeof t !== 'object' || Array.isArray(t)) return false
        const o = t as Record<string, unknown>
        return String(o.seed ?? '') === 'true' || String(o.source ?? o.area ?? '').endsWith('-seed')
      }
      const errRows = (errScan.rows || []).filter((r) => r.user_id && !isSeedTag(r.tags))
      const errIds = [...new Set(errRows.map((r) => r.user_id as string))]
      const realIds = new Set<string>()
      for (let i = 0; i < errIds.length && !dailyFailures.length; i += 200) {
        const chunk = errIds.slice(i, i + 200)
        const [realRes, testRes] = await Promise.all([
          supabase.from('profiles').select('user_id, is_seed').in('user_id', chunk).eq('is_seed', false),
          supabase.from('test_accounts').select('user_id').in('user_id', chunk),
        ])
        if (realRes.error || testRes.error) {
          dailyFailures.push(`member errors (${(realRes.error ?? testRes.error)!.message})`)
          break
        }
        const testIds = new Set(((testRes.data || []) as Array<{ user_id: string }>).map((r) => r.user_id))
        const asked = new Set(chunk)
        for (const r of (realRes.data || []) as Array<{ user_id: string }>) if (asked.has(r.user_id) && !testIds.has(r.user_id)) realIds.add(r.user_id)
      }

      if (dailyFailures.length) {
        results.errors.push(
          `owner daily summary NOT sent — these stats could not be read: ${dailyFailures.join(', ')}. A zero from a failed read tells the owner nothing is wrong.`,
        )
      } else {
        const dailyStats: OwnerDailyStats = {
          newUsers: dUsers.count || 0,
          jobsPosted: dJobs.count || 0,
          itemsPosted: dItems.count || 0,
          jobsCompleted: dDone.count || 0,
          itemsSold: salesScan.rows.length,
          salesCents: salesScan.rows.reduce((sum, o) => sum + (o.total_cents || 0), 0),
          openReports: dReports.count || 0,
          failedPayouts: dPayouts.count || 0,
          memberErrors: errRows.filter((r) => realIds.has(r.user_id as string)).length,
          membersWithErrors: realIds.size,
        }
        const dailyTo = await opsMailRecipients(supabase, suppressedSet, results, 'owner daily summary')
        for (const to of dailyTo) {
          const { subject, html, text } = await ownerDailyEmail(dailyStats)
          const messageId = crypto.randomUUID()
          await logSend(
            supabase,
            { message_id: messageId, template_name: 'owner_daily_summary', recipient_email: to, status: 'pending' },
            results,
          )
          const { error: dailyEnqueueError } = await supabase.rpc('enqueue_email', {
            queue_name: 'transactional_emails',
            payload: {
              run_id: crypto.randomUUID(),
              message_id: messageId,
              to,
              from: FROM_DEFAULT,
              subject,
              html,
              text,
              purpose: 'internal',
              label: 'owner_daily_summary',
              queued_at: now.toISOString(),
            },
          })
          if (dailyEnqueueError) {
            results.errors.push(`owner daily summary enqueue: ${dailyEnqueueError.message}`)
            const { error: stampErr } = await supabase.from('email_send_log')
              .update({ status: 'failed', error_message: dailyEnqueueError.message.slice(0, 1000) })
              .eq('message_id', messageId)
              .select('message_id')
            if (stampErr) {
              results.errors.push(`email_send_log failure stamp did not write for ${messageId} (${stampErr.message})`)
            }
          } else {
            results.ownerDaily++
          }
        }
      }
    }
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
