import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find disputed jobs past their 72-hour deadline
    const { data: expiredDisputes, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, dispute_reason, disputed_at, dispute_deadline, dispute_status")
      .eq("status", "disputed")
      .not("dispute_deadline", "is", null)
      .lte("dispute_deadline", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    const resolved: string[] = [];

    for (const job of expiredDisputes || []) {
      const disputeStatus = job.dispute_status || "open";

      // If escalated to admin, don't auto-resolve — admin must handle it
      if (disputeStatus === "escalated") {
        // Just send a reminder to admins
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabase.from("notifications").insert({
              user_id: admin.user_id,
              title: "⏰ Escalated dispute overdue",
              message: `"${job.title}" dispute was escalated and is past its 72h deadline. Please resolve ASAP.`,
              type: "warning",
              link: "/admin",
            });
          }
        }
        continue;
      }

      // Non-escalated: auto-release payment to helper
      const { error: updateErr } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          dispute_status: "auto_resolved",
          dispute_resolved_at: new Date().toISOString(),
          dispute_reason: `[AUTO-RESOLVED] Original: ${job.dispute_reason || "N/A"}. Dispute expired after 72 hours without resolution. Payment released to helper.`,
        })
        .eq("id", job.id);

      if (updateErr) {
        console.error(`Failed to resolve dispute for job ${job.id}:`, updateErr);
        continue;
      }

      // Notify both parties
      const notifications = [];

      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "Dispute auto-resolved ✓",
          message: `The dispute on "${job.title}" expired after 72 hours without the poster resolving or escalating. Payment will be released to you.`,
          type: "payment",
          link: "/my-jobs?filter=completed",
        });
      }

      notifications.push({
        user_id: job.customer_id,
        title: "Dispute auto-resolved",
        message: `The dispute on "${job.title}" was not resolved or escalated within 72 hours. Per platform policy, payment has been released to the helper.`,
        type: "warning",
        link: "/my-posts?filter=completed",
      });

      // Notify admins
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (adminRoles) {
        for (const admin of adminRoles) {
          notifications.push({
            user_id: admin.user_id,
            title: "⚠️ Dispute auto-resolved",
            message: `Dispute on "${job.title}" expired without poster action. Payment auto-released to helper.`,
            type: "warning",
            link: "/admin",
          });
        }
      }

      if (notifications.length > 0) {
        await supabase.from("notifications").insert(notifications);
      }
      resolved.push(job.id);
    }

    return new Response(
      JSON.stringify({ resolved: resolved.length, ids: resolved }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Auto-resolve disputes error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
