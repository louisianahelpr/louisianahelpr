import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const results = {
      reviewReminders: 0,
      jobStartReminders: 0,
      autoStarted: 0,
      autoCompleted: 0,
      noShowFlagged: 0,
      expiredJobs: 0,
      autoEscalated: 0,
      autoRestricted: 0,
    }

    const now = new Date()

    // ── 1. REVIEW REMINDERS ──
    // Jobs completed 24+ hours ago where review_reminder_sent is false
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const { data: completedJobs } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id')
      .eq('status', 'completed')
      .eq('review_reminder_sent', false)
      .lt('updated_at', twentyFourHoursAgo)

    if (completedJobs) {
      for (const job of completedJobs) {
        const notifications = []

        // Check if customer already left a review
        const { data: customerReview } = await supabase
          .from('reviews')
          .select('id')
          .eq('job_id', job.id)
          .eq('reviewer_id', job.customer_id)
          .limit(1)

        if (!customerReview?.length) {
          notifications.push({
            user_id: job.customer_id,
            title: 'How did it go? ⭐',
            message: `Leave a review for "${job.title}" — your feedback helps the community!`,
            type: 'info',
            link: '/job-history',
          })
        }

        // Check if helper already left a review
        if (job.helper_id) {
          const { data: helperReview } = await supabase
            .from('reviews')
            .select('id')
            .eq('job_id', job.id)
            .eq('reviewer_id', job.helper_id)
            .limit(1)

          if (!helperReview?.length) {
            notifications.push({
              user_id: job.helper_id,
              title: 'Leave a review ⭐',
              message: `How was your experience with "${job.title}"? Leave a review!`,
              type: 'info',
              link: '/job-history',
            })
          }
        }

        if (notifications.length > 0) {
          await supabase.from('notifications').insert(notifications)
        }

        await supabase
          .from('jobs')
          .update({ review_reminder_sent: true })
          .eq('id', job.id)

        results.reviewReminders++
      }
    }

    // ── 2. JOB START REMINDERS ──
    // Jobs starting in the next 2 hours that have a helper assigned
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    const todayStr = now.toISOString().split('T')[0]
    const twoHoursStr = twoHoursFromNow.toTimeString().slice(0, 5)
    const nowTimeStr = now.toTimeString().slice(0, 5)

    const { data: upcomingJobs } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id, start_time, location')
      .in('status', ['accepted', 'in_progress'])
      .eq('date_needed', todayStr)
      .not('helper_id', 'is', null)
      .not('start_time', 'is', null)

    if (upcomingJobs) {
      for (const job of upcomingJobs) {
        if (!job.start_time || !job.helper_id) continue
        const jobTime = job.start_time.slice(0, 5)

        // Only send if job starts between now and 2 hours from now
        if (jobTime >= nowTimeStr && jobTime <= twoHoursStr) {
          // Check if we already sent a reminder (avoid duplicates)
          const { data: existing } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', job.helper_id)
            .eq('type', 'reminder')
            .ilike('title', '%starting soon%')
            .gte('created_at', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString())
            .limit(1)

          if (!existing?.length) {
            await supabase.from('notifications').insert([
              {
                user_id: job.helper_id,
                title: 'Job starting soon! 🕐',
                message: `"${job.title}" starts at ${job.start_time}${job.location ? ` at ${job.location}` : ''}. Get ready!`,
                type: 'reminder',
                link: '/dashboard',
              },
              {
                user_id: job.customer_id,
                title: 'Your helpr is on the way 🚗',
                message: `"${job.title}" starts at ${job.start_time}. Your helpr has been notified.`,
                type: 'reminder',
                link: '/dashboard',
              },
            ])
            results.jobStartReminders++
          }
        }
      }
    }

    // ── 2b. AUTO-START ACCEPTED JOBS ON SCHEDULED DATE ──
    // Jobs in "accepted" status where helper confirmed and date_needed is today or past
    const { data: acceptedJobsToStart } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id')
      .eq('status', 'accepted')
      .not('helper_id', 'is', null)
      .not('helper_confirmed_at', 'is', null)
      .lte('date_needed', todayStr)

    if (acceptedJobsToStart) {
      for (const job of acceptedJobsToStart) {
        await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', job.id)
        
        const notifications = [
          {
            user_id: job.customer_id,
            title: 'Job is now in progress! 🚀',
            message: `"${job.title}" has automatically started. Your helpr is on it!`,
            type: 'info',
            link: '/activity?tab=posted&filter=in_progress',
          },
        ]
        if (job.helper_id) {
          notifications.push({
            user_id: job.helper_id,
            title: 'Job started! 🚀',
            message: `"${job.title}" is now in progress. Good luck!`,
            type: 'info',
            link: '/activity?tab=applied&filter=in_progress',
          })
        }
        await supabase.from('notifications').insert(notifications)
        results.autoStarted++
      }
    }

    // ── 3. AUTO-COMPLETE STALE JOBS ──
    // Jobs where both parties confirmed completion 48+ hours ago
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
    const { data: staleJobs } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id')
      .eq('status', 'in_progress')
      .not('helper_completed_at', 'is', null)
      .not('poster_completed_at', 'is', null)
      .lt('helper_completed_at', fortyEightHoursAgo)
      .lt('poster_completed_at', fortyEightHoursAgo)

    if (staleJobs) {
      for (const job of staleJobs) {
        await supabase
          .from('jobs')
          .update({ status: 'completed' })
          .eq('id', job.id)

        const notifs = [
          {
            user_id: job.customer_id,
            title: 'Job auto-completed ✅',
            message: `"${job.title}" has been automatically marked complete.`,
            type: 'success',
            link: '/job-history',
          },
        ]
        if (job.helper_id) {
          notifs.push({
            user_id: job.helper_id,
            title: 'Job auto-completed ✅',
            message: `"${job.title}" has been automatically marked complete. Payment is being processed.`,
            type: 'payment',
            link: '/earnings',
          })
        }
        await supabase.from('notifications').insert(notifs)
        results.autoCompleted++
      }
    }

    // ── 4. NO-SHOW DETECTION ──
    // Accepted jobs where start_time has passed by 30+ minutes and helper hasn't checked in
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const thirtyMinTimeStr = thirtyMinAgo.toTimeString().slice(0, 5)

    const { data: noShowCandidates } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id, start_time')
      .eq('status', 'accepted')
      .eq('date_needed', todayStr)
      .not('helper_id', 'is', null)
      .not('start_time', 'is', null)

    if (noShowCandidates) {
      for (const job of noShowCandidates) {
        if (!job.start_time || !job.helper_id) continue
        const jobTime = job.start_time.slice(0, 5)

        // Job should have started 30+ min ago
        if (jobTime <= thirtyMinTimeStr) {
          // Check if helper has checked in
          const { data: checkins } = await supabase
            .from('job_checkins')
            .select('id')
            .eq('job_id', job.id)
            .eq('user_id', job.helper_id)
            .limit(1)

          if (!checkins?.length) {
            // Check if we already sent a no-show alert
            const { data: existingAlert } = await supabase
              .from('notifications')
              .select('id')
              .eq('user_id', job.customer_id)
              .ilike('title', '%no-show%')
              .gte('created_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
              .limit(1)

            if (!existingAlert?.length) {
              await supabase.from('notifications').insert([
                {
                  user_id: job.customer_id,
                  title: 'Possible no-show ⚠️',
                  message: `Your helpr hasn't checked in for "${job.title}" (was due at ${job.start_time}). You can cancel and re-post if needed.`,
                  type: 'warning',
                  link: '/dashboard',
                },
                {
                  user_id: job.helper_id,
                  title: 'Are you on your way? ⏰',
                  message: `You haven't checked in for "${job.title}" (started at ${job.start_time}). Please check in now or the job may be reassigned.`,
                  type: 'warning',
                  link: '/dashboard',
                },
              ])
              results.noShowFlagged++
            }
          }
        }
      }
    }

    // ── 5. EXPIRE OPEN JOBS PAST THEIR EXPIRY DATE ──
    const { data: expiredOpenJobs } = await supabase
      .from('jobs')
      .select('id, title, customer_id')
      .eq('status', 'open')
      .not('expires_at', 'is', null)
      .lt('expires_at', now.toISOString())

    if (expiredOpenJobs) {
      for (const job of expiredOpenJobs) {
        await supabase
          .from('jobs')
          .update({ status: 'cancelled', cancellation_reason: 'Job listing expired' })
          .eq('id', job.id)

        await supabase.from('notifications').insert({
          user_id: job.customer_id,
          title: 'Job listing expired',
          message: `"${job.title}" has expired. You can re-post it anytime.`,
          type: 'info',
          link: '/post-job',
        })
        results.expiredJobs++
      }
    }

    // ── 6. AUTO-ESCALATE USERS WITH 3+ REPORTS ──
    // Find users with 3+ pending reports who haven't been restricted yet
    const { data: reportCounts } = await supabase
      .from('reports')
      .select('reported_id')
      .eq('status', 'pending')

    if (reportCounts) {
      // Count reports per user
      const counts: Record<string, number> = {}
      for (const r of reportCounts) {
        counts[r.reported_id] = (counts[r.reported_id] || 0) + 1
      }

      for (const [userId, count] of Object.entries(counts)) {
        if (count < 3) continue

        // Check if already restricted/banned
        const { data: existingBan } = await supabase
          .from('user_bans')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .limit(1)

        if (existingBan?.length) continue

        // Check if we already created a violation for this escalation
        const { data: existingViolation } = await supabase
          .from('user_violations')
          .select('id')
          .eq('user_id', userId)
          .eq('violation_type', 'auto_escalation')
          .gte('created_at', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1)

        if (existingViolation?.length) continue

        // Auto-restrict: create violation + temporary ban pending admin review
        await supabase.from('user_violations').insert({
          user_id: userId,
          violation_type: 'auto_escalation',
          description: `Automatically escalated: ${count} pending reports from different users.`,
          action_taken: 'temporary_restriction',
        })

        await supabase.from('user_bans').insert({
          user_id: userId,
          ban_type: 'temporary',
          reason: `Auto-restricted: ${count} pending reports. Awaiting admin review.`,
          banned_by: userId, // system-initiated
          expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          is_active: true,
        })

        // Update profile ban status
        await supabase.from('profiles')
          .update({ ban_status: 'suspended' })
          .eq('user_id', userId)

        // Notify admins
        const { data: adminRoles } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin')

        const adminNotifs = (adminRoles || []).map(a => ({
          user_id: a.user_id,
          title: 'User auto-restricted ⚠️',
          message: `A user has been automatically restricted due to ${count} reports. Please review.`,
          type: 'warning',
          link: '/admin',
        }))

        // Notify the restricted user
        adminNotifs.push({
          user_id: userId,
          title: 'Account temporarily restricted',
          message: 'Your account has been temporarily restricted due to multiple reports. An admin will review shortly.',
          type: 'warning',
          link: '/support',
        })

        if (adminNotifs.length > 0) {
          await supabase.from('notifications').insert(adminNotifs)
        }

        results.autoEscalated++
      }
    }

    // ── 7. AUTO-RESTRICT REPEAT VIOLATORS ──
    // Users with 2+ violations in the past 30 days who aren't already banned
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: recentViolations } = await supabase
      .from('user_violations')
      .select('user_id')
      .gte('created_at', thirtyDaysAgo)

    if (recentViolations) {
      const violationCounts: Record<string, number> = {}
      for (const v of recentViolations) {
        violationCounts[v.user_id] = (violationCounts[v.user_id] || 0) + 1
      }

      for (const [userId, vCount] of Object.entries(violationCounts)) {
        if (vCount < 2) continue

        // Check if already banned
        const { data: existingBan } = await supabase
          .from('user_bans')
          .select('id, ban_type')
          .eq('user_id', userId)
          .eq('is_active', true)
          .limit(1)

        // Skip if already permanently banned, or if already has a temp ban (handled by escalation above)
        if (existingBan?.length) {
          if (existingBan[0].ban_type === 'permanent') continue
          // Upgrade temp ban to longer restriction for repeat violators
          if (vCount >= 4) {
            await supabase.from('user_bans')
              .update({ ban_type: 'permanent', reason: `Permanent ban: ${vCount} violations in 30 days.` })
              .eq('id', existingBan[0].id)

            await supabase.from('profiles')
              .update({ ban_status: 'banned' })
              .eq('user_id', userId)

            await supabase.from('notifications').insert({
              user_id: userId,
              title: 'Account permanently restricted',
              message: 'Due to repeated violations, your account has been permanently restricted. Contact support to appeal.',
              type: 'warning',
              link: '/support',
            })

            results.autoRestricted++
          }
          continue
        }

        // 2-3 violations: warning notification only (first offense handled elsewhere)
        if (vCount >= 2 && vCount < 4) {
          const { data: recentWarning } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', userId)
            .ilike('title', '%violation warning%')
            .gte('created_at', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .limit(1)

          if (!recentWarning?.length) {
            await supabase.from('notifications').insert({
              user_id: userId,
              title: 'Violation warning ⚠️',
              message: `You have ${vCount} violations in the past 30 days. Further violations may result in account restriction.`,
              type: 'warning',
              link: '/support',
            })
            results.autoRestricted++
          }
        }
      }
    }

    console.log('Job lifecycle results:', results)

    return new Response(JSON.stringify(results), {
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