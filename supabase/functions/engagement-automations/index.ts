import { createClient } from 'npm:@supabase/supabase-js@2'

const SITE_NAME = "Helpr"
const SENDER_DOMAIN = "notify.louisianahelpr.com"
const FROM_DOMAIN = "louisianahelpr.com"
const ROOT_DOMAIN = "louisianahelpr.com"
const SITE_URL = `https://${ROOT_DOMAIN}`

// ─── Email Templates ──────────────────────────────────────────────

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background-color:#ffffff;font-family:'DM Sans',Arial,sans-serif;margin:0;padding:0">
<div style="padding:32px 28px;max-width:480px;margin:0 auto">
  <p style="font-size:28px;font-weight:bold;color:hsl(158,45%,42%);margin:0 0 24px;font-family:'Fraunces',Georgia,serif">Helpr</p>
  ${content}
  <p style="font-size:12px;color:hsl(160,6%,65%);margin:32px 0 0;padding:16px 0 0;border-top:1px solid hsl(150,12%,90%)">
    You're receiving this because you signed up at ${ROOT_DOMAIN}.
  </p>
</div></body></html>`
}

function btn(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background-color:hsl(158,45%,42%);color:#ffffff;font-size:15px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">${text}</a>`
}

const p = (t: string) => `<p style="font-size:15px;color:hsl(160,6%,50%);line-height:1.6;margin:0 0 16px">${t}</p>`
const h1 = (t: string) => `<h1 style="font-size:22px;font-weight:bold;color:hsl(160,10%,12%);margin:0 0 16px">${t}</h1>`

// Welcome drip step 1: Complete your profile (Day 1)
function dripStep1(name: string) {
  const subject = "Get the most out of Helpr — complete your profile ✨"
  const html = wrapEmail(`
    ${h1("Let's get you set up!")}
    ${p(`Hey ${name || "there"}, welcome to Helpr! 🎉`)}
    ${p("To get the best experience — whether you're posting tasks or looking to earn — take a minute to fill in your profile. Add your location, a photo, and a short bio.")}
    ${btn("Complete Your Profile", `${SITE_URL}/profile`)}
    ${p("A complete profile helps build trust and gets you matched faster.")}
  `)
  const text = `Hey ${name || "there"}, welcome to Helpr! Complete your profile to get matched faster: ${SITE_URL}/profile`
  return { subject, html, text }
}

// Welcome drip step 2: Explore the platform (Day 3)
function dripStep2(name: string) {
  const subject = "Ready to explore? Here's how Helpr works 🔍"
  const html = wrapEmail(`
    ${h1("Explore what Helpr has to offer")}
    ${p(`Hey ${name || "there"}, now that you're set up, here's what you can do:`)}
    <ul style="font-size:15px;color:hsl(160,6%,50%);line-height:1.8;padding-left:20px;margin:0 0 16px">
      <li><strong>Post a task</strong> — describe what you need, set a budget, and get help fast</li>
      <li><strong>Browse jobs</strong> — find tasks near you and start earning</li>
      <li><strong>Chat directly</strong> — message before committing</li>
    </ul>
    ${btn("Go to Dashboard", `${SITE_URL}/dashboard`)}
  `)
  const text = `Hey ${name || "there"}, explore what Helpr has to offer! Post tasks, browse jobs, and chat with others. Visit: ${SITE_URL}/dashboard`
  return { subject, html, text }
}

// Welcome drip step 3: Tips for success (Day 7)
function dripStep3(name: string) {
  const subject = "Pro tips for getting the most out of Helpr 💪"
  const html = wrapEmail(`
    ${h1("Tips from the community")}
    ${p(`Hey ${name || "there"}, here are some quick tips from successful Helpr users:`)}
    <ol style="font-size:15px;color:hsl(160,6%,50%);line-height:1.8;padding-left:20px;margin:0 0 16px">
      <li><strong>Be specific</strong> — detailed descriptions attract better matches</li>
      <li><strong>Respond quickly</strong> — fast replies lead to faster help</li>
      <li><strong>Leave reviews</strong> — help the community grow by sharing feedback</li>
      <li><strong>Stay safe</strong> — always communicate through the platform</li>
    </ol>
    ${btn("Start Now", `${SITE_URL}/dashboard`)}
    ${p("We're here if you need anything. Happy Helpr-ing! 🤝")}
  `)
  const text = `Hey ${name || "there"}, pro tips: Be specific, respond quickly, leave reviews, stay safe. Start now: ${SITE_URL}/dashboard`
  return { subject, html, text }
}

// Re-engagement email
function reEngagementEmail(name: string) {
  const subject = "We miss you! New tasks are waiting on Helpr 👋"
  const html = wrapEmail(`
    ${h1("New tasks are waiting for you!")}
    ${p(`Hey ${name || "there"}, it's been a while since we've seen you on Helpr.`)}
    ${p("There are new tasks posted in your area — whether you're looking for help or looking to earn, now's a great time to check in.")}
    ${btn("See What's New", `${SITE_URL}/dashboard`)}
    ${p("We'd love to have you back. 💚")}
  `)
  const text = `Hey ${name || "there"}, it's been a while! New tasks are waiting on Helpr. Check them out: ${SITE_URL}/dashboard`
  return { subject, html, text }
}

// Admin digest email
function adminDigestEmail(stats: {
  newUsers: number
  newJobs: number
  completedJobs: number
  pendingApprovals: number
  openReports: number
  revenue: number
}) {
  const subject = `Helpr Daily Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  const stat = (label: string, value: string | number) =>
    `<tr><td style="padding:8px 0;font-size:15px;color:hsl(160,6%,50%);border-bottom:1px solid hsl(150,12%,92%)">${label}</td><td style="padding:8px 0;font-size:15px;font-weight:bold;color:hsl(160,10%,12%);text-align:right;border-bottom:1px solid hsl(150,12%,92%)">${value}</td></tr>`

  const html = wrapEmail(`
    ${h1("📊 Daily Digest")}
    ${p(`Here's your platform summary for ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}:`)}
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      ${stat("New signups", stats.newUsers)}
      ${stat("Jobs posted", stats.newJobs)}
      ${stat("Jobs completed", stats.completedJobs)}
      ${stat("Pending approvals", stats.pendingApprovals)}
      ${stat("Open reports", stats.openReports)}
      ${stat("Revenue (fees)", `$${stats.revenue.toFixed(2)}`)}
    </table>
    ${btn("Open Admin Dashboard", `${SITE_URL}/admin`)}
  `)
  const text = `Helpr Daily Digest: ${stats.newUsers} new users, ${stats.newJobs} new jobs, ${stats.completedJobs} completed, ${stats.pendingApprovals} pending approvals, ${stats.openReports} reports, $${stats.revenue.toFixed(2)} revenue. View: ${SITE_URL}/admin`
  return { subject, html, text }
}

// ─── Main Handler ──────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const results = { drip: 0, approvalResend: 0, reEngagement: 0, adminDigest: 0, errors: [] as string[] }

  try {
    // ─── 1. Welcome Drip Sequence ─────────────────────────────────
    const now = new Date()

    // Get users who haven't completed the drip (step < 3)
    const { data: dripUsers } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, drip_step, last_drip_at, created_at')
      .lt('drip_step', 3)
      .not('email', 'is', null)

    for (const user of dripUsers || []) {
      const signupDate = new Date(user.created_at)
      const daysSinceSignup = (now.getTime() - signupDate.getTime()) / (1000 * 60 * 60 * 24)

      // Determine which step to send based on days since signup
      let targetStep = -1
      if (user.drip_step === 0 && daysSinceSignup >= 1) targetStep = 1
      else if (user.drip_step === 1 && daysSinceSignup >= 3) targetStep = 2
      else if (user.drip_step === 2 && daysSinceSignup >= 7) targetStep = 3

      if (targetStep === -1) continue

      // Don't send more than once per day
      if (user.last_drip_at) {
        const hoursSinceLastDrip = (now.getTime() - new Date(user.last_drip_at).getTime()) / (1000 * 60 * 60)
        if (hoursSinceLastDrip < 20) continue
      }

      const templateFn = targetStep === 1 ? dripStep1 : targetStep === 2 ? dripStep2 : dripStep3
      const { subject, html, text } = templateFn(user.full_name || '')
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: `welcome_drip_step_${targetStep}`,
        recipient_email: user.email,
        status: 'pending',
      })

      const { error: enqueueErr } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: user.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: `welcome_drip_step_${targetStep}`,
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        results.errors.push(`Drip failed for ${user.email}: ${enqueueErr.message}`)
        continue
      }

      await supabase.from('profiles').update({
        drip_step: targetStep,
        last_drip_at: now.toISOString(),
      }).eq('user_id', user.user_id)

      results.drip++
    }

    // ─── 1b. Auto-resend Approval Emails ─────────────────────────
    // Approved users who haven't logged in, resend every 3 days up to 3 emails total
    const { data: approvedUsers } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, approval_email_count, last_approval_email_at')
      .eq('approval_status', 'approved')
      .lt('approval_email_count', 3)
      .not('email', 'is', null)

    for (const user of approvedUsers || []) {
      const emailCount = user.approval_email_count || 0
      if (emailCount < 1) continue // First email sent on approval, skip if 0

      // Check if 3+ days since last approval email
      if (user.last_approval_email_at) {
        const daysSinceLast = (now.getTime() - new Date(user.last_approval_email_at).getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceLast < 3) continue
      }

      // Check if user has any activity (jobs, messages, recent profile update)
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const [jobsRes, msgsRes] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('customer_id', user.user_id),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', user.user_id),
      ])

      // If user has posted jobs or sent messages, they're active — stop resending
      if ((jobsRes.count || 0) > 0 || (msgsRes.count || 0) > 0) {
        await supabase.from('profiles').update({ approval_email_count: 3 }).eq('user_id', user.user_id)
        continue
      }

      const subject = emailCount === 1
        ? "Don't forget — your Helpr account is ready! 🎉"
        : "Your Helpr account is waiting for you 👋"

      const htmlContent = wrapEmail(`
        ${h1("Your account is approved!")}
        ${p(`Hey ${user.full_name || "there"}, just a reminder — your Helpr account has been approved and is ready to go!`)}
        ${p("Browse tasks, post jobs, or connect with people in your area. It only takes a minute to get started.")}
        ${btn("Browse Jobs", `${SITE_URL}/dashboard`)}
        ${p("We'd love to see you on the platform. 💚")}
      `)
      const textContent = `Hey ${user.full_name || "there"}, your Helpr account is approved! Browse jobs and get started: ${SITE_URL}/dashboard`

      const messageId = crypto.randomUUID()
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'approval_reminder',
        recipient_email: user.email,
        status: 'pending',
      })

      const { error: enqueueErr } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: user.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html: htmlContent,
          text: textContent,
          purpose: 'transactional',
          label: 'approval_reminder',
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        results.errors.push(`Approval resend failed for ${user.email}: ${enqueueErr.message}`)
        continue
      }

      await supabase.from('profiles').update({
        approval_email_count: emailCount + 1,
        last_approval_email_at: now.toISOString(),
      }).eq('user_id', user.user_id)

      results.approvalResend++
    }

    // ─── 2. Re-engagement Nudges ──────────────────────────────────
    // Users inactive for 14+ days (no job posted, no message, no login update)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Get users whose profile was last updated more than 14 days ago
    // and who completed the drip (step >= 3) so we don't overlap
    const { data: inactiveUsers } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, last_drip_at')
      .lt('updated_at', fourteenDaysAgo)
      .gt('updated_at', thirtyDaysAgo) // Don't nudge very old inactive accounts
      .gte('drip_step', 3)
      .not('email', 'is', null)

    for (const user of inactiveUsers || []) {
      // Only send re-engagement once every 14 days
      if (user.last_drip_at) {
        const daysSinceLastEmail = (now.getTime() - new Date(user.last_drip_at).getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceLastEmail < 14) continue
      }

      const { subject, html, text } = reEngagementEmail(user.full_name || '')
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 're_engagement',
        recipient_email: user.email,
        status: 'pending',
      })

      const { error: enqueueErr } = await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: user.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: 're_engagement',
          queued_at: now.toISOString(),
        },
      })

      if (enqueueErr) {
        results.errors.push(`Re-engagement failed for ${user.email}: ${enqueueErr.message}`)
        continue
      }

      // Update last_drip_at to track when we last emailed them
      await supabase.from('profiles').update({
        last_drip_at: now.toISOString(),
      }).eq('user_id', user.user_id)

      results.reEngagement++
    }

    // ─── 3. Admin Daily Digest ────────────────────────────────────
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    const [newUsersRes, newJobsRes, completedJobsRes, pendingRes, reportsRes, revenueRes, adminRolesRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', yesterday),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select('platform_fee_amount').eq('status', 'completed').gte('updated_at', yesterday),
      supabase.from('user_roles').select('user_id').eq('role', 'admin'),
    ])

    const revenue = (revenueRes.data || []).reduce((sum, j) => sum + (j.platform_fee_amount || 0), 0)

    const stats = {
      newUsers: newUsersRes.count || 0,
      newJobs: newJobsRes.count || 0,
      completedJobs: completedJobsRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      revenue,
    }

    // Send digest to all admins
    for (const adminRole of adminRolesRes.data || []) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', adminRole.user_id)
        .single()

      if (!adminProfile?.email) continue

      const { subject, html, text } = adminDigestEmail(stats)
      const messageId = crypto.randomUUID()

      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'admin_daily_digest',
        recipient_email: adminProfile.email,
        status: 'pending',
      })

      await supabase.rpc('enqueue_email', {
        queue_name: 'transactional_emails',
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: adminProfile.email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: 'transactional',
          label: 'admin_daily_digest',
          queued_at: now.toISOString(),
        },
      })

      results.adminDigest++
    }
  } catch (err) {
    results.errors.push(err.message)
    console.error('Engagement automation error:', err)
  }

  console.log('Engagement automations completed:', results)

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
})
