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

    const now = new Date().toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString().split("T")[0];

    // 1. Expire accepted jobs that were accepted 24h+ ago but never started
    const { data: staleAccepted, error: fetchError } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id")
      .eq("status", "accepted")
      .lt("updated_at", twentyFourHoursAgo);

    if (fetchError) throw fetchError;

    let expiredCount = 0;

    for (const job of staleAccepted || []) {
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ status: "open", helper_id: null })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Failed to expire job ${job.id}:`, updateError);
        continue;
      }

      await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("job_id", job.id)
        .eq("status", "accepted");

      await supabase.from("notifications").insert({
        user_id: job.customer_id,
        title: "Job re-opened",
        message: `"${job.title}" was automatically re-opened because the helpr didn't start within 24 hours.`,
        type: "warning",
        link: "/activity?tab=posted&filter=open",
      });

      if (job.helper_id) {
        await supabase.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job expired",
          message: `You didn't start "${job.title}" within 24 hours. The job has been re-opened for other helprs.`,
          type: "warning",
          link: "/activity?tab=applied&filter=not_selected",
        });
      }

      expiredCount++;
    }

    // 2. Auto-cancel open jobs whose expires_at has passed OR date_needed is in the past
    const { data: expiredByTime, error: expTimeErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id")
      .eq("status", "open")
      .not("expires_at", "is", null)
      .lt("expires_at", now);

    if (expTimeErr) throw expTimeErr;

    const { data: expiredByDate, error: expDateErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id")
      .eq("status", "open")
      .is("expires_at", null)
      .lt("date_needed", today);

    if (expDateErr) throw expDateErr;

    // Merge and deduplicate
    const allExpired = [...(expiredByTime || []), ...(expiredByDate || [])];
    const seen = new Set<string>();
    let cancelledCount = 0;

    for (const job of allExpired) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);

      const { error: cancelError } = await supabase
        .from("jobs")
        .update({
          status: "cancelled",
          cancelled_at: now,
          cancellation_reason: "Job listing expired — scheduled time passed with no helper assigned",
        })
        .eq("id", job.id);

      if (cancelError) {
        console.error(`Failed to cancel expired job ${job.id}:`, cancelError);
        continue;
      }

      await supabase.from("notifications").insert({
        user_id: job.customer_id,
        title: "Job auto-cancelled",
        message: `"${job.title}" was automatically cancelled because the scheduled time passed without a helpr being assigned. You can repost anytime.`,
        type: "warning",
        link: "/post-job",
      });

      cancelledCount++;
    }

    return new Response(
      JSON.stringify({
        message: `Expired ${expiredCount} accepted jobs, cancelled ${cancelledCount} past-time open jobs`,
        expiredCount,
        cancelledCount,
      }),
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
