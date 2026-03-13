import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify caller is admin via JWT claims
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsErr } = await supabaseUser.auth.getClaims(token)
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminId = claims.claims.sub as string
    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: adminId,
      _role: 'admin',
    })

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { userId, newEmail } = await req.json()
    const normalizedEmail = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : ''

    if (!userId || !normalizedEmail) {
      return new Response(JSON.stringify({ error: 'userId and newEmail are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const buildFreedEmail = (sourceEmail: string, deniedUserId: string) => {
      const [localPart, domainPart] = sourceEmail.split('@')
      const safeLocal = (localPart || 'user').replace(/[^a-zA-Z0-9._%+-]/g, '').slice(0, 32) || 'user'
      const safeDomain = domainPart || 'example.com'
      return `${safeLocal}+denied-${deniedUserId.slice(0, 8)}-${Date.now().toString(36)}@${safeDomain}`
    }

    const freeDeniedAccountEmail = async (deniedUserId: string, sourceEmail: string) => {
      const freedEmail = buildFreedEmail(sourceEmail, deniedUserId)

      const { error: deniedAuthErr } = await supabaseAdmin.auth.admin.updateUserById(deniedUserId, {
        email: freedEmail,
        email_confirm: true,
      })

      if (deniedAuthErr) {
        console.error('Failed to free email in auth for denied account:', deniedAuthErr)
        throw new Error('Failed to free email from denied account in auth')
      }

      const { error: deniedProfileErr } = await supabaseAdmin
        .from('profiles')
        .update({ email: freedEmail })
        .eq('user_id', deniedUserId)

      if (deniedProfileErr) {
        console.error('Failed syncing denied profile email after auth update:', deniedProfileErr)
        throw new Error('Freed auth email, but failed to sync denied profile email')
      }

      console.log(`Auto-freed email ${sourceEmail} from denied account ${deniedUserId} -> ${freedEmail}`)
    }

    // 1) Fast profile-level conflict check
    const { data: conflictingProfiles, error: conflictErr } = await supabaseAdmin
      .from('profiles')
      .select('user_id, approval_status, email')
      .neq('user_id', userId)
      .ilike('email', normalizedEmail)
      .limit(1)

    if (conflictErr) {
      console.error('Failed checking email conflict:', conflictErr)
      return new Response(JSON.stringify({ error: 'Unable to validate email availability right now' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const profileConflict = conflictingProfiles?.[0]
    if (profileConflict) {
      if (profileConflict.approval_status === 'denied') {
        try {
          await freeDeniedAccountEmail(profileConflict.user_id, normalizedEmail)
        } catch (freeErr) {
          return new Response(JSON.stringify({
            error: freeErr instanceof Error ? freeErr.message : 'Failed to free email from denied account.',
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      } else {
        return new Response(JSON.stringify({
          error: 'This email address is already in use by another active account.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 2) Auth-level conflict check (covers cases where profile email was already moved)
    let authHolderId: string | null = null
    let page = 1
    const perPage = 200

    while (!authHolderId && page <= 10) {
      const { data: usersPage, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
      if (usersErr || !usersPage?.users) {
        console.error('Failed listing auth users for conflict check:', usersErr)
        break
      }

      const holder = usersPage.users.find((u) => u.email?.toLowerCase() === normalizedEmail)
      if (holder) {
        authHolderId = holder.id
        break
      }

      if (usersPage.users.length < perPage) break
      page += 1
    }

    if (authHolderId && authHolderId !== userId) {
      const { data: holderProfile } = await supabaseAdmin
        .from('profiles')
        .select('approval_status')
        .eq('user_id', authHolderId)
        .maybeSingle()

      if (holderProfile?.approval_status === 'denied') {
        try {
          await freeDeniedAccountEmail(authHolderId, normalizedEmail)
        } catch (freeErr) {
          return new Response(JSON.stringify({
            error: freeErr instanceof Error ? freeErr.message : 'Failed to free email from denied account.',
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      } else {
        return new Response(JSON.stringify({
          error: 'This email address is already in use by another active account.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Update email in auth.users via admin API
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: normalizedEmail,
      email_confirm: true,
    })

    if (authErr) {
      console.error('Auth update error:', authErr)
      if (authErr.message?.includes('duplicate') || authErr.message?.includes('unique') || authErr.message?.includes('already')) {
        return new Response(JSON.stringify({ error: 'This email address is already in use by another account.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: `Auth update failed: ${authErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Update email in profiles table
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update({ email: normalizedEmail })
      .eq('user_id', userId)

    if (profileErr) {
      console.error('Profile email update failed:', profileErr)
    }

    // Notify the user
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      title: '📧 Email address updated',
      message: `Your email has been updated to ${normalizedEmail} by an administrator. Use this email to log in going forward.`,
      type: 'info',
      link: '/profile',
    })

    console.log(`Admin ${adminId} updated email for user ${userId} to ${normalizedEmail}`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})