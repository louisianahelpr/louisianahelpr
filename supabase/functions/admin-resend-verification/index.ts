import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Admin-triggered manual resend of the email verification message.
 * Bypasses the auto-cadence (admin can fire whenever) but still increments
 * the counter so it shows up in the admin UI.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verify the caller is an admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', userRes.user.id)
      .maybeSingle()

    if (!callerProfile || (callerProfile as any).role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    const userId: string | undefined = body?.userId
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('id, user_id, email, verification_email_count, email_verified')
      .eq('user_id', userId)
      .maybeSingle()

    if (profErr || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if ((profile as any).email_verified) {
      return new Response(JSON.stringify({ error: 'User has already verified their email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!(profile as any).email) {
      return new Response(JSON.stringify({ error: 'No email on file' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: resendErr } = await admin.auth.resend({
      type: 'signup',
      email: (profile as any).email,
    })

    if (resendErr) {
      // If already confirmed, flip the flag
      if (resendErr.message?.toLowerCase().includes('already confirmed')) {
        await admin.from('profiles').update({ email_verified: true }).eq('id', (profile as any).id)
        return new Response(
          JSON.stringify({ error: 'User has already verified their email' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      console.error('Resend error:', resendErr)
      return new Response(JSON.stringify({ error: resendErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await admin
      .from('profiles')
      .update({
        verification_email_count: ((profile as any).verification_email_count || 0) + 1,
        last_verification_email_at: new Date().toISOString(),
      } as any)
      .eq('id', (profile as any).id)

    // Audit log (best-effort)
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: userRes.user.id,
        action: 'manual_resend_verification',
        target_type: 'user',
        target_id: userId,
        details: { email: (profile as any).email },
      } as any)
    } catch (_) {
      // ignore
    }

    return new Response(JSON.stringify({ success: true }), {
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
