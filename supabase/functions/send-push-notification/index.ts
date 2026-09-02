// Send a push notification to all active devices for a given user.
// Routes iOS tokens via APNs (token-auth) and Android tokens via FCM v1
// (OAuth2 service-account auth). Either backend may be left unconfigured
// (env vars unset) and the function silently skips that platform —
// useful while iOS-only is in production and Android is still in
// development.
//
// ── Required for iOS push (APNs) ─────────────────────────────────────
//   APNS_KEY_ID         — 10-char Apple key ID
//   APNS_TEAM_ID        — 10-char Apple Team ID (P85MCK558V for Helpr LLC)
//   APNS_BUNDLE_ID      — iOS bundle ID (com.Helpr)
//   APNS_AUTH_KEY       — Full .p8 contents including BEGIN/END lines
//   APNS_USE_SANDBOX    — '1' for sandbox APNs, anything else = production
//
// ── Required for Android push (FCM v1) ───────────────────────────────
//   FCM_PROJECT_ID         — Firebase project ID (e.g. 'helpr-prod-12345')
//   FCM_SERVICE_ACCOUNT    — Full service-account JSON pasted verbatim
//                             (download from Firebase Console → Project
//                             Settings → Service Accounts → Generate key)
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
//                      silently dropped client-side. FCM v1 takes the
//                      same URL via `notification.image` and Android
//                      renders it natively, no extension needed.
//   category         — APNs category identifier that maps to a set of
//                      action buttons registered on the iOS side
//                      (UNNotificationCategory). Common values:
//                        "JOB_APPLY"    → Apply, Save
//                        "MESSAGE"      → Reply (text input)
//                        "JOB_ACCEPTED" → Message, View
//                      If not supplied, the function infers one from
//                      `link` heuristics (e.g. /messages → MESSAGE).
//                      iOS-side category registration is a follow-up.
//   time_sensitive   — When true, APNs payload sets
//                      `interruption-level: "time-sensitive"` so the
//                      notification can break through Focus / Silent
//                      modes. Requires the host app's iOS entitlement
//                      `com.apple.developer.usernotifications.time-sensitive`
//                      (see Apple's docs). Without the entitlement the
//                      flag is silently ignored.
//
// ── Returns ──────────────────────────────────────────────────────────
//   { sent: N, failed: M, no_tokens: bool, ios?: {...}, android?: {...} }
//
// ── Observability ────────────────────────────────────────────────────
// Every invocation writes at least one `notification_logs` row with
// channel='push' (via _shared/notificationLog.ts), plus one extra
// `token_deleted` row per push registration APNs/FCM rejected as dead.
// Until 2026-09-01 this function wrote nothing at all — the push channel
// had zero rows in that table for the life of the project, which meant a
// completely dead push pipeline and a healthy one on a quiet night were
// indistinguishable in the only place anyone looks.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { signEs256Jwt, signRs256Jwt } from '../_shared/jwt.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'
import { logPush } from '../_shared/notificationLog.ts'
import { inferCategoryFromLink, type PushCategory } from './category.ts'

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

// ─────────────────────────────────────────────────────────────────────
// FCM v1 (Android)
// ─────────────────────────────────────────────────────────────────────

interface FcmServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

// FCM v1 OAuth2 access tokens last 1 hour; cache for 55 minutes so any
// in-flight call finishes with the live token. Keyed by service account
// email so a key swap invalidates the cache automatically.
const FCM_TOKEN_TTL_MS = 55 * 60 * 1000
let fcmTokenCache: { accessToken: string; expiresAt: number; saEmail: string } | null = null

async function buildFcmAccessToken(sa: FcmServiceAccount): Promise<string> {
  if (fcmTokenCache && fcmTokenCache.saEmail === sa.client_email && fcmTokenCache.expiresAt > Date.now()) {
    return fcmTokenCache.accessToken
  }

  const now = Math.floor(Date.now() / 1000)
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const jwt = await signRs256Jwt({
    privateKeyPem: sa.private_key,
    claims: {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
  })

  // Exchange the signed JWT for an OAuth2 access token.
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('FCM token exchange returned no access_token')

  fcmTokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + FCM_TOKEN_TTL_MS,
    saEmail: sa.client_email,
  }
  return json.access_token
}

async function sendFcmOne(
  projectId: string,
  accessToken: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: true } | { ok: false; status: number; reason: string; isInvalidToken: boolean }> {
  const category = inferCategory(payload)
  // Carry rich-notification fields in `data` so the Capacitor receiver
  // (or a Notification Trampoline) can read them on tap. FCM v1's
  // `notification.image` is the canonical thumbnail field on Android —
  // it renders natively, no extension needed (unlike iOS NSE).
  const message: Record<string, unknown> = {
    token: deviceToken,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.media_url ? { image: payload.media_url } : {}),
    },
    ...(payload.link || payload.thread_id || payload.media_url || category
      ? {
          data: {
            ...(payload.link ? { link: payload.link } : {}),
            ...(payload.thread_id ? { thread_id: payload.thread_id } : {}),
            ...(payload.media_url ? { media_url: payload.media_url } : {}),
            ...(category ? { category } : {}),
          },
        }
      : {}),
    android: {
      priority: 'HIGH',
      notification: {
        sound: 'default',
        ...(payload.thread_id ? { tag: payload.thread_id } : {}),
        ...(payload.media_url ? { image: payload.media_url } : {}),
        ...(category ? { click_action: category } : {}),
      },
    },
  }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message }),
    },
  )
  if (res.ok) return { ok: true }

  let reason = 'unknown'
  try {
    const j = await res.json()
    // FCM v1 uses error.status (e.g. 'NOT_FOUND', 'INVALID_ARGUMENT')
    const errStatus = (j as { error?: { status?: string } }).error?.status
    if (errStatus) reason = errStatus
  } catch {
    /* ignore */
  }
  // NOT_FOUND = unregistered token. INVALID_ARGUMENT often signals a
  // malformed token. Both → mark dead and remove.
  const isInvalidToken =
    res.status === 404 || reason === 'NOT_FOUND' || reason === 'UNREGISTERED'
  return { ok: false, status: res.status, reason, isInvalidToken }
}

// Run an async mapper over an array with a fixed concurrency cap. Used
// to fan out APNs/FCM sends without flooding the rate limiter or running
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
// Quiet hours
// ─────────────────────────────────────────────────────────────────────

// Parse a Postgres `time` value (typically `HH:MM:SS` or `HH:MM`) into
// minutes-since-midnight. Returns NaN for unparseable input so the
// caller can fail-open.
function timeToMinutes(t: string): number {
  const parts = t.split(':')
  if (parts.length < 2) return NaN
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return h * 60 + m
}

// Test whether `now` falls inside the [quietStart, quietEnd) window.
// The window may cross midnight (e.g. 22:00 → 07:00), in which case
// "inside" means now >= start OR now < end. Times are evaluated in UTC
// since no per-user timezone is stored.
export function isInQuietHours(quietStart: string, quietEnd: string, now: Date): boolean {
  const startMin = timeToMinutes(quietStart)
  const endMin = timeToMinutes(quietEnd)
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false
  // Equal start/end → empty window (no quiet hours).
  if (startMin === endMin) return false
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  if (startMin < endMin) {
    // Same-day window, e.g. 13:00 → 14:00.
    return nowMin >= startMin && nowMin < endMin
  }
  // Crosses midnight, e.g. 22:00 → 07:00.
  return nowMin >= startMin || nowMin < endMin
}

// ─────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
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

  // Detect backend availability — both are optional, both can be off.
  const apnsConfigured = !!(
    Deno.env.get('APNS_KEY_ID') &&
    Deno.env.get('APNS_TEAM_ID') &&
    Deno.env.get('APNS_BUNDLE_ID') &&
    Deno.env.get('APNS_AUTH_KEY')
  )
  const fcmConfigured = !!(
    Deno.env.get('FCM_PROJECT_ID') && Deno.env.get('FCM_SERVICE_ACCOUNT')
  )
  if (!apnsConfigured && !fcmConfigured) {
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
  // Timezone: no per-user timezone is stored, so we evaluate the
  // window in UTC (per the task spec). If reading prefs fails, we
  // fail-open and send the push rather than swallow it.
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
        `quiet_hours ${quietPrefs.quiet_start}–${quietPrefs.quiet_end} UTC`,
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
  if (tokens.length === 0) {
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
    try {
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('user_id', payload.user_id)
        .eq('role', 'admin')
        .maybeSingle()

      if (adminRole) {
        // Not awaited on a latency path elsewhere in this codebase, but here
        // the request is otherwise finished and the whole point is delivery,
        // so it is worth the round-trip. postSlackOpsAlert never throws.
        await postSlackOpsAlert({
          kind: 'custom',
          severity: 'warning',
          title: 'Admin alert undeliverable — no push token',
          message: payload.title + ' — ' + payload.body,
          fields: {
            admin_user_id: payload.user_id,
            deep_link: payload.link ?? '(none)',
          },
        })
      }
    } catch (e) {
      // Never let the fallback's own failure change this function's outcome.
      console.error('[send-push-notification] admin Slack fallback failed:', e)
    }

    await logOutcome('skipped', 'no_registered_devices')

    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const iosTokens = tokens.filter((t) => t.platform === 'ios')
  const androidTokens = tokens.filter((t) => t.platform === 'android')

  let sent = 0
  let failed = 0
  // Dead registrations carry their REJECTION with them, not just their id: the
  // whole value of logging a token deletion is being able to read WHY Apple or
  // Google refused it (410 / BadDeviceToken = the app was deleted or the token
  // was reissued; NOT_FOUND = unregistered). An id alone would tell an operator
  // that something vanished and nothing about what happened.
  const deadTokens: { id: string; platform: string; status: number; reason: string }[] = []
  const result: Record<string, unknown> = {}

  // ── iOS path ──────────────────────────────────────────────────────
  if (iosTokens.length > 0) {
    if (!apnsConfigured) {
      result.ios = { skipped: 'apns_not_configured', tokens: iosTokens.length }
    } else {
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
  }

  // ── Android path ─────────────────────────────────────────────────
  if (androidTokens.length > 0) {
    if (!fcmConfigured) {
      result.android = { skipped: 'fcm_not_configured', tokens: androidTokens.length }
    } else {
      try {
        const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!) as FcmServiceAccount
        const accessToken = await buildFcmAccessToken(sa)
        const projectId = Deno.env.get('FCM_PROJECT_ID')!

        const aResults = await mapWithConcurrency(androidTokens, SEND_CONCURRENCY, async (t) => {
          const r = await sendFcmOne(projectId, accessToken, t.token, payload)
          if (!r.ok) {
            console.warn('FCM send failed', { token_id: t.id, status: r.status, reason: r.reason })
            if (r.isInvalidToken) {
              deadTokens.push({ id: t.id, platform: 'android', status: r.status, reason: r.reason })
            }
          }
          return r.ok
        })
        const aSent = aResults.filter(Boolean).length
        const aFailed = aResults.length - aSent
        sent += aSent
        failed += aFailed
        result.android = { sent: aSent, failed: aFailed, tokens: androidTokens.length }
      } catch (err) {
        console.error('FCM init failed', err)
        result.android = { error: 'fcm_init_failed', tokens: androidTokens.length }
        failed += androidTokens.length
      }
    }
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
  // failures means every token belonged to a platform whose backend is not
  // configured, which is a skip, not a failure.
  const perPlatform = JSON.stringify(result)
  if (sent > 0) {
    await logOutcome('sent', failed > 0 ? `partial: ${failed} of ${tokens.length} failed — ${perPlatform}` : null)
  } else if (failed > 0) {
    await logOutcome('failed', `0 of ${tokens.length} delivered — ${perPlatform}`)
  } else {
    await logOutcome('skipped', `no send attempted — ${perPlatform}`)
  }

  return new Response(
    JSON.stringify({
      sent,
      failed,
      no_tokens: false,
      total: tokens.length,
      cleaned_up: cleanedUp,
      ...result,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
