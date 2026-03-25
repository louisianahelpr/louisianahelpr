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
      autoReleaseReminders: 0,
      suspiciousFlagged: 0,
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

    // ── 2b. NOTIFY POSTER TO CONFIRM START ON SCHEDULED DATE ──
    // Jobs in "accepted" status where helper confirmed and date_needed is today or past
    // Instead of auto-starting, notify poster to confirm the job has started
    const { data: acceptedJobsToStart } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id')
      .eq('status', 'accepted')
      .not('helper_id', 'is', null)
      .not('helper_confirmed_at', 'is', null)
      .lte('date_needed', todayStr)

    if (acceptedJobsToStart) {
      for (const job of acceptedJobsToStart) {
        // Check if we already created a start_request checkin for this job (avoid duplicates)
        const { data: existingCheckin } = await supabase
          .from('job_checkins')
          .select('id')
          .eq('job_id', job.id)
          .eq('type', 'start_request')
          .limit(1)

        if (existingCheckin && existingCheckin.length > 0) continue

        // Create start request checkin
        if (job.helper_id) {
          await supabase.from('job_checkins').insert({
            job_id: job.id,
            user_id: job.helper_id,
            type: 'start_request',
            note: 'Auto-triggered: scheduled job date reached',
          })
        }
        
        // Notify poster to confirm start
        await supabase.from('notifications').insert({
          user_id: job.customer_id,
          title: '📅 Job day is here!',
          message: `"${job.title}" is scheduled for today. Please confirm the job has started.`,
          type: 'info',
          link: '/activity?tab=posted&filter=accepted',
        })

        // Notify helper
        if (job.helper_id) {
          await supabase.from('notifications').insert({
            user_id: job.helper_id,
            title: '📅 Job day is here!',
            message: `"${job.title}" is scheduled for today. Waiting for the poster to confirm start.`,
            type: 'info',
            link: '/activity?tab=applied&filter=accepted',
          })
        }
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
        // Schedule payout so process-scheduled-payouts picks it up
        const payoutTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
        await supabase
          .from('jobs')
          .update({
            status: 'completed',
            payment_status: 'payout_pending',
            payout_scheduled_at: payoutTime,
          })
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
            message: `"${job.title}" has been automatically marked complete. Payment will be transferred in 24 hours.`,
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


    // ── 8. AUTO-RELEASE REMINDERS ──
    // Notify posters at 24h and 44h into the 48h auto-release window
    const twentyFourHoursAgo2 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString()
    
    // Jobs where one party marked complete 24h+ ago (approaching auto-release)
    const { data: pendingReleaseJobs } = await supabase
      .from('jobs')
      .select('id, title, customer_id, helper_id, poster_completed_at, helper_completed_at')
      .in('status', ['in_progress', 'revision_requested'])
      .eq('payment_status', 'escrow')
      .or(`poster_completed_at.lte.${twentyFourHoursAgo2},helper_completed_at.lte.${twentyFourHoursAgo2}`)

    if (pendingReleaseJobs) {
      for (const job of pendingReleaseJobs) {
        // Determine which timestamp to use
        const completedAt = job.poster_completed_at || job.helper_completed_at
        if (!completedAt) continue
        
        const completedTime = new Date(completedAt).getTime()
        const hoursElapsed = (now.getTime() - completedTime) / (1000 * 60 * 60)
        
        // Send at ~24h mark
        if (hoursElapsed >= 23 && hoursElapsed < 26) {
          const recipientId = job.poster_completed_at && !job.helper_completed_at 
            ? job.helper_id 
            : !job.poster_completed_at && job.helper_completed_at 
            ? job.customer_id 
            : null
          
          if (recipientId) {
            const { data: existing } = await supabase
              .from('notifications')
              .select('id')
              .eq('user_id', recipientId)
              .ilike('title', '%auto-complete in%')
              .gte('created_at', new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString())
              .limit(1)
            
            if (!existing?.length) {
              await supabase.from('notifications').insert({
                user_id: recipientId,
                title: '⏰ Job will auto-complete in ~24 hours',
                message: `"${job.title}" will be automatically marked complete if you don't respond. If there's an issue, dispute now.`,
                type: 'warning',
                link: '/activity',
              })
              results.autoReleaseReminders++
            }
          }
        }
        
        // Send at ~44h mark (final warning)
        if (hoursElapsed >= 43 && hoursElapsed < 46) {
          const recipientId = job.poster_completed_at && !job.helper_completed_at 
            ? job.helper_id 
            : !job.poster_completed_at && job.helper_completed_at 
            ? job.customer_id 
            : null
          
          if (recipientId) {
            const { data: existing } = await supabase
              .from('notifications')
              .select('id')
              .eq('user_id', recipientId)
              .ilike('title', '%FINAL%auto-complete%')
              .gte('created_at', new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString())
              .limit(1)
            
            if (!existing?.length) {
              await supabase.from('notifications').insert({
                user_id: recipientId,
                title: '🚨 FINAL: Job will auto-complete in ~4 hours',
                message: `"${job.title}" will auto-complete and payment will be released very soon. Dispute NOW if there's a problem.`,
                type: 'warning',
                link: '/activity',
              })
              results.autoReleaseReminders++
            }
          }
        }
      }
    }

    // ── 9. SUSPICIOUS PATTERN DETECTION ──
    // Flag helpers who complete jobs unusually fast
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    
    const { data: recentCompletions } = await supabase
      .from('jobs')
      .select('id, title, helper_id, estimated_hours, status, updated_at, created_at')
      .eq('status', 'completed')
      .not('helper_id', 'is', null)
      .gte('updated_at', sixHoursAgo)

    if (recentCompletions) {
      for (const job of recentCompletions) {
        if (!job.helper_id || !job.estimated_hours) continue
        
        // Check if job was completed in less than 25% of estimated time
        const { data: startCheckin } = await supabase
          .from('job_checkins')
          .select('created_at')
          .eq('job_id', job.id)
          .eq('user_id', job.helper_id)
          .eq('type', 'start_request')
          .order('created_at', { ascending: true })
          .limit(1)
        
        if (startCheckin?.length) {
          const startTime = new Date(startCheckin[0].created_at).getTime()
          const completeTime = new Date(job.updated_at).getTime()
          const actualMinutes = (completeTime - startTime) / (1000 * 60)
          const estimatedMinutes = job.estimated_hours * 60
          
          // If completed in less than 25% of estimated time (e.g., 4hr job done in <1hr)
          if (actualMinutes < estimatedMinutes * 0.25 && estimatedMinutes >= 60) {
            // Check if already flagged
            const { data: existingFlag } = await supabase
              .from('fraud_flags')
              .select('id')
              .eq('job_id', job.id)
              .eq('flag_type', 'suspicious_speed')
              .limit(1)
            
            if (!existingFlag?.length) {
              await supabase.from('fraud_flags').insert({
                user_id: job.helper_id,
                job_id: job.id,
                flag_type: 'suspicious_speed',
                details: `Completed "${job.title}" in ${Math.round(actualMinutes)} min (estimated ${Math.round(estimatedMinutes)} min — ${Math.round(actualMinutes / estimatedMinutes * 100)}% of estimate)`,
              })
              
              // Notify admins
              const { data: adminRoles } = await supabase
                .from('user_roles')
                .select('user_id')
                .eq('role', 'admin')
              
              if (adminRoles) {
                await supabase.from('notifications').insert(
                  adminRoles.map(a => ({
                    user_id: a.user_id,
                    title: '🚩 Suspicious fast completion',
                    message: `"${job.title}" completed in ${Math.round(actualMinutes)} min (est. ${job.estimated_hours}h). Review for potential fraud.`,
                    type: 'warning',
                    link: '/admin?tab=reports',
                  }))
                )
              }
              results.suspiciousFlagged++
            }
          }
        }
      }
      
      // Also flag helpers with high dispute rates (3+ disputes in 30 days)
      const thirtyDaysAgo2 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: disputedJobs } = await supabase
        .from('jobs')
        .select('helper_id')
        .eq('status', 'disputed')
        .not('helper_id', 'is', null)
        .gte('disputed_at', thirtyDaysAgo2)
      
      if (disputedJobs) {
        const disputeCounts: Record<string, number> = {}
        for (const j of disputedJobs) {
          if (j.helper_id) disputeCounts[j.helper_id] = (disputeCounts[j.helper_id] || 0) + 1
        }
        
        for (const [helperId, count] of Object.entries(disputeCounts)) {
          if (count < 3) continue
          
          const { data: existingFlag } = await supabase
            .from('fraud_flags')
            .select('id')
            .eq('user_id', helperId)
            .eq('flag_type', 'high_dispute_rate')
            .gte('created_at', thirtyDaysAgo2)
            .limit(1)
          
          if (!existingFlag?.length) {
            await supabase.from('fraud_flags').insert({
              user_id: helperId,
              flag_type: 'high_dispute_rate',
              details: `${count} disputed jobs in the past 30 days`,
            })
            
            const { data: adminRoles } = await supabase
              .from('user_roles')
              .select('user_id')
              .eq('role', 'admin')
            
            if (adminRoles) {
              await supabase.from('notifications').insert(
                adminRoles.map(a => ({
                  user_id: a.user_id,
                  title: '🚩 High dispute rate helper',
                  message: `A helper has ${count} disputed jobs in 30 days. Consider reviewing their account.`,
                  type: 'warning',
                  link: '/admin?tab=reports',
                }))
              )
            }
            results.suspiciousFlagged++
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