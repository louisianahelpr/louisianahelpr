// Send a push notification to all active devices for a given user, through
// APNs (token-auth). The app ships on iOS only (owner, 2026-10-03, Q1126: no
// Android app, so the FCM v1 branch that lived here was removed); a token
// registered with platform 'android' is logged as skipped and never sent.
//
// ── Required for iOS push (APNs) ─────────────────────────────────────
//   APNS_KEY_ID         — 10-char Apple key ID
//   APNS_TEAM_ID        — 10-char Apple Team ID (P85MCK558V for Helpr LLC)
//   APNS_BUNDLE_ID      — iOS bundle ID (com.Helpr)
//   APNS_AUTH_KEY       — Full .p8 contents including BEGIN/END lines
//   APNS_USE_SANDBOX    — '1' for sandbox APNs, anything else = production
//
// ── Caller auth ──────────────────────────────────────────────────────
// Requires SECRET_KEY (service_role) bearer. Not user-callable —
// invoked by edge functions and DB triggers via service_role.
//
// ── Body shape ───────────────────────────────────────────────────────
//   { user_id, title, body, link?, thread_id?, badge?,
//     media_url?, category?, time_sensitive? }
//
// ── Rich-notification fields ─────────────────────────────────────────
//   media_url        — URL to a thumbnail image. Sent as a `media-url`
//                      key inside the APNs custom payload AND triggers
//                      `mutable-content: 1` so an iOS Notification
//                      Service Extension (NSE) can fetch + attach it
//                      before the system renders the notification.
//                      NOTE: Capacitor doesn't ship an NSE by default —
//                      the host iOS app must add one (see
//                      docs/ios-rich-notifications.md follow-up) for
//                      the thumbnail to actually render. Without an NSE
//                      the push still fires; the thumbnail is just
//                      silently dropped client-side.
//   category         — APNs category identifier that maps to a set of
//                      action buttons registered on the iOS side
//                      (UNNotificationCategory). Common values:
//                        "JOB_APPLY"    → Apply, Save
//                        "MESSAGE"      → Reply
//                        "JOB_ACCEPTED" → Message, View
//                      If not supplied, the function infers one from
//                      `link` heuristics (e.g. /messages → MESSAGE).
//                      Registered on iOS in AppDelegate.swift:55-83.
//   time_sensitive   — When true, APNs payload sets
//                      `interruption-level: "time-sensitive"` so the
//                      notification can break through Focus / Silent
//                      modes. Requires the host app's iOS entitlement
//                      `com.apple.developer.usernotifications.time-sensitive`
//                      (see Apple's docs). Without the entitlement the
//                      flag is silently ignored.
//
// ── Returns ──────────────────────────────────────────────────────────
//   { sent: N, failed: M, no_tokens: bool, ios?: {...}, android?: {...}, other?: {...} }
//
// ── Observability ────────────────────────────────────────────────────
// Every invocation writes at least one `notification_logs` row with
// channel='push' (via _shared/notificationLog.ts), plus one extra
// `token_deleted` row per push registration APNs rejected as dead.
// Until 2026-09-01 this function wrote nothing at all — the push channel
// had zero rows in that table for the life of the project, which meant a
// completely dead push pipeline and a healthy one on a quiet night were
// indistinguishable in the only place anyone looks.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { signEs256Jwt } from '../_shared/jwt.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
import {
  adminPushEventKey,
  adminPushSeverity,
  alertSubjectFromLink,
  isOperatorNotification,
} from '../_shared/alertPolicy.ts'
import { logPush } from '../_shared/notificationLog.ts'
import { inferCategoryFromLink, type PushCategory } from './category.ts'
import { isInQuietHours, QUIET_HOURS_TIME_ZONE } from './quietHours.ts'
import { serve } from "../_shared/buildStamp.ts";
import { sendWebPush, type VapidKeys } from '../_shared/webPush.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Action-button categories + the link→category inference live in
// ./category.ts so they can be unit-tested (index.ts calls Deno.serve at
// module load, so vitest cannot import it).

interface PushPayload {
  user_id: string
  title: string
  body: string
  link?: string
  thread_id?: string
  badge?: number
  // Rich-notification additions — all optional, all backward-compatible
  // with callers that only send the basic fields.
  media_url?: string
  category?: PushCategory
  time_sensitive?: boolean
}

function inferCategory(payload: PushPayload): PushCategory | undefined {
  if (payload.category) return payload.category
  return inferCategoryFromLink(payload.link)
}

interface PushToken {
  id: string
  token: string
  platform: string
}

/** A browser subscription row (public.push_subscriptions). */
interface WebSub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

// ─────────────────────────────────────────────────────────────────────
// APNs (iOS)
// ─────────────────────────────────────────────────────────────────────

// Concurrency cap when sending to many devices on the same platform.
// APNs HTTP/2 supports per-connection multiplexing — 8 in flight balances
// throughput against rate-limit burst protection.
const SEND_CONCURRENCY = 8

// Apple accepts a given JWT for ~60 minutes before requiring a refresh.
// Cache the signed token in module scope and re-sign 5 minutes before
// expiry so any in-flight call finishes with the live token.
const APNS_JWT_TTL_MS = 55 * 60 * 1000
let apnsJwtCache: { jwt: string; expiresAt: number; keyHash: string } | null = null

async function buildApnsJwt(keyId: string, teamId: string, p8Pem: string): Promise<string> {
  const keyHash = `${keyId}:${teamId}:${p8Pem.length}`
  if (apnsJwtCache && apnsJwtCache.keyHash === keyHash && apnsJwtCache.expiresAt > Date.now()) {
    return apnsJwtCache.jwt
  }
  const jwt = await signEs256Jwt({ keyId, issuer: teamId, p8Pem })
  apnsJwtCache = { jwt, expiresAt: Date.now() + APNS_JWT_TTL_MS, keyHash }
  return jwt
}

async function sendApnsOne(
  apnsHost: string,
  jwt: string,
  bundleId: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: true } | { ok: false; status: number; reason: string; isInvalidToken: boolean }> {
  const category = inferCategory(payload)
  // `mutable-content: 1` lets the iOS Notification Service Extension
  // wake up before the system renders the notification — it can fetch
  // `media-url`, write it to disk, and attach via UNNotificationAttachment
  // so the thumbnail shows in the alert. Without an NSE the flag is a
  // no-op; the notification still fires sans thumbnail.
  const hasMedia = !!payload.media_url
  // Time-sensitive interruption level breaks through Focus / Silent
  // modes. Requires the host iOS app to declare the
  // `com.apple.developer.usernotifications.time-sensitive` entitlement.
  // Without the entitlement APNs silently ignores the level.
  const timeSensitive = payload.time_sensitive === true
  const apsBody = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      ...(payload.thread_id ? { 'thread-id': payload.thread_id } : {}),
      ...(typeof payload.badge === 'number' ? { badge: payload.badge } : {}),
      ...(category ? { category } : {}),
      ...(hasMedia ? { 'mutable-content': 1 } : {}),
      ...(timeSensitive ? { 'interruption-level': 'time-sensitive' } : {}),
    },
    ...(payload.link ? { link: payload.link } : {}),
    // Custom keys outside `aps` survive APNs delivery and reach the NSE
    // / didReceive handler verbatim. The NSE reads `media-url`, downloads
    // it, and attaches the result before calling its content handler.
    ...(payload.media_url ? { 'media-url': payload.media_url } : {}),
  }

  const res = await fetch(`https://${apnsHost}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apsBody),
  })

  if (res.ok) return { ok: true }

  let reason = 'unknown'
  try {
    const j = await res.json()
    reason = (j as { reason?: string }).reason ?? 'unknown'
  } catch {
    /* APNs sometimes returns empty body */
  }

  const isInvalidToken =
    res.status === 410 || (res.status === 400 && reason === 'BadDeviceToken')
  return { ok: false, status: res.status, reason, isInvalidToken }
}

// Run an async mapper over an array with a fixed concurrency cap. Used
// to fan out APNs sends without flooding the rate limiter or running
// fully sequential (which is what the original code did).
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

// ─────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  const serviceRoleKey =
    Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authHeader || !serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: PushPayload
  try {
    payload = (await req.json()) as PushPayload
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!payload.user_id || !payload.title || !payload.body) {
    return new Response(
      JSON.stringify({ error: 'Missing user_id, title, or body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

  // ── Observability ─────────────────────────────────────────────────
  // Every exit from this handler leaves a `notification_logs` row with
  // channel='push'. Before this, NONE of them did — the whole channel was
  // unrepresented in the one table an operator reads to answer "did we
  // actually tell this person?", so a dead push pipeline and a healthy quiet
  // hour produced identical evidence (none). See _shared/notificationLog.ts
  // for the full argument; the short version is that "zero push rows" was
  // never a fact about push, it was a fact about the logging.
  //
  // `logPush` never throws and never blocks delivery: a push that reached the
  // device is a success even if we could not write it down. It is never silent
  // either — it console.errors under a `[push-log]` tag.
  //
  // `payload.thread_id` carries `notifications.type` (set by
  // `fan_out_push_on_notification`), which is what the category is derived
  // from; `payload.link` is used only to recover the job id.
  const logOutcome = (
    status: 'sent' | 'failed' | 'skipped' | 'token_deleted',
    error?: string | null,
  ) =>
    logPush(supabase, {
      user_id: payload.user_id,
      notification_type: payload.thread_id,
      status,
      subject: payload.title,
      link: payload.link,
      error: error ?? null,
    })

  // Two backends: APNs for the iOS app (Q1126) and Web Push for browsers
  // (VAPID, B61 2026-10-29: 36 of 37 real active members use the website).
  // Without either's secrets every send is skipped.
  const apnsConfigured = !!(
    Deno.env.get('APNS_KEY_ID') &&
    Deno.env.get('APNS_TEAM_ID') &&
    Deno.env.get('APNS_BUNDLE_ID') &&
    Deno.env.get('APNS_AUTH_KEY')
  )
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const vapid: VapidKeys | null = vapidPublic && vapidPrivate && vapidSubject
    ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject }
    : null
  if (!apnsConfigured && !vapid) {
    console.warn('No push backend configured — skipping')
    await logOutcome('skipped', 'no_push_backend_configured')
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: false, skipped: 'no_push_backend_configured' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Quiet hours gate ──────────────────────────────────────────────
  // Honor notification_preferences.quiet_start / quiet_end. If both
  // are set AND the current time falls inside the window, skip the
  // push entirely. The in-app notification row is already written by
  // the caller (the public.notifications INSERT that fires this
  // function via the fan_out_push_on_notification trigger), so the
  // user still sees the notification when they open the app — we're
  // only suppressing the device push.
  //
  // Timezone: the stored times are the user's wall clock; with no
  // per-user timezone stored, quietHours.ts evaluates them in
  // America/Chicago (every user is in Louisiana) — N-003. If reading
  // prefs fails, we fail-open and send the push rather than swallow it.
  const { data: quietPrefs, error: quietErr } = await supabase
    .from('notification_preferences')
    .select('quiet_start, quiet_end')
    .eq('user_id', payload.user_id)
    .maybeSingle()
  if (quietErr) {
    console.warn('Failed to load quiet-hours prefs — failing open', quietErr)
  } else if (quietPrefs?.quiet_start && quietPrefs?.quiet_end) {
    if (isInQuietHours(quietPrefs.quiet_start, quietPrefs.quiet_end, new Date())) {
      console.log('In quiet hours — skipping push', {
        user_id: payload.user_id,
        quiet_start: quietPrefs.quiet_start,
        quiet_end: quietPrefs.quiet_end,
      })
      // Worth a row of its own: "I never got the notification" and "the app
      // held it back because it was 3am" are the same experience for the user
      // and completely different problems for us.
      await logOutcome(
        'skipped',
        `quiet_hours ${quietPrefs.quiet_start}–${quietPrefs.quiet_end} ${QUIET_HOURS_TIME_ZONE}`,
      )
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, no_tokens: false, skipped: 'quiet_hours' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
  }

  const { data: rawTokens, error: tokenErr } = await supabase
    .from('push_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id)
  if (tokenErr) {
    console.error('Failed to load push_tokens', tokenErr)
    await logOutcome('failed', `push_tokens lookup failed: ${tokenErr.message}`)
    return new Response(JSON.stringify({ error: tokenErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const tokens = (rawTokens ?? []) as PushToken[]
  // Browser subscriptions (public.push_subscriptions). A failed read is
  // logged and counted as a failure, never read as "no browsers".
  let webSubs: WebSub[] = []
  let webReadError: string | null = null
  if (vapid) {
    const { data: rawSubs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', payload.user_id)
    if (subErr) {
      webReadError = subErr.message
      console.error('Failed to load push_subscriptions', subErr)
    } else {
      webSubs = (rawSubs ?? []) as WebSub[]
    }
  }
  if (tokens.length === 0 && webSubs.length === 0 && !webReadError) {
    // An ordinary user with no push token is unremarkable — they never granted
    // permission, and the in-app notification is waiting for them next time
    // they open the app.
    //
    // An ADMIN with no push token is an outage in the alarm system. Fraud
    // flags, dispute escalations, auto-suspends and stuck-payment alerts all
    // fan out through this function, and every one of them is the signal that
    // something needs a human NOW. Landing them only in a bell icon nobody is
    // looking at is the same as not sending them: the 2026-08-25 audit found
    // zero admin tokens registered platform-wide, so every ops alert this
    // project has fired had, in practice, no recipient.
    //
    // So the alert escalates to the ops channel instead of evaporating. Only
    // on this branch — the role lookup costs nothing on the hot path because
    // the hot path has tokens and returns above.
    //
    // ONLY OPERATOR ALERTS. An admin is also a user: the owner's own account
    // posts and works jobs, so "Did you finish this job?" addressed to them as
    // a job party is user mail, not an ops page. It used to be mirrored
    // anyway — the role was the only test — and 20+ user-facing notifications
    // reached #ops-alerts as critical (docs/OPEN.md Q2). `payload.thread_id`
    // is notifications.type (fan_out_push_on_notification sets it).
    if (isOperatorNotification(payload.thread_id)) {
      try {
        const { data: adminRole } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('user_id', payload.user_id)
          .eq('role', 'admin')
          .maybeSingle()

        if (adminRole) {
          // seed-policy: an operator alert about a seed/E2E job or account goes
          // to the daily digest, not the channel (postSlackOpsAlert `seed`).
          // Decided from the subject the link names; a link naming no subject,
          // or a lookup that fails, is treated as REAL (fail loud, not quiet).
          const subject = alertSubjectFromLink(payload.link)
          let seed = false
          if (subject?.jobId) {
            const { data: j } = await supabase.from('jobs').select('is_seed').eq('id', subject.jobId).maybeSingle()
            seed = j?.is_seed === true
          } else if (subject?.userId) {
            const { data: p } = await supabase.from('profiles').select('is_seed').eq('user_id', subject.userId).maybeSingle()
            seed = p?.is_seed === true
          }
          // Not awaited on a latency path elsewhere in this codebase, but here
          // the request is otherwise finished and the whole point is delivery,
          // so it is worth the round-trip. postSlackOpsAlert never throws.
          //
          // Posted as the alert itself (its own title), not as "undeliverable":
          // no admin has a push token today, so that framing was on every
          // message. Critical unless the title is a known informational one.
          // `oncePerDayKey` is title + link (the link carries the job/dispute
          // id), so the per-admin fan-out of ONE event posts once, while two
          // different events still post separately.
          await postSlackOpsAlert({
            kind: 'custom',
            severity: adminPushSeverity(payload.title),
            title: payload.title,
            message: payload.body,
            fields: {
              deep_link: payload.link ?? '(none)',
            },
            oncePerDayKey: adminPushEventKey(payload),
            seed,
          })
        }
      } catch (e) {
        // Never let the fallback's own failure change this function's outcome.
        console.error('[send-push-notification] admin Slack fallback failed:', e)
      }
    }

    await logOutcome('skipped', 'no_registered_devices')

    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const iosTokens = tokens.filter((t) => t.platform === 'ios')
  const androidTokens = tokens.filter((t) => t.platform === 'android')
  // Q1252: any other platform ('web' was admitted by the CHECK until
  // 20261004191820) has no sender here. Counted, so a skip is never silent.
  const otherTokens = tokens.filter((t) => t.platform !== 'ios' && t.platform !== 'android')

  // NB-002: the app-icon badge only changed while the app ran, so a closed app
  // kept whatever count its last session left. Every iOS push now carries the
  // recipient's unread count, counted like the in-app badge (useNavUnreadCount:
  // messages unread, not system, sender not blocked either way; plus unread
  // notifications since N-006). Locally-archived
  // threads are client-only, so this can read higher until the app next opens
  // and re-sets it. A failed count sends no badge rather than a wrong one.
  if (iosTokens.length > 0 && typeof payload.badge !== 'number') {
    const { data: blocks, error: blockErr } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${payload.user_id},blocked_id.eq.${payload.user_id}`)
    if (!blockErr) {
      const blocked = (blocks ?? []).map((b: { blocker_id: string; blocked_id: string }) =>
        b.blocker_id === payload.user_id ? b.blocked_id : b.blocker_id)
      // NOID-20 (lead 2026-10-31): the in-app Messages badge counts unread CONVERSATIONS (src/lib/unreadConversations.ts),
      // so the icon does too: the newest 1000 unread rows, grouped by the inbox's thread key (job + sender; one Team
      // thread per user), rows the server hid from the recipient left out as the inbox does.
      let unread = supabase
        .from('messages')
        .select('job_id, sender_id, team_thread_user_id, flagged_hidden')
        .eq('receiver_id', payload.user_id)
        .eq('read', false)
        .not('is_system', 'is', true)
        .order('created_at', { ascending: false })
        .limit(1000)
      // Q1591(b): Team-thread rows get through a block (and count in the
      // in-app badge), so they count here too; job rows from a blocked
      // sender stay out.
      if (blocked.length > 0) unread = unread.or(`sender_id.not.in.(${blocked.join(',')}),team_thread_user_id.not.is.null`)
      // N-006 (owner, 2026-09-27): the icon is unread messages PLUS unread
      // notifications — the same sum the app sets (useNavUnreadCount), counted
      // like the bell (NotificationPanel: user_id, read = false). Either count
      // failing sends no badge rather than a wrong one.
      const [msgs, notifs] = await Promise.all([
        unread,
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', payload.user_id)
          .eq('read', false),
      ])
      const threads = new Set(
        ((msgs.data ?? []) as Array<{ job_id: string | null; sender_id: string | null; team_thread_user_id: string | null; flagged_hidden: boolean | null }>)
          .filter((m) => !m.flagged_hidden)
          .map((m) => (m.job_id === null ? `team:${m.team_thread_user_id ?? ''}` : `${m.job_id}_${m.sender_id ?? 'deleted-account'}`)),
      )
      const count = msgs.error ? null : threads.size
      const notifCount = notifs.count
      if (!msgs.error && !notifs.error && typeof count === 'number' && typeof notifCount === 'number') {
        payload.badge = count + notifCount // NB-002 server badge
      }
    }
  }

  let sent = 0
  let failed = 0
  // Dead registrations carry their REJECTION with them, not just their id: the
  // whole value of logging a token deletion is being able to read WHY Apple
  // refused it (410 / BadDeviceToken = the app was deleted or the token was
  // reissued). An id alone would tell an operator
  // that something vanished and nothing about what happened.
  const deadTokens: { id: string; platform: string; status: number; reason: string }[] = []
  const result: Record<string, unknown> = {}

  // ── iOS path (only when APNs is configured) ──
  if (iosTokens.length > 0 && !apnsConfigured) {
    result.ios = { skipped: 'apns_not_configured', tokens: iosTokens.length }
  } else if (iosTokens.length > 0) {
    try {
      const jwt = await buildApnsJwt(
        Deno.env.get('APNS_KEY_ID')!,
        Deno.env.get('APNS_TEAM_ID')!,
        Deno.env.get('APNS_AUTH_KEY')!,
      )
      const apnsHost =
        Deno.env.get('APNS_USE_SANDBOX') === '1'
          ? 'api.development.push.apple.com'
          : 'api.push.apple.com'
      const bundleId = Deno.env.get('APNS_BUNDLE_ID')!

      const iosResults = await mapWithConcurrency(iosTokens, SEND_CONCURRENCY, async (t) => {
        const r = await sendApnsOne(apnsHost, jwt, bundleId, t.token, payload)
        if (!r.ok) {
          console.warn('APNs send failed', { token_id: t.id, status: r.status, reason: r.reason })
          if (r.isInvalidToken) {
            deadTokens.push({ id: t.id, platform: 'ios', status: r.status, reason: r.reason })
          }
        }
        return r.ok
      })
      const iosSent = iosResults.filter(Boolean).length
      const iosFailed = iosResults.length - iosSent
      sent += iosSent
      failed += iosFailed
      result.ios = { sent: iosSent, failed: iosFailed, tokens: iosTokens.length }
    } catch (err) {
      console.error('APNs init failed', err)
      result.ios = { error: 'apns_init_failed', tokens: iosTokens.length }
      failed += iosTokens.length
    }
  }

  // ── Android ──────────────────────────────────────────────────────
  // No Android app exists (Q1126): such a token is test data or a stale
  // registration. Counted and skipped, never sent.
  if (androidTokens.length > 0) {
    result.android = { skipped: 'android_unsupported', tokens: androidTokens.length }
  }
  if (otherTokens.length > 0) {
    result.other = {
      skipped: 'platform_unsupported',
      tokens: otherTokens.length,
      platforms: [...new Set(otherTokens.map((t) => t.platform))].sort(),
    }
  }

  // ── Web path (browsers, RFC 8291 + VAPID) ─────────────────────────
  // A 404/410 means the browser dropped the subscription for good: its row is
  // deleted below and logged token_deleted, like a dead APNs token.
  const deadWebSubs: { id: string; status: number }[] = []
  if (webReadError) {
    failed += 1
    result.web = { error: 'push_subscriptions_read_failed' }
  } else if (webSubs.length > 0 && vapid) {
    const webResults = await mapWithConcurrency(webSubs, SEND_CONCURRENCY, async (sub) => {
      const r = await sendWebPush(
        sub,
        { title: payload.title, message: payload.body, link: payload.link ?? null, tag: payload.thread_id ?? null },
        vapid,
      )
      if (!r.ok) {
        console.warn('Web push send failed', { subscription_id: sub.id, status: r.status, reason: r.reason })
        if (r.gone) deadWebSubs.push({ id: sub.id, status: r.status })
      }
      return r.ok
    })
    const webSent = webResults.filter(Boolean).length
    sent += webSent
    failed += webResults.length - webSent
    result.web = { sent: webSent, failed: webResults.length - webSent, subscriptions: webSubs.length }
  }
  const deletedWebIds = new Set<string>()
  let webCleanupFailure: string | null = null
  if (deadWebSubs.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', deadWebSubs.map((d) => d.id))
      .select('id')
    if (delErr) {
      webCleanupFailure = delErr.message
      console.error('[send-push-notification] dead web subscription cleanup failed:', delErr.message)
    } else {
      for (const r of (deleted ?? []) as { id: string }[]) deletedWebIds.add(r.id)
    }
  }
  for (const d of deadWebSubs) {
    const removed = deletedWebIds.has(d.id)
    await logOutcome(
      'token_deleted',
      `web subscription gone (HTTP ${d.status}) — push_subscriptions row ${d.id} ${
        removed ? 'deleted' : `NOT deleted: ${webCleanupFailure ?? 'delete matched 0 rows'}`
      }`,
    )
  }

  // Best-effort cleanup of dead tokens.
  //
  // `void supabase.from(...).delete()` did not do this. A PostgrestBuilder is a
  // thenable that only issues its fetch inside then(); `void` evaluates the
  // expression without ever awaiting it, so the builder was constructed and
  // discarded and the DELETE never reached the network. Dead tokens accumulated
  // forever while the response below reported them as cleaned_up. Await it, and
  // report what actually happened rather than what we intended.
  let cleanedUp = 0
  let cleanupFailure: string | null = null
  const deletedIds = new Set<string>()
  if (deadTokens.length > 0) {
    const { data: deleted, error: cleanupError } = await supabase
      .from('push_tokens')
      .delete()
      .in('id', deadTokens.map((d) => d.id))
      .select('id')
    if (cleanupError) {
      cleanupFailure = cleanupError.message
      console.error('[send-push-notification] dead token cleanup failed:', cleanupError.message)
    } else {
      // A null `error` is not proof the DELETE matched anything — a delete of
      // zero rows returns `{ data: [], error: null }`. Count what came back
      // rather than what we asked for, so `cleaned_up` is a measurement.
      for (const r of (deleted ?? []) as { id: string }[]) deletedIds.add(r.id)
      cleanedUp = deletedIds.size
      if (cleanedUp !== deadTokens.length) {
        console.warn(
          `[send-push-notification] asked to delete ${deadTokens.length} dead token(s), removed ${cleanedUp}`,
        )
      }
    }
  }

  // ── The row that matters most ─────────────────────────────────────
  // One `token_deleted` log per registration we just took away from a user.
  // This is a destructive, entirely invisible act: their device stops
  // receiving push, nothing tells them, and until now the only trace was a
  // console.warn in an edge-function log that ages out. It is also the
  // complete explanation for "push worked and then stopped for me", so it
  // belongs in the table an operator actually reads.
  //
  // Logged AFTER the DELETE and describing what really happened — a rejection
  // whose cleanup failed is recorded as still-present, not as deleted.
  for (const d of deadTokens) {
    const removed = deletedIds.has(d.id)
    await logOutcome(
      'token_deleted',
      `${d.platform} token rejected (HTTP ${d.status} ${d.reason}) — push_tokens row ${d.id} ${
        removed ? 'deleted' : `NOT deleted: ${cleanupFailure ?? 'delete matched 0 rows'}`
      }`,
    )
  }

  // ── The aggregate outcome for this send ───────────────────────────
  // `sent > 0` is a success even if some other device failed — the person was
  // reached. Zero delivered with failures is a failure. Zero delivered with no
  // failures means no token was sent to: Android registrations (no Android
  // app, Q1126) and any other platform (Q1252) are counted and skipped.
  // Either is a skip, not a failure.
  const perPlatform = JSON.stringify(result)
  if (sent > 0) {
    await logOutcome('sent', failed > 0 ? `partial: ${failed} of ${tokens.length + webSubs.length} failed — ${perPlatform}` : null)
  } else if (failed > 0) {
    await logOutcome('failed', `0 of ${tokens.length + webSubs.length} delivered — ${perPlatform}`)
  } else {
    await logOutcome('skipped', `no send attempted — ${perPlatform}`)
  }

  return new Response(
    JSON.stringify({
      sent,
      failed,
      no_tokens: false,
      total: tokens.length + webSubs.length,
      cleaned_up: cleanedUp + deletedWebIds.size,
      ...result,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
