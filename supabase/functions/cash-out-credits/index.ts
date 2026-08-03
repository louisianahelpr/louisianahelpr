import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "cash-out-credits",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Not authenticated");
    const userId = userData.user.id;

    // Get user's Stripe Connect account
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .single();

    // Distinguish a transient read failure from a genuine "no account" — a
    // dropped error here would falsely tell a helper WITH a Connect account to
    // go re-onboard, and this read gates the whole payout.
    if (profileErr) {
      console.error(`[cash-out-credits] profile read failed for ${userId}:`, profileErr);
      return new Response(
        JSON.stringify({ error: "We couldn't verify your payout account right now. Please try again in a moment." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!profile?.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: "You need to connect a Stripe account before cashing out. Go to your Profile to set this up." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Race-safe atomic claim: flip redeemed=true FIRST and return only the
    // rows this call actually claimed. A concurrent double-tap/retry that
    // reads the same unredeemed rows will claim zero here (the .eq filter no
    // longer matches), so only one request ever transfers. Without this the
    // read→transfer→mark sequence let two requests pay out the same credits.
    const { data: claimed, error: claimError } = await supabase
      .from("referral_credits")
      .update({ redeemed: true })
      .eq("user_id", userId)
      .eq("redeemed", false)
      .select("id, amount");

    if (claimError) throw new Error("Failed to load credits");
    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({ error: "No available credits to cash out." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const creditIds = claimed.map((c) => c.id);
    const totalAmount = claimed.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalCents = Math.round(totalAmount * 100);

    // Roll back the claim helper — credits must not be lost if we bail or the
    // transfer fails, so we flip redeemed back to false for the claimed rows.
    const rollbackClaim = () =>
      supabase.from("referral_credits").update({ redeemed: false }).in("id", creditIds);

    if (totalCents < 100) {
      // Rollback failure here is the same risk as in the transfer catch block:
      // credits stay redeemed=true with no payout. Use the same .catch() pattern
      // so ops can find and manually reset the row(s) from logs.
      await rollbackClaim().catch((rollbackErr: unknown) => {
        console.error(
          "[cash-out-credits] CRITICAL: minimum-amount rollback failed — credits may be permanently lost",
          {
            creditIds,
            rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            userId,
          },
        );
      });
      return new Response(
        JSON.stringify({ error: "Minimum cash-out amount is $1.00." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Create Stripe transfer to connected account
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Idempotency key derived from the exact claimed credit set, so a retried
    // transfer for the same claim never double-sends on Stripe's side.
    const idempotencyKey = `cashout-${await sha256Hex(creditIds.slice().sort().join(","))}`;

    let transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: totalCents,
          currency: "usd",
          destination: profile.stripe_account_id,
          description: `Helpr referral credit cash-out ($${totalAmount.toFixed(2)})`,
        },
        { idempotencyKey }
      );
    } catch (transferError) {
      // Transfer failed — release the claim so the user keeps their credits.
      // If the rollback itself fails, the credits stay redeemed=true with no
      // payout — log critically so ops can manually reset the row(s).
      await rollbackClaim().catch((rollbackErr: unknown) => {
        console.error(
          "[cash-out-credits] CRITICAL: credit rollback failed — credits may be permanently lost",
          {
            creditIds,
            rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            userId,
          },
        );
      });
      throw transferError;
    }

    // Notify user. The transfer already succeeded, so a failed notification
    // must not fail the request — but log it so a missing "cash-out successful"
    // alert is traceable rather than silently dropped.
    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id: userId,
      title: "Cash-out successful!",
      message: `$${totalAmount.toFixed(2)} in referral credits has been sent to your connected Stripe account.`,
      type: "payment",
      link: "/profile",
    });
    if (notifErr) console.error(`[cash-out-credits] success notification insert failed for user ${userId} (transfer ${transfer.id}):`, notifErr);

    return new Response(
      JSON.stringify({
        success: true,
        amount: totalAmount,
        transfer_id: transfer.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[cash-out-credits] error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
