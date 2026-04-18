import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    // Find approved users who:
    // - have not maxed out their reminder count (< 3)
    // - have not received a reminder in the last 3 days
    const { data: profiles, error: fetchErr } = await supabase
      .from('profiles')
      .select('id, user_id, full_name, email, approval_email_count, last_approval_email_at, idv_status, stripe_account_id')
      .eq('approval_status', 'approved')
      .lt('approval_email_count', 3)
      .or(`last_approval_email_at.is.null,last_approval_email_at.lt.${threeDaysAgo}`)

    if (fetchErr) {
      console.error('Failed to fetch approved profiles:', fetchErr)
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
    let skippedActive = 0

    for (const profile of profiles) {
      if (!profile.email) continue

      // Skip if user is "active":
      // - already verified via Stripe IDV
      // - has connected a Stripe payout account
      // - has any login history
      // - has opened or clicked the approval email
      if ((profile as any).idv_status === 'verified' || (profile as any).stripe_account_id) {
        skippedActive++
        continue
      }

      const { count: loginCount } = await supabase
        .from('login_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
      if ((loginCount || 0) > 0) {
        skippedActive++
        continue
      }

      const { count: engagedCount } = await supabase
        .from('email_tracking')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .eq('email_type', 'account_approved')
        .in('event_type', ['open', 'click'])
      if ((engagedCount || 0) > 0) {
        skippedActive++
        continue
      }

      // Send reminder via existing send-account-status-email function
      try {
        const res = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-account-status-email`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ userId: profile.user_id, status: 'approved' }),
          }
        )
        if (!res.ok) {
          const txt = await res.text()
          console.error(`Failed to send approval reminder to ${profile.email}: ${txt}`)
          continue
        }

        await supabase
          .from('profiles')
          .update({
            approval_email_count: (profile.approval_email_count || 0) + 1,
            last_approval_email_at: new Date().toISOString(),
          } as any)
          .eq('id', profile.id)

        sentCount++
        console.log(`Approval reminder sent to ${profile.email}`)
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        console.error(`Failed to send approval reminder to ${profile.email}:`, errMsg)
        continue
      }
    }

    return new Response(JSON.stringify({ sent: sentCount, skipped_active: skippedActive }), {
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
