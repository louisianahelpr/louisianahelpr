import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Get all Pro+ helpers with active subscriptions
    const { data: helpers, error: helpersError } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
      .eq("role", "helper")
      .eq("approval_status", "approved")
      .in("subscription_tier", ["pro", "elite"]);

    if (helpersError) throw helpersError;
    if (!helpers || helpers.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No Pro+ helpers found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoISO = weekAgo.toISOString();

    // Filter out expired subscriptions
    const activeHelpers = helpers.filter(h => {
      if (!h.subscription_expires_at) return true;
      return new Date(h.subscription_expires_at) > now;
    });

    let sent = 0;

    for (const helper of activeHelpers) {
      // Gather weekly stats
      const [jobsRes, reviewsRes, earningsRes, appsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, budget, platform_fee_amount, urgent_fee, status")
          .eq("helper_id", helper.user_id)
          .eq("status", "completed")
          .gte("updated_at", weekAgoISO),
        supabase
          .from("reviews")
          .select("rating")
          .eq("reviewee_id", helper.user_id)
          .gte("created_at", weekAgoISO),
        supabase
          .from("jobs")
          .select("budget, platform_fee_amount, urgent_fee")
          .eq("helper_id", helper.user_id)
          .eq("status", "completed")
          .gte("updated_at", weekAgoISO),
        supabase
          .from("applications")
          .select("id")
          .eq("helper_id", helper.user_id)
          .gte("created_at", weekAgoISO),
      ]);

      const completedJobs = jobsRes.data?.length || 0;
      const newReviews = reviewsRes.data?.length || 0;
      const avgNewRating = newReviews > 0
        ? (reviewsRes.data!.reduce((s, r) => s + r.rating, 0) / newReviews).toFixed(1)
        : "N/A";
      const weeklyEarnings = (earningsRes.data || []).reduce((sum, j) => {
        const fee = j.platform_fee_amount || 0;
        const feeTax = fee * 0.085;
        return sum + (j.budget - fee - feeTax + (j.urgent_fee ?? 0));
      }, 0);
      const applicationsSubmitted = appsRes.data?.length || 0;

      // Send as in-app notification (email would require email infrastructure)
      const message = [
        `📊 Your Weekly Report (${weekAgo.toLocaleDateString()} – ${now.toLocaleDateString()})`,
        ``,
        `💰 Earnings: $${weeklyEarnings.toFixed(2)}`,
        `✅ Jobs Completed: ${completedJobs}`,
        `📝 Applications Sent: ${applicationsSubmitted}`,
        `⭐ New Reviews: ${newReviews}${newReviews > 0 ? ` (avg ${avgNewRating})` : ""}`,
        ``,
        completedJobs === 0
          ? "Keep applying — your next gig is around the corner! 💪"
          : "Great week! Keep up the momentum! 🔥",
      ].join("\n");

      await supabase.from("notifications").insert({
        user_id: helper.user_id,
        title: "📊 Weekly Performance Report",
        message,
        type: "info",
        link: "/profile?tab=earnings",
      });

      sent++;
    }

    return new Response(
      JSON.stringify({ sent, total: activeHelpers.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Weekly report error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
