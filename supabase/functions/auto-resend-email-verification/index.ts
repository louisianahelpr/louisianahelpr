import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Auto-resend email verification reminders.
 *
 * Cadence (matches approval/denial reminder pattern):
 *   reminder #1 (count 0 -> 1): immediately for any pending unverified user
 *   reminder #2 (count 1 -> 2): 1 day after #1
 *   reminder #3 (count 2 -> 3): 7 days after #2
 *
 * After 3 reminders we stop automatically — admins can still manually resend
 * via the admin panel.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Verify cron secret OR service role
  const cronSecret = Deno.env.get('CRON_SECRET')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization')
  if (
    !authHeader ||
    ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) &&
      (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))
  ) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(supabaseUrl, serviceRoleKey!)

    const nowMs = Date.now()
    const oneDayAgo = new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString()

    // Pull pending unverified profiles that could plausibly be due for a reminder.
    const { data: profiles, error: fetchErr } = await admin
      .from('profiles')
      .select('id, user_id, email, verification_email_count, last_verification_email_at, created_at, email_verified')
      .eq('email_verified', false)
      .lt('verification_email_count', 3)
      .or(`last_verification_email_at.is.null,last_verification_email_at.lt.${oneDayAgo}`)

    if (fetchErr) {
      console.error('Failed to fetch unverified profiles:', fetchErr)
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let sentCount = 0
    let skipped = 0

    for (const profile of profiles) {
      if (!profile.email) {
        skipped++
        continue
      }

      // Cadence enforcement
      const sentSoFar = profile.verification_email_count || 0
      const lastSentMs = profile.last_verification_email_at
        ? new Date(profile.last_verification_email_at).getTime()
        : 0
      const hoursSinceLast = lastSentMs ? (nowMs - lastSentMs) / (1000 * 60 * 60) : Infinity
      const requiredHours = sentSoFar === 0 ? 0 : sentSoFar === 1 ? 24 : 24 * 7
      if (hoursSinceLast < requiredHours) {
        skipped++
        continue
      }

      // Trigger Supabase Auth to resend the signup confirmation email.
      // This goes through the auth-email-hook -> branded template.
      const { error: resendErr } = await admin.auth.resend({
        type: 'signup',
        email: profile.email,
      })

      if (resendErr) {
        console.error(`Failed to resend verification to ${profile.email}:`, resendErr.message)
        // If the user is already confirmed, just flip the flag and move on
        if (resendErr.message?.toLowerCase().includes('already confirmed')) {
          await admin
            .from('profiles')
            .update({ email_verified: true })
            .eq('id', profile.id)
        }
        continue
      }

      await admin
        .from('profiles')
        .update({
          verification_email_count: sentSoFar + 1,
          last_verification_email_at: new Date().toISOString(),
        } as any)
        .eq('id', profile.id)

      sentCount++
      console.log(`Verification reminder #${sentSoFar + 1} sent to ${profile.email}`)
    }

    return new Response(JSON.stringify({ sent: sentCount, skipped }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
