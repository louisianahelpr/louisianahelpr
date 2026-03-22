import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find accepted jobs where updated_at is older than 24h (meaning they were accepted 24h+ ago but never started)
    const { data: expiredJobs, error: fetchError } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id")
      .eq("status", "accepted")
      .lt("updated_at", twentyFourHoursAgo);

    if (fetchError) throw fetchError;

    if (!expiredJobs || expiredJobs.length === 0) {
      return new Response(JSON.stringify({ message: "No expired jobs found", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let expiredCount = 0;

    for (const job of expiredJobs) {
      // Reset job to open, remove helper
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ status: "open", helper_id: null })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Failed to expire job ${job.id}:`, updateError);
        continue;
      }

      // Reject the accepted application
      await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("job_id", job.id)
        .eq("status", "accepted");

      // Notify the customer
      await supabase.from("notifications").insert({
        user_id: job.customer_id,
        title: "Job re-opened",
        message: `"${job.title}" was automatically re-opened because the helpr didn't start within 24 hours.`,
        type: "warning",
        link: "/activity?tab=posted&filter=open",
      });

      // Notify the helper
      if (job.helper_id) {
        await supabase.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job expired",
          message: `You didn't start "${job.title}" within 24 hours. The job has been re-opened for other helprs.`,
          type: "warning",
          link: "/activity",
        });
      }

      expiredCount++;
    }

    return new Response(
      JSON.stringify({ message: `Expired ${expiredCount} jobs`, count: expiredCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auto-expire error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
