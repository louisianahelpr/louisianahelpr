import { createClient } from 'npm:@supabase/supabase-js@2'

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))

async function computeSig(secret: string, uid: string, type: string, event: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const data = enc.encode(`${uid}:${type}:${event}`)
  const sigBuf = await crypto.subtle.sign('HMAC', key, data)
  // base64url encode
  const bytes = new Uint8Array(sigBuf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const userId = url.searchParams.get('uid')
  const emailType = url.searchParams.get('type')
  const eventType = url.searchParams.get('event') || 'open'
  const redirect = url.searchParams.get('redirect')
  const sig = url.searchParams.get('sig')

  if (!userId || !emailType || !sig) {
    return new Response('Missing params', { status: 400 })
  }

  // Validate uid format (UUID)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return new Response('Invalid uid', { status: 400 })
  }

  // Verify HMAC signature
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret) {
    console.error('CRON_SECRET not configured')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const expectedSig = await computeSig(secret, userId, emailType, eventType)
  if (!timingSafeEqual(sig, expectedSig)) {
    // Silently serve pixel/redirect for invalid signatures to avoid leaking info to scanners,
    // but skip the DB insert.
    if (eventType === 'click' && redirect) {
      // Only follow redirect if it's a safe absolute URL on our domain (avoid open redirects)
      try {
        const target = new URL(redirect)
        const allowedHosts = ['louisianahelpr.com', 'www.louisianahelpr.com', 'louisianahelpr.lovable.app']
        if (!allowedHosts.includes(target.hostname)) {
          return new Response('Invalid redirect', { status: 400 })
        }
        return new Response(null, { status: 302, headers: { Location: redirect } })
      } catch {
        return new Response('Invalid redirect', { status: 400 })
      }
    }
    return new Response(PIXEL, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    await supabaseAdmin.from('email_tracking').insert({
      user_id: userId,
      email_type: emailType,
      event_type: eventType,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
    })
  } catch (err) {
    console.error('Tracking insert error:', err)
  }

  // Click tracking: redirect to destination (validate host to prevent open redirect abuse)
  if (eventType === 'click' && redirect) {
    try {
      const target = new URL(redirect)
      const allowedHosts = ['louisianahelpr.com', 'www.louisianahelpr.com', 'louisianahelpr.lovable.app']
      if (!allowedHosts.includes(target.hostname)) {
        return new Response('Invalid redirect', { status: 400 })
      }
      return new Response(null, {
        status: 302,
        headers: { Location: redirect },
      })
    } catch {
      return new Response('Invalid redirect', { status: 400 })
    }
  }

  // Open tracking: return transparent pixel
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
})
