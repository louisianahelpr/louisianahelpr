// Send a push notification to all active devices for a given user.
//
// SCAFFOLD — wired but inert until APNs credentials are configured.
//
// Required Supabase function secrets (none set yet — function will
// no-op-with-warning until they are):
//   APNS_KEY_ID         — 10-char Apple key ID (same one Apple shows
//                         next to your "Apple Push Notifications
//                         service" key in Apple Developer → Keys)
//   APNS_TEAM_ID        — 10-char Apple Team ID (P85MCK558V for Helpr LLC)
//   APNS_BUNDLE_ID      — iOS bundle ID (com.Helpr)
//   APNS_AUTH_KEY       — Full .p8 contents including BEGIN/END lines
//   APNS_USE_SANDBOX    — '1' for development environment
//                         (api.development.push.apple.com), anything else
//                         routes to production (api.push.apple.com)
//
// Caller auth: requires SECRET_KEY (service_role) bearer. This function
// is intentionally NOT user-callable — only edge functions and cron
// jobs should invoke it via service_role. Trigger paths can call it
// from the DB via pg_net.http_post once notifications fan-out is wired.
//
// Body shape:
//   { user_id, title, body, link? (deep-link path or URL),
//     thread_id? (groups notifications on iOS), badge? (number) }
//
// Returns:
//   { sent: N, failed: M, no_tokens: bool, skipped?: 'apns_not_configured' }

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

// Build an ES256-signed JWT for APNs token auth.
// APNs accepts the same JWT for ~1h before requiring a refresh.
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

  // WebCrypto returns a raw 64-byte r||s for ES256 (not DER). Apple
  // wants exactly this format wrapped in base64url.
  const sigB64 = base64UrlEncode(new Uint8Array(signature))
  return `${signingInput}.${sigB64}`
}

async function importP8PrivateKey(p8Pem: string): Promise<CryptoKey> {
  // Strip PEM armor + whitespace to get raw base64
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

async function sendOne(
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

  // 410 Gone = device unregistered. 400 BadDeviceToken = wrong env or
  // malformed token. Either way the token is dead; remove from
  // push_tokens so we don't keep retrying. Other errors (5xx,
  // TooManyRequests) are transient.
  const isInvalidToken =
    res.status === 410 || (res.status === 400 && reason === 'BadDeviceToken')

  return { ok: false, status: res.status, reason, isInvalidToken }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Caller auth: only service_role allowed.
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

  // APNs credentials: skip-with-warning when missing so this function
  // can be deployed + invoked from triggers immediately, without those
  // calls erroring out before push is configured.
  const keyId = Deno.env.get('APNS_KEY_ID')
  const teamId = Deno.env.get('APNS_TEAM_ID')
  const bundleId = Deno.env.get('APNS_BUNDLE_ID')
  const authKey = Deno.env.get('APNS_AUTH_KEY')
  const useSandbox = Deno.env.get('APNS_USE_SANDBOX') === '1'

  if (!keyId || !teamId || !bundleId || !authKey) {
    console.warn('APNs not configured — push silently skipped', {
      user_id: payload.user_id,
      missing: [
        !keyId && 'APNS_KEY_ID',
        !teamId && 'APNS_TEAM_ID',
        !bundleId && 'APNS_BUNDLE_ID',
        !authKey && 'APNS_AUTH_KEY',
      ].filter(Boolean),
    })
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: false, skipped: 'apns_not_configured' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

  const { data: tokens, error: tokenErr } = await supabase
    .from('push_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id)
    .eq('platform', 'ios') // android push (FCM) is a separate path; iOS only for now

  if (tokenErr) {
    console.error('Failed to load push_tokens', tokenErr)
    return new Response(JSON.stringify({ error: tokenErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!tokens || tokens.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, no_tokens: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  let jwt: string
  try {
    jwt = await buildApnsJwt(keyId, teamId, authKey)
  } catch (err) {
    console.error('Failed to build APNs JWT', err)
    return new Response(JSON.stringify({ error: 'JWT signing failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const apnsHost = useSandbox ? 'api.development.push.apple.com' : 'api.push.apple.com'

  let sent = 0
  let failed = 0
  const deadTokenIds: string[] = []

  // Sequential rather than parallel — APNs rate-limits per HTTP/2
  // stream and Deno's fetch doesn't share an HTTP/2 connection across
  // concurrent calls. For low fan-out (1-3 devices per user) this is
  // fine. Switch to a connection-pooling client if fan-out grows.
  for (const t of tokens) {
    const r = await sendOne(apnsHost, jwt, bundleId, t.token, payload)
    if (r.ok) {
      sent++
    } else {
      failed++
      console.warn('APNs send failed', {
        user_id: payload.user_id,
        token_id: t.id,
        status: r.status,
        reason: r.reason,
      })
      if (r.isInvalidToken) deadTokenIds.push(t.id)
    }
  }

  // Best-effort cleanup of dead tokens. Doesn't block the response.
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
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
