import { createClient } from "npm:@supabase/supabase-js@2";
import { cronError, cronResult } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { auth: { persistSession: false } }
    );

    // Delete read notifications older than 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const { data, error } = await supabase
      .from("notifications")
      .delete()
      .eq("read", true)
      .lt("created_at", cutoff.toISOString())
      .select("id");

    if (error) throw error;

    const count = data?.length ?? 0;
    console.log(`[CLEANUP] Deleted ${count} old read notifications`);

    // Nothing partial to report: the delete either applied or threw to the
    // catch. The value added here is `fn`, so the sweep attributes a failure to
    // this function rather than to cleanup-abandoned-accounts, which shares its
    // 0 9 * * * slot.
    return cronResult("cleanup-notifications", { deleted: count }, { count: 0 }, corsHeaders);
  } catch (err) {
    console.error("[CLEANUP] Error:", err);
    return cronError("cleanup-notifications", (err as Error).message, corsHeaders);
  }
});
