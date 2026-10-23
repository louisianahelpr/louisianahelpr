import { createClient } from 'npm:@supabase/supabase-js@2'
import { serve } from "../_shared/buildStamp.ts";
import { getAppUrl } from "../_shared/appUrl.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Admin-triggered manual resend of the email verification message.
 *
 * Owner 2026-10-23: "give us a button to push to send another follow
 * up email". The record of what went out is email_send_log (template
 * 'signup', written by auth-email-hook for EVERY confirmation: the one at sign
 * up, the member's own resend and this one), read through
 * verification_email_history(). A resend is refused while the last one is
 * less than an hour old (sent or still queued), with the time the next one
 * may go, so an admin cannot stack reminders on a member; Supabase Auth's own
 * per-address limit is reported the same way. The link lands on
 * /signup-pending, exactly like the member's own resend
 * (getSignupConfirmRedirect), not the project's Site URL.
 */
serve(async (req) => {
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
    const anonKey = (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!
    const serviceKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!

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
    // Consolidated to the shared `has_role` RPC that admin-delete-user,
    // admin-update-email, and admin-user-actions all use. Previously this
    // function hand-rolled a `.from('user_roles').select('role').eq(...)`
    // check, which drifted when the role model changed. Reading through
    // has_role() means a future role-schema migration is one place, not four.
    // Distinguish "not an admin" from "couldn't check". This still fails
    // CLOSED, but a transient RPC failure now returns a truthful 503 instead of
    // telling a legitimate admin they are Forbidden.
    const { data: isAdmin, error: roleError } = await admin.rpc('has_role', {
      _user_id: userRes.user.id,
      _role: 'admin',
    })
    if (roleError) {
      console.error('[admin-resend-verification] has_role check failed:', roleError.message)
      return new Response(JSON.stringify({ error: "Couldn't verify permissions. Please retry." }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!isAdmin) {
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

    // Q2354: the real send record decides when the next one may go.
    const { data: history, error: historyErr } = await admin.rpc('verification_email_history', { p_user: userId })
    if (historyErr) {
      console.error('[admin-resend-verification] send history read failed:', historyErr.message)
      return new Response(JSON.stringify({ error: "Couldn't read when the last email went out. Please retry." }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const nextAllowedAt = (history as { next_allowed_at?: string | null } | null)?.next_allowed_at ?? null
    if (nextAllowedAt && new Date(nextAllowedAt).getTime() > Date.now()) {
      return new Response(JSON.stringify({
        error: `The last verification email went out less than an hour ago. Another one can go in ${Math.max(1, Math.ceil((new Date(nextAllowedAt).getTime() - Date.now()) / 60000))} min.`,
        next_allowed_at: nextAllowedAt,
      }), {
        status: 429,
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
      // The member's own resend lands here too (src/lib/authRedirects.ts getSignupConfirmRedirect).
      options: { emailRedirectTo: `${getAppUrl()}/signup-pending` },
    })

    if (resendErr) {
      // Supabase Auth's own per-address send limit: say so, never "something went wrong" (Q2354).
      const resendStatus = (resendErr as { status?: number }).status
      const resendCode = (resendErr as { code?: string }).code
      if (resendStatus === 429 || resendCode === 'over_email_send_rate_limit') {
        return new Response(JSON.stringify({
          error: 'Supabase is limiting emails to this address right now. Try again in a few minutes.',
          next_allowed_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      // If already confirmed, flip the flag
      if (resendErr.message?.toLowerCase().includes('already confirmed')) {
        const { error: flipErr } = await admin.from('profiles').update({ email_verified: true }).eq('id', (profile as any).id)
        if (flipErr) console.error('[admin-resend-verification] email_verified flip failed:', flipErr.message)
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

    // The admin-resend counter on the profile (kept for older admin screens). The send record the Emails tab
    // reads is email_send_log, written by auth-email-hook; a failed counter write is logged, never fatal.
    const { error: counterErr } = await admin
      .from('profiles')
      .update({
        verification_email_count: ((profile as any).verification_email_count || 0) + 1,
        last_verification_email_at: new Date().toISOString(),
      } as any)
      .eq('id', (profile as any).id)
    if (counterErr) console.error('[admin-resend-verification] counter write failed:', counterErr.message)

    // Audit log (best-effort, but never silent).
    // The try/catch alone was not enough: a PostgREST builder RESOLVES with
    // `{ error }` on a DB failure rather than throwing, so an RLS/column error
    // slipped past the catch entirely. Destructure the error as well.
    try {
      const { error: auditInsertErr } = await admin.from('admin_audit_log').insert({
        admin_id: userRes.user.id,
        action: 'manual_resend_verification',
        target_type: 'user',
        target_id: userId,
        details: { email: (profile as any).email },
      } as any)
      if (auditInsertErr) {
        console.error(
          "[admin-resend-verification] audit log write FAILED — privileged action has no trail:",
          auditInsertErr.message,
        )
      }
    } catch (auditErr) {
      // Never silently swallow an admin audit write: a privileged action
      // completing with no trail is a compliance gap, not a nit. The action
      // itself still succeeds (the audit must not block it), but the failure
      // is now visible in logs.
      console.error(
        "[admin-resend-verification] audit log write FAILED — privileged action has no trail:",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    // Generic client-safe message; detail is logged above (EF-5, 2026-09-15).
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
