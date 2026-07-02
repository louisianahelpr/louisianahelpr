import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  try {
    // Find profiles with expired one-time passes
    const now = new Date().toISOString();
    const { data: expired, error: fetchError } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
      .not("subscription_tier", "is", null)
      .not("subscription_expires_at", "is", null)
      .lt("subscription_expires_at", now);

    if (fetchError) {
      console.error("[EXPIRE-SUBS] Error fetching expired subs:", fetchError.message);
      throw fetchError;
    }

    if (!expired || expired.length === 0) {
      console.log("[EXPIRE-SUBS] No expired subscriptions found");
      return new Response(JSON.stringify({ cleared: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[EXPIRE-SUBS] Found ${expired.length} expired subscription(s)`);

    // Clear all expired tiers
    const userIds = expired.map(p => p.user_id);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ subscription_tier: null, subscription_expires_at: null })
      .in("user_id", userIds);

    if (updateError) {
      console.error("[EXPIRE-SUBS] Error clearing tiers:", updateError.message);
      throw updateError;
    }

    // Notify each user. The tiers are already cleared above, so a failed
    // notification must not fail the run (nor cause a re-run to double-clear —
    // it won't, the WHERE filter no longer matches the now-null tiers) — but
    // log it so a missing "subscription expired" alert is traceable rather
    // than silently dropped.
    const notifications = expired.map(p => ({
      user_id: p.user_id,
      title: "Subscription expired",
      message: `Your ${p.subscription_tier} pass ended. Renew anytime in Profile → Plans.`,
      type: "info",
      link: "/profile?tab=subscription",
    }));

    const { error: notifErr } = await supabase.from("notifications").insert(notifications);
    if (notifErr) console.error(`[EXPIRE-SUBS] expiry notifications insert failed for ${userIds.length} user(s):`, notifErr);

    console.log(`[EXPIRE-SUBS] Cleared ${expired.length} expired subscription(s)`);

    return new Response(JSON.stringify({ cleared: expired.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[expire-subscriptions] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
