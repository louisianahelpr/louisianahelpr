import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";

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
    // Authenticate — REQUIRED. An unauthenticated caller must never be able
    // to trigger a platform-wide notification fan-out for an arbitrary job
    // (spam vector + leaks targeted offers into the open pool).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseAuth = createClient(supabaseUrl, (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseAuth.auth.getUser(token);
    const callerId = userData?.user?.id || null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { jobId } = await req.json();
    if (!jobId) throw new Error("Missing jobId");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get the job details — include urgency so we can decide whether
    // this match goes out immediately (urgent) or rolls into the daily
    // digest (everything else, for users who opt in). Only OPEN jobs are
    // matchable, and a job with a pending direct offer is private to its
    // targeted helper — it must never be blasted to the open pool.
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, title, category, location, budget, customer_id, is_urgent")
      .eq("id", jobId)
      .eq("status", "open")
      // Same visibility rule as get_public_open_jobs: hidden while a direct
      // offer is pending; matchable again once it resolves (declined/expired).
      .or("offered_to_helper_id.is.null,direct_offer_status.neq.pending")
      .maybeSingle();

    if (jobError || !job) throw new Error("Job not found or not eligible for matching");

    // Verify the caller owns the job — always, not just when a token happened
    // to be attached.
    if (callerId !== job.customer_id) {
      return new Response(JSON.stringify({ error: "Not authorized to trigger match for this job" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    // Tiny category emoji map — surfaces a glanceable icon in the push
    // notification title so users can identify the work type without
    // reading. Keeps the brand-voiced "Match for you" framing.
    const categoryEmoji: Record<string, string> = {
      cleaning: "🧹",
      yard_work: "🌿",
      moving: "📦",
      errands: "🛒",
      handyman: "🔧",
      painting: "🎨",
      delivery: "🚚",
      pet_care: "🐾",
      assembly: "🪛",
      other: "✨",
    };
    const emoji = categoryEmoji[job.category] ?? "✨";

    // Smart batching: pull each scored helper's notification preference
    // and route non-urgent matches to a pending bucket (job_match_pending)
    // when they opted into "digest" mode. Urgent jobs always fire
    // immediately regardless of preference.
    const scoredIds = scored.map((h) => h.user_id);
    let digestMap = new Map<string, boolean>();
    if (scoredIds.length > 0) {
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("user_id, match_digest_mode")
        .in("user_id", scoredIds);
      digestMap = new Map(
        (prefs ?? []).map((p: { user_id: string; match_digest_mode: boolean | null }) =>
          [p.user_id, !!p.match_digest_mode] as const,
        ),
      );
    }

    const immediate: typeof scored = [];
    const deferred: typeof scored = [];
    for (const h of scored) {
      const digest = digestMap.get(h.user_id) ?? false;
      if (job.is_urgent || !digest) {
        immediate.push(h);
      } else {
        deferred.push(h);
      }
    }

    // Immediate fan-out — full push notification.
    if (immediate.length > 0) {
      const { error: notifyErr } = await supabase.from("notifications").insert(
        immediate.map((h) => ({
          user_id: h.user_id,
          // Category emoji in the title for faster glance recognition.
          title: `${emoji} Match for you${job.is_urgent ? " · Urgent" : ""}`,
          message: `${job.title} in ${job.location} · $${job.budget}. Tap to review and apply.`,
          type: "job_match",
          link: `/dashboard?quickApply=${job.id}`,
          read: false,
        })),
      );
      if (notifyErr) throw notifyErr;
    }

    // Deferred — write to a queue table the daily-match-digest cron
    // reads from. Schema: (user_id, job_id, created_at). Idempotent
    // dedupe at write time via upsert on (user_id, job_id).
    if (deferred.length > 0) {
      const { error: queueErr } = await supabase.from("match_digest_queue").upsert(
        deferred.map((h) => ({
          user_id: h.user_id,
          job_id: job.id,
          created_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,job_id", ignoreDuplicates: true },
      );
      // Queue failure is non-fatal — log + continue. We'd rather have
      // some users miss a digest entry than block the match endpoint.
      if (queueErr) console.warn("match_digest_queue upsert failed:", queueErr.message);
    }

    return new Response(
      JSON.stringify({
        notified: immediate.length,
        queued_for_digest: deferred.length,
        matchedHelpers: scored.map((h) => h.user_id),
      }),
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
