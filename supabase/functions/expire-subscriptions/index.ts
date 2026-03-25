import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
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

    // Notify each user
    const notifications = expired.map(p => ({
      user_id: p.user_id,
      title: "Subscription expired",
      message: `Your ${p.subscription_tier} pass has expired. Upgrade to continue enjoying premium features.`,
      type: "info",
      link: "/profile?tab=subscription",
    }));

    await supabase.from("notifications").insert(notifications);

    console.log(`[EXPIRE-SUBS] Cleared ${expired.length} expired subscription(s)`);

    return new Response(JSON.stringify({ cleared: expired.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
