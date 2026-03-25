import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const checks: Record<string, string> = {}

  // 1. Database connectivity
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { count, error } = await supabase
      .from('platform_settings')
      .select('*', { count: 'exact', head: true })
    checks.database = error ? `error: ${error.message}` : 'ok'
  } catch (e) {
    checks.database = `error: ${e.message}`
  }

  // 2. Stripe connectivity
  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    checks.stripe_key = stripeKey ? 'configured' : 'missing'
  } catch {
    checks.stripe_key = 'error'
  }

  // 3. Resend key
  checks.resend_key = Deno.env.get('RESEND_API_KEY') ? 'configured' : 'missing'

  // 4. Webhook secret
  checks.webhook_secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ? 'configured' : 'missing'

  const allOk = Object.values(checks).every(v => v === 'ok' || v === 'configured')

  return new Response(JSON.stringify({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }), {
    status: allOk ? 200 : 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
