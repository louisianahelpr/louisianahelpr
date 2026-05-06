import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit: 20 requests per minute per IP
  const { allowed, remaining, retryAfter } = await checkRateLimit(req, {
    windowMs: 60_000, maxRequests: 20, keyPrefix: "instant-job-match",
  });
  if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    let callerId: string | null = null;

    if (authHeader) {
      const supabaseAuth = createClient(supabaseUrl, (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabaseAuth.auth.getUser(token);
      callerId = userData?.user?.id || null;
    }

    const { jobId } = await req.json();
    if (!jobId) throw new Error("Missing jobId");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get the job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, title, category, location, budget, customer_id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) throw new Error("Job not found");

    // Verify the caller owns the job (if authenticated)
    if (callerId && callerId !== job.customer_id) {
      throw new Error("Not authorized to trigger match for this job");
    }

    // Match-eligible users: anyone approved + not banned. After today's
    // unified-user model shift, role-based filtering ('helper' / 'customer')
    // is dead — every signup gets role='customer' now, so the previous
    // .eq('role', 'helper') filter would have returned ZERO users for any
    // job posted after the migration. Same for the Elite-only filter at
    // current scale (likely 0 Elite subscribers).
    //
    // New filter: approved, non-banned, not the poster. Tier-priority
    // (Elite gets matched first / more aggressively) can come back as a
    // sort dimension once the user base actually splits across tiers.
    const { data: helpers, error: helpersError } = await supabase
      .from("profiles")
      .select("user_id, full_name, skills, location, subscription_tier, subscription_expires_at, ban_status")
      .eq("approval_status", "approved")
      .neq("user_id", job.customer_id);

    if (helpersError) throw helpersError;

    const now = new Date().toISOString();
    const activeHelpers = (helpers || []).filter((h) => {
      // Skip banned users (any non-active status).
      if (h.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(h.ban_status)) return false;
      // Drop expired-tier filter — at current scale we notify everyone
      // who scores above zero, regardless of tier. Re-add as a sort
      // boost once tiers are populated.
      return true;
    });
    if (activeHelpers.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobLocation = job.location.toLowerCase();
    const jobCategory = job.category.toLowerCase();

    // Score helpers by relevance
    const scored = activeHelpers
      .map((h) => {
        let score = 0;
        const helperLoc = (h.location || "").toLowerCase();
        const helperSkills = (h.skills || "").toLowerCase().split(",").map((s: string) => s.trim());

        // Location match
        if (helperLoc && (jobLocation.includes(helperLoc) || helperLoc.includes(jobLocation))) {
          score += 3;
        }
        // Category/skills match
        if (helperSkills.some((s: string) => jobCategory.includes(s) || s.includes(jobCategory))) {
          score += 2;
        }
        // Title keyword match
        if (helperSkills.some((s: string) => job.title.toLowerCase().includes(s))) {
          score += 1;
        }
        return { ...h, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => {
        // Tie-break score by tier: Elite > Pro > Basic > none.
        if (b.score !== a.score) return b.score - a.score;
        const tierRank: Record<string, number> = { elite: 3, pro: 2, basic: 1 };
        return (tierRank[b.subscription_tier ?? ""] ?? 0) - (tierRank[a.subscription_tier ?? ""] ?? 0);
      })
      .slice(0, 20); // Top 20 matches

    if (scored.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk INSERT instead of awaiting per row. The trigger fan_out_push_on_notification
    // fires per-row and pushes to mobile, so this is also kinder to the cron.
    const { error: notifyErr } = await supabase.from("notifications").insert(
      scored.map((h) => ({
        user_id: h.user_id,
        title: "🔥 New job match!",
        message: `"${job.title}" ($${job.budget}) in ${job.location} — Quick Apply now!`,
        type: "job_match",
        link: `/dashboard?quickApply=${job.id}`,
        read: false,
      })),
    );
    if (notifyErr) throw notifyErr;

    return new Response(
      JSON.stringify({ notified: scored.length, matchedHelpers: scored.map((h) => h.user_id) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Instant match error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
