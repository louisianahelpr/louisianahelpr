import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all helper profiles with skills and location
    const { data: helpers, error: helpersError } = await supabase
      .from("profiles")
      .select("user_id, full_name, skills, location")
      .eq("role", "helper")
      .eq("approval_status", "approved");

    if (helpersError) throw helpersError;

    // Get open jobs from the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentJobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, title, category, location, budget, date_needed")
      .eq("status", "open")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false });

    if (jobsError) throw jobsError;
    if (!recentJobs || recentJobs.length === 0 || !helpers || helpers.length === 0) {
      return new Response(JSON.stringify({ message: "No matches to process", notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let notifiedCount = 0;

    for (const helper of helpers) {
      const helperSkills = (helper.skills || "").toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
      const helperLocation = (helper.location || "").toLowerCase();

      // Match jobs by location or skills/category
      const matchedJobs = recentJobs.filter(job => {
        const locationMatch = helperLocation && job.location.toLowerCase().includes(helperLocation);
        const categoryMatch = helperSkills.some(skill => 
          job.category.includes(skill) || job.title.toLowerCase().includes(skill)
        );
        return locationMatch || categoryMatch;
      }).slice(0, 5);

      if (matchedJobs.length === 0) continue;

      // Create in-app notification
      const jobList = matchedJobs.map(j => `"${j.title}" ($${j.budget})`).join(", ");
      await supabase.from("notifications").insert({
        user_id: helper.user_id,
        title: `${matchedJobs.length} new job${matchedJobs.length > 1 ? "s" : ""} matching your profile`,
        message: `Jobs near you: ${jobList}`,
        type: "info",
        link: "/dashboard",
      });

      notifiedCount++;
    }

    return new Response(
      JSON.stringify({ message: `Notified ${notifiedCount} helpers`, notified: notifiedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Job match error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
