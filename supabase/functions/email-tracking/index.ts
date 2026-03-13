import { createClient } from 'npm:@supabase/supabase-js@2'

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))

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

  if (!userId || !emailType) {
    return new Response('Missing params', { status: 400 })
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

  // Click tracking: redirect to destination
  if (eventType === 'click' && redirect) {
    return new Response(null, {
      status: 302,
      headers: { Location: redirect },
    })
  }

  // Open tracking: return transparent pixel
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
})
