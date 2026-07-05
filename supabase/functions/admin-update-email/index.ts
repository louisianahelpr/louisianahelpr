import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'

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
    const serviceRoleKey = (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!
    const anonKey = (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!

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

    // Capture the current email BEFORE any update so we can notify the old
    // address and write an accurate audit log entry.
    const { data: targetUserData } = await supabaseAdmin.auth.admin.getUserById(userId)
    const oldEmail: string | null = targetUserData?.user?.email ?? null

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

    // Notify the user (in-app)
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      title: '📧 Email address updated',
      message: `Your email has been updated to ${normalizedEmail} by an administrator. Use this email to log in going forward.`,
      type: 'info',
      link: '/profile',
    })

    // Write admin audit log
    await supabaseAdmin.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'update_email',
      target_id: userId,
      target_type: 'user',
      details: { old_email: oldEmail, new_email: normalizedEmail },
    }).catch((e: Error) => console.error('[admin-update-email] audit log failed:', e.message))

    // Notify the OLD address by email so the account owner knows their login
    // identity changed — they may no longer receive messages at the new address.
    if (oldEmail && oldEmail !== normalizedEmail) {
      const resendApiKey = Deno.env.get('RESEND_API_KEY')
      if (resendApiKey) {
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif">
<div style="padding:32px 28px;max-width:480px">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  <h1 style="font-size:24px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">Your email address was changed</h1>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">An administrator updated the email address on your Helpr account from <strong>${oldEmail}</strong> to <strong>${normalizedEmail}</strong>.</p>
  <p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 20px">Use <strong>${normalizedEmail}</strong> to log in going forward. If you did not authorise this change, contact us immediately at <a href="mailto:admin@louisianahelpr.com" style="color:hsl(158,45%,42%)">admin@louisianahelpr.com</a>.</p>
  <p style="font-size:13px;color:hsl(160,6%,50%);line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">Questions? Contact us at admin@louisianahelpr.com.</p>
</div>
</body></html>`
        const text = `Your Helpr account email was changed from ${oldEmail} to ${normalizedEmail} by an administrator. Use ${normalizedEmail} to log in going forward. If you did not authorise this change, contact admin@louisianahelpr.com immediately.`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Helpr <noreply@louisianahelpr.com>',
            to: [oldEmail],
            subject: 'Your Helpr email address was changed',
            html,
            text,
          }),
        }).then(async (r) => {
          if (!r.ok) console.error('[admin-update-email] old-address notification failed:', await r.text())
        }).catch((e: Error) => console.error('[admin-update-email] old-address notification error:', e.message))
      }
    }

    console.log(`Admin ${adminId} updated email for user ${userId}: ${oldEmail ?? 'unknown'} → ${normalizedEmail}`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[admin-update-email] error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})