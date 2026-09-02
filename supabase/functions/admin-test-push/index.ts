// Admin-gated wrapper for the "Send Test Push to Me" button on Admin Health.
//
// ── Why this function exists ─────────────────────────────────────────
// AdminHealth.tsx used to call `send-push-notification` directly through
// `supabase.functions.invoke()`. That attaches the CALLER'S user JWT, and
// send-push-notification requires the bearer to equal SECRET_KEY /
// SUPABASE_SERVICE_ROLE_KEY exactly:
//
//     if (!authHeader || !serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`)
//       return 401
//
// An admin's JWT is never equal to the service-role key, so the button could
// only ever return 401 — a diagnostic that always fails is worse than no
// diagnostic, because it reads as "push is broken" on a healthy system and as
// "push is broken" on a broken one. Verified against prod: the same request
// with an admin JWT returns `{"error":"Unauthorized"}` 401; with the
// service-role bearer it returns a real result.
//
// ── Why not just relax send-push-notification's auth ─────────────────
// Because that endpoint can push arbitrary title/body copy branded as Helpr to
// any user_id on the platform. Its service-role-only gate is the correct one,
// and widening it to "or an admin JWT" would put an authenticated broadcast
// primitive one compromised admin session away. The service-role key stays
// server-side, where it already is; only this narrow wrapper is reachable with
// a user JWT, and it can do exactly one thing.
//
// ── The narrowing ────────────────────────────────────────────────────
// * Caller must present a valid Supabase JWT (the gateway also enforces this —
//   there is deliberately NO `verify_jwt = false` entry in config.toml for
//   this function, matching admin-update-email).
// * Caller must hold the `admin` role. A failed role LOOKUP answers 503, not
//   403, so a transient outage never tells a real admin they are forbidden.
// * The push target is ALWAYS the caller's own user id, read from the verified
//   JWT. No user_id is accepted from the request body, so this cannot be turned
//   into a "push anything to anyone" endpoint even by an admin.
// * Title and body are fixed here. Nothing caller-supplied reaches APNs/FCM.
//
// Returns the push function's own JSON body verbatim (plus `upstream_status`)
// so the button can report what actually happened rather than a generic
// success.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error('[admin-test-push] missing SUPABASE_URL / service-role / publishable key')
    return json({ error: 'Server not configured' }, 500)
  }

  // Identify the caller from their own JWT.
  const userClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userError } = await userClient.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (userError || !userData?.user) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const callerId = userData.user.id

  // Admin gate. Same shape as admin-user-actions: a role-check FAILURE is a
  // 503 ("couldn't verify"), never a 403 ("you may not") — the two are
  // different facts and only one of them is the admin's problem.
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: isAdmin, error: roleError } = await admin.rpc('has_role', {
    _user_id: callerId,
    _role: 'admin',
  })
  if (roleError) {
    console.error('[admin-test-push] has_role check failed:', roleError.message)
    return json({ error: "Couldn't verify permissions. Please retry." }, 503)
  }
  if (!isAdmin) {
    return json({ error: 'Forbidden' }, 403)
  }

  // Call the push function server-side with the service-role bearer it
  // requires. `supabase.functions.invoke` is deliberately NOT used here: it
  // would attach this client's key as the Authorization header, and the exact
  // string equality check on the other side makes that fragile. A plain fetch
  // states the contract.
  let upstreamStatus = 0
  let upstreamBody: unknown = null
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: callerId,
        title: 'Helpr',
        body: `Test push from Admin Health · ${new Date().toISOString()}`,
        thread_id: 'admin_test',
      }),
    })
    upstreamStatus = res.status
    const text = await res.text()
    try {
      upstreamBody = text ? JSON.parse(text) : null
    } catch {
      // A non-JSON body is itself the diagnostic — hand it back as text rather
      // than collapsing it into "something went wrong".
      upstreamBody = { error: text.slice(0, 500) }
    }
  } catch (err) {
    console.error('[admin-test-push] send-push-notification unreachable:', err)
    return json(
      { error: 'Could not reach the push service', detail: err instanceof Error ? err.message : String(err) },
      502,
    )
  }

  // ── Audit trail ───────────────────────────────────────────────────
  // Required of every entry in `ADMIN_ENDPOINTS`
  // (src/test/adminEndpointAuthz.test.ts), and warranted on its own: a test
  // send is a REAL send — it lights up a real lock screen — so "who fired one,
  // when, and what came back" belongs on the record even though the target can
  // only ever be the caller themselves. `target_id` is the admin's own id
  // precisely because that is the whole security property this endpoint has.
  //
  // `.select("id")` because a null `error` is not proof a row landed. The write
  // failing does not fail the send — the push already went — but it is never
  // silent: an admin action with no trail is exactly what that test exists to
  // prevent, so it is logged loudly.
  const { data: auditRow, error: auditError } = await admin
    .from('admin_audit_log')
    .insert({
      admin_id: callerId,
      action: 'send_test_push',
      target_type: 'user',
      target_id: callerId,
      details: { upstream_status: upstreamStatus, result: upstreamBody },
    })
    .select('id')
    .single()
  if (auditError || !auditRow?.id) {
    console.error(
      '[admin-test-push] audit log write FAILED — privileged action has no trail:',
      auditError?.message ?? 'insert returned no id',
    )
  }

  if (upstreamStatus < 200 || upstreamStatus >= 300) {
    console.error('[admin-test-push] send-push-notification returned', upstreamStatus, upstreamBody)
    return json({ upstream_status: upstreamStatus, ...(upstreamBody as Record<string, unknown> ?? {}) }, 502)
  }

  return json({ upstream_status: upstreamStatus, ...(upstreamBody as Record<string, unknown> ?? {}) })
})
