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
  // 1b. pg_cron heartbeat — the ONLY check on pg_cron that is not itself a
  //     pg_cron job.
  //
  //     Every watcher this project has (`sweep_cron_http_failures`,
  //     `sweep_silent_cron_failures`, `detect_stuck_payments`) is scheduled BY
  //     pg_cron. If pg_cron stalls — extension disabled, worker wedged, a
  //     restore that lost `cron.job` — all three go quiet together, and quiet
  //     is indistinguishable from healthy. Nothing outside the scheduler was
  //     watching the scheduler.
  //
  //     This endpoint is already probed daily from GitHub Actions
  //     (edge-function-smoke.yml), out of band, and that workflow fails on any
  //     non-200. Asserting freshness here converts a probe we already run into
  //     a real external heartbeat, for one query.
  //
  //     WHY 90 MINUTES AND NOT 20. `cron_run_log` is not written as runs
  //     happen: `sweep_silent_cron_failures` ingests `net._http_response` in a
  //     batch, and it is scheduled HOURLY at :47 (20260829020000). Verified
  //     live 2026-08-31 — every row from the 18:47 sweep shares
  //     `created_at = 18:47:00` while `occurred_at` ranges back to 18:00. So
  //     `max(occurred_at)` is naturally up to ~63 minutes stale (60 for the
  //     sweep interval, plus process-email-queue's 5-minute tick) even when
  //     everything is perfectly healthy. A 20-minute threshold would have been
  //     red at the moment it was written. 90 minutes is the smallest window
  //     that cannot false-alarm, and it is still far tighter than the daily
  //     cadence of the probe that reads it.
  const CRON_HEARTBEAT_MAX_AGE_MIN = 90
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    )
    const { data, error } = await supabase
      .from('cron_run_log')
      .select('occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      checks.cron_heartbeat = `error: cron_run_log read failed: ${error.message}`
    } else if (!data?.occurred_at) {
      // An empty log is not "no news". It means no cron response has been
      // ingested at all, which is the exact shape of a scheduler that never
      // started after a restore.
      checks.cron_heartbeat = 'error: no cron runs recorded'
    } else {
      const ageMin = (Date.now() - new Date(data.occurred_at).getTime()) / 60000
      checks.cron_heartbeat = ageMin <= CRON_HEARTBEAT_MAX_AGE_MIN
        ? 'ok'
        : `error: newest cron run is ${Math.round(ageMin)} min old (limit ${CRON_HEARTBEAT_MAX_AGE_MIN}) — pg_cron may have stalled`
    }
  } catch (e) {
    checks.cron_heartbeat = `error: ${(e as Error).message}`
  }

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
    // Name the function in the body, the same convention every scheduled
    // function follows (_shared/cron-result.ts). health-check is invoked from
    // GitHub Actions rather than pg_net, so it does not reach `cron_run_log`
    // today — but the key costs nothing, makes the body self-identifying in a
    // log or a paste, and means nothing has to change if this is ever probed
    // over net.http_post too.
    fn: 'health-check',
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }), {
    status: allOk ? 200 : 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
