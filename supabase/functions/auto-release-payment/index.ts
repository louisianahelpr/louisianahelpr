import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // Find in_progress jobs older than 72 hours that haven't been completed
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, platform_fee_amount")
      .eq("status", "in_progress")
      .eq("payment_status", "escrow")
      .lte("updated_at", cutoff);

    if (error) throw error;

    let released = 0;
    for (const job of (jobs || [])) {
      await supabaseAdmin
        .from("jobs")
        .update({ status: "completed", payment_status: "released" })
        .eq("id", job.id);

      // Notify both parties
      const helperPayout = job.budget - (job.platform_fee_amount || 0);
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Payment auto-released!",
          message: `"${job.title}" was auto-completed after 72 hours. You earned $${helperPayout.toFixed(2)}.`,
          type: "payment",
          link: "/activity",
        });
      }
      if (job.customer_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job auto-completed",
          message: `"${job.title}" was automatically marked complete after 72 hours. Payment has been released.`,
          type: "info",
          link: "/activity",
        });
      }
      released++;
    }

    return new Response(
      JSON.stringify({ success: true, released }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
