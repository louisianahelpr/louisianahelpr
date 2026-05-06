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
//   { user_id, title, body, link?, thread_id?, badge? }
//
// ── Returns ──────────────────────────────────────────────────────────
//   { sent: N, failed: M, no_tokens: bool, ios?: {...}, android?: {...} }

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PushPayload {
  user_id: string
  title: string
  body: string
  link?: string
  thread_id?: string
  badge?: number
}

interface PushToken {
  id: string
  token: string
  platform: string
}

// ─────────────────────────────────────────────────────────────────────
// APNs (iOS)
// ─────────────────────────────────────────────────────────────────────

async function buildApnsJwt(keyId: string, teamId: string, p8Pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const claims = { iss: teamId, iat: now }

  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const claimsB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const key = await importP8PrivateKey(p8Pem)
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )
  const sigB64 = base64UrlEncode(new Uint8Array(signature))
  return `${signingInput}.${sigB64}`
}

async function importP8PrivateKey(p8Pem: string): Promise<CryptoKey> {
  const b64 = p8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sendApnsOne(
  apnsHost: string,
  jwt: string,
  bundleId: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: true } | { ok: false; status: number; reason: string; isInvalidToken: boolean }> {
  const apsBody = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      ...(payload.thread_id ? { 'thread-id': payload.thread_id } : {}),
      ...(typeof payload.badge === 'number' ? { badge: payload.badge } : {}),
    },
    ...(payload.link ? { link: payload.link } : {}),
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

async function importFcmPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  // Service account keys are RS256-signed RSA-2048 in PKCS8 PEM format.
  const b64 = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function buildFcmAccessToken(sa: FcmServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const claimsB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const key = await importFcmPrivateKey(sa.private_key)
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(signingInput),
  )
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`

  // Exchange the signed JWT for an OAuth2 access token.
  const res = await fetch(claims.aud, {
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
  return json.access_token
}

async function sendFcmOne(
  projectId: string,
  accessToken: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: true } | { ok: false; status: number; reason: string; isInvalidToken: boolean }> {
  const message: Record<string, unknown> = {
    token: deviceToken,
    notification: { title: payload.title, body: payload.body },
    ...(payload.link || payload.thread_id
      ? {
          data: {
            ...(payload.link ? { link: payload.link } : {}),
            ...(payload.thread_id ? { thread_id: payload.thread_id } : {}),
          },
        }
      : {}),
    android: {
      priority: 'HIGH',
      notification: {
        sound: 'default',
        ...(payload.thread_id ? { tag: payload.thread_id } : {}),
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
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: false, skipped: 'no_push_backend_configured' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)
  const { data: rawTokens, error: tokenErr } = await supabase
    .from('push_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id)
  if (tokenErr) {
    console.error('Failed to load push_tokens', tokenErr)
    return new Response(JSON.stringify({ error: tokenErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const tokens = (rawTokens ?? []) as PushToken[]
  if (tokens.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const iosTokens = tokens.filter((t) => t.platform === 'ios')
  const androidTokens = tokens.filter((t) => t.platform === 'android')

  let sent = 0
  let failed = 0
  const deadTokenIds: string[] = []
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

        let iosSent = 0
        let iosFailed = 0
        for (const t of iosTokens) {
          const r = await sendApnsOne(apnsHost, jwt, bundleId, t.token, payload)
          if (r.ok) {
            iosSent++
          } else {
            iosFailed++
            console.warn('APNs send failed', { token_id: t.id, status: r.status, reason: r.reason })
            if (r.isInvalidToken) deadTokenIds.push(t.id)
          }
        }
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

        let aSent = 0
        let aFailed = 0
        for (const t of androidTokens) {
          const r = await sendFcmOne(projectId, accessToken, t.token, payload)
          if (r.ok) {
            aSent++
          } else {
            aFailed++
            console.warn('FCM send failed', { token_id: t.id, status: r.status, reason: r.reason })
            if (r.isInvalidToken) deadTokenIds.push(t.id)
          }
        }
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
  if (deadTokenIds.length > 0) {
    void supabase.from('push_tokens').delete().in('id', deadTokenIds)
  }

  return new Response(
    JSON.stringify({
      sent,
      failed,
      no_tokens: false,
      total: tokens.length,
      cleaned_up: deadTokenIds.length,
      ...result,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
