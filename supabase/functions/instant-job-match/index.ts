import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  try {
    const { jobId } = await req.json();
    if (!jobId) throw new Error("Missing jobId");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get the job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, title, category, location, budget, customer_id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) throw new Error("Job not found");

    // Find approved helpers matching by location or category/skills
    const { data: helpers, error: helpersError } = await supabase
      .from("profiles")
      .select("user_id, full_name, skills, location")
      .eq("role", "helper")
      .eq("approval_status", "approved")
      .neq("user_id", job.customer_id);

    if (helpersError) throw helpersError;
    if (!helpers || helpers.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobLocation = job.location.toLowerCase();
    const jobCategory = job.category.toLowerCase();

    // Score helpers by relevance
    const scored = helpers
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
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Top 10 matches

    let notified = 0;

    for (const helper of scored) {
      await supabase.from("notifications").insert({
        user_id: helper.user_id,
        title: "🔥 New job match!",
        message: `"${job.title}" ($${job.budget}) in ${job.location} — Quick Apply now!`,
        type: "job_match",
        link: `/dashboard?quickApply=${job.id}`,
      });
      notified++;
    }

    return new Response(
      JSON.stringify({ notified, matchedHelpers: scored.map((h) => h.user_id) }),
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
