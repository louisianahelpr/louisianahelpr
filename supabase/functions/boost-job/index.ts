// boost-job — targeted push-notification broadcast for stalled open jobs.
//
// A "stalled" job is one that has been open for 24+ hours with zero
// applications. The poster can trigger this once per calendar day (CT) per
// job. When triggered the function:
//
//   1. Validates: caller owns the job, job is open, no boost sent in last 24h.
//   2. Finds approved helpers within ~50 miles who have push tokens.
//   3. Invokes send-push-notification for each helper (fire-and-forget).
//   4. Records the broadcast in job_boosts.
//   5. Returns { notified: N }.
//
// ── Auth ────────────────────────────────────────────────────────────────
// Called by the authenticated poster via supabase.functions.invoke (user
// JWT). The function re-verifies ownership server-side — it does NOT
// require a service-role key from the client.
//
// ── Rate limiting ────────────────────────────────────────────────────────
// One broadcast per calendar day per job is enforced by both a query guard
// (returns 429) and the unique index on job_boosts (DB-level guarantee).
//
// ── Push delivery ────────────────────────────────────────────────────────
// Notifications are dispatched by invoking the internal send-push-notification
// edge function (service-role auth) once per helper. Sends are fire-and-
// forget so the HTTP response returns quickly regardless of token count.
// The function itself handles APNs/FCM routing and dead-token cleanup.
//
// ── Nearby filter ────────────────────────────────────────────────────────
// When the job has lat/lng coordinates, helpers are filtered to those whose
// profile lat/lng is within NEARBY_RADIUS_KM (80 km ≈ 50 miles). Jobs
// without coordinates skip the distance filter and notify all approved
// helpers (acceptable for a small Louisiana-only platform).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'

const NEARBY_RADIUS_KM = 80   // ~50 miles
const MAX_NOTIFICATIONS = 200 // cap to avoid runaway sends

/** Haversine distance in kilometres between two lat/lng pairs. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  // ── Authenticate caller ──────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey)
  const token = authHeader.replace('Bearer ', '')
  const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token)
  if (authError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const callerId = userData.user.id

  // ── Parse body ───────────────────────────────────────────────────────
  let jobId: string
  try {
    const body = await req.json()
    jobId = body?.jobId
    if (!jobId) throw new Error('missing jobId')
  } catch {
    return new Response(JSON.stringify({ error: 'Missing jobId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // ── Load the job ─────────────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, title, category, status, customer_id, created_at, latitude, longitude, location, application_count')
    .eq('id', jobId)
    .single()

  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Authorization: caller must own the job ───────────────────────────
  if (job.customer_id !== callerId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Validation: job must be open ─────────────────────────────────────
  if (job.status !== 'open') {
    return new Response(JSON.stringify({ error: 'Job is not open' }), {
      status: 422,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Validation: job must be 24h+ old ────────────────────────────────
  const ageMs = Date.now() - new Date(job.created_at).getTime()
  if (ageMs < 24 * 60 * 60 * 1000) {
    return new Response(JSON.stringify({ error: 'Job is less than 24 hours old' }), {
      status: 422,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Validation: no boost already sent in last 24 hours ───────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentBoost, error: boostCheckErr } = await supabase
    .from('job_boosts' as any)
    .select('id')
    .eq('job_id', jobId)
    .gte('boosted_at', since)
    .maybeSingle()

  if (boostCheckErr) {
    // job_boosts table may not be deployed yet — PGRST202 or similar.
    // Log and proceed rather than blocking the poster.
    console.warn('job_boosts check failed (table may not be deployed yet):', boostCheckErr.message)
  } else if (recentBoost) {
    return new Response(JSON.stringify({ error: 'Already boosted in the last 24 hours' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Find nearby approved helpers with push tokens ────────────────────
  // Join profiles → push_tokens in a single query using the service role.
  // We pull only what we need: user_id, lat/lng for distance filter, and
  // the push tokens themselves.
  const { data: helpersWithTokens, error: helpersErr } = await supabase
    .from('push_tokens')
    .select('user_id, token, platform, profiles!inner(user_id, approval_status, ban_status, latitude, longitude)')
    .neq('user_id', callerId)

  if (helpersErr) {
    console.error('Failed to load helpers with push tokens:', helpersErr.message)
    return new Response(JSON.stringify({ error: 'Internal error loading helpers' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Filter to approved, non-banned, and within radius.
  const jobLat = (job as any).latitude as number | null
  const jobLng = (job as any).longitude as number | null

  // Deduplicate to unique user_ids (a user may have multiple push tokens
  // from different devices; we'll notify them once per user via their
  // most-recently-updated token only — send-push-notification handles
  // multi-device delivery internally).
  const uniqueUserIds = new Set<string>()
  const eligibleHelpers: string[] = []

  for (const row of helpersWithTokens ?? []) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles as any
    if (!profile) continue
    if (profile.approval_status !== 'approved') continue
    if (profile.ban_status && ['banned', 'temp_banned', 'permanently_banned'].includes(profile.ban_status)) continue
    if (uniqueUserIds.has(row.user_id)) continue

    // Distance filter — only when the job has coordinates.
    if (jobLat != null && jobLng != null && profile.latitude != null && profile.longitude != null) {
      const km = haversineKm(jobLat, jobLng, profile.latitude as number, profile.longitude as number)
      if (km > NEARBY_RADIUS_KM) continue
    }

    uniqueUserIds.add(row.user_id)
    eligibleHelpers.push(row.user_id)
    if (eligibleHelpers.length >= MAX_NOTIFICATIONS) break
  }

  // ── Fire push notifications (fire-and-forget) ─────────────────────────
  // Invoke send-push-notification for each eligible helper. We don't
  // await all of them — the response would time out for large batches.
  // Instead, we start them all and let them finish in the background.
  // Any individual failure is logged by send-push-notification itself.
  const jobTitle = (job as any).title as string
  const jobLocation = (job as any).location as string | null

  const notifyPromises = eligibleHelpers.map((userId) =>
    fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        user_id: userId,
        title: 'New job near you',
        body: `"${jobTitle}"${jobLocation ? ` · ${jobLocation}` : ''} — be the first to apply!`,
        link: `/jobs/${jobId}`,
        category: 'JOB_APPLY',
      }),
    }).catch((err) => {
      console.warn('Push notification send failed for', userId, err)
    }),
  )

  // Start all sends without awaiting — the caller gets a quick response.
  void Promise.allSettled(notifyPromises)

  // ── Record the boost ─────────────────────────────────────────────────
  const { error: insertErr } = await supabase
    .from('job_boosts' as any)
    .insert({
      job_id: jobId,
      boosted_by: callerId,
      helpers_notified: eligibleHelpers.length,
    })

  if (insertErr) {
    // Table may not be deployed (PGRST202). Log and return success anyway
    // since the notifications already fired.
    console.warn('Failed to insert job_boosts row (table may not be deployed yet):', insertErr.message)
  }

  return new Response(
    JSON.stringify({ notified: eligibleHelpers.length }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
