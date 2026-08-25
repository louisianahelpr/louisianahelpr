import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Allow either: (a) CRON_SECRET / service role bearer (server-to-server), or
  // (b) an authenticated admin user (browser dashboard).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get('Authorization');

  const isServerCall =
    !!authHeader &&
    ((cronSecret && authHeader === `Bearer ${cronSecret}`) ||
     (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`));

  if (!isServerCall) {
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    try {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace('Bearer ', '');
      const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claims?.claims?.sub) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const adminClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
      );
      const { data: isAdmin } = await adminClient.rpc('has_role', {
        _user_id: claims.claims.sub,
        _role: 'admin',
      });
      if (!isAdmin) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }
    } catch {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
  }

  const checks: Record<string, string> = {}

  // 1. Database connectivity
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    )
    const { count, error } = await supabase
      .from('platform_settings')
      .select('*', { count: 'exact', head: true })
    checks.database = error ? `error: ${error.message}` : 'ok'
  } catch (e) {
    checks.database = `error: ${e.message}`
  }

  // 2. External services. This endpoint is admin-gated above, so it reports
  //    whether each integration is CONFIGURED and in which mode — never the
  //    secret itself.
  //
  //    stripe_mode earns its place: the 2026-08-25 audit found production
  //    running on an `sk_test_` key, which is invisible from every screen in
  //    the app. Everything looks healthy — checkout renders, webhooks arrive,
  //    the admin dashboard shows revenue — while no real money can move. That
  //    is the worst shape a problem can have, and a one-word check kills it.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const stripeMode = !stripeKey
    ? 'missing'
    : stripeKey.startsWith('sk_live') || stripeKey.startsWith('rk_live')
      ? 'live'
      : 'test'
  checks.stripe_mode = stripeMode
  checks.payments = stripeKey ? 'ok' : 'error: STRIPE_SECRET_KEY not set'
  checks.email = Deno.env.get('RESEND_API_KEY') ? 'ok' : 'error: RESEND_API_KEY not set'

  // stripe_mode reports a mode rather than ok/error, so it is excluded from
  // the pass/fail roll-up — 'test' is not by itself a 503, it is a fact the
  // caller decides about.
  const allOk = Object.entries(checks)
    .filter(([k]) => k !== 'stripe_mode')
    .every(([, v]) => v === 'ok')

  return new Response(JSON.stringify({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }), {
    status: allOk ? 200 : 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
