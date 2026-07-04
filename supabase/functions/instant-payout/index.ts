import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { computeInstantPayoutFeeCents } from "../_shared/instantPayoutFee.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 3,
    keyPrefix: "instant-payout",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action = body?.action || "quote"; // "quote" | "execute"

    // Look up helper's Stripe Connect account
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("user_id", user.id)
      .single();

    if (!profile?.stripe_account_id) {
      throw new Error("No payout account connected. Set up your payout account first.");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Check instant-available balance on the connected account
    const balance = await stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id });
    const usdInstant = balance.instant_available?.find((b) => b.currency === "usd");
    const availableCents = usdInstant?.amount ?? 0;

    if (availableCents <= 0) {
      throw new Error("No funds available for instant payout right now. Funds become available once jobs are completed and released.");
    }

    const feeCents = computeInstantPayoutFeeCents(availableCents);
    const netCents = availableCents - feeCents;

    if (netCents <= 0) {
      throw new Error("Balance is too low to cover the instant payout fee.");
    }

    // Quote only — return breakdown without executing
    if (action === "quote") {
      return new Response(
        JSON.stringify({
          gross_cents: availableCents,
          fee_cents: feeCents,
          net_cents: netCents,
          currency: "usd",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (action !== "execute") {
      throw new Error("Invalid action");
    }

    // Create pending record first
    const { data: record, error: recordErr } = await supabaseAdmin
      .from("instant_payouts")
      .insert({
        helper_id: user.id,
        gross_amount: availableCents / 100,
        fee_amount: feeCents / 100,
        net_amount: netCents / 100,
        status: "pending",
      })
      .select()
      .single();

    if (recordErr || !record) throw new Error("Failed to create payout record");

    try {
      // Transfer the fee to the platform account first.
      // Guard: a flat 3% of a sub-17¢ balance rounds to 0¢, and Stripe rejects a
      // zero-amount transfer. Skip it — there's genuinely no fee to collect, so
      // attempting the transfer would drop into the catch below and mislabel a
      // normal $0 fee as `fee_uncollected`. (The old fee had a $2 minimum, so
      // feeCents was never 0 and this case couldn't arise.)
      if (feeCents > 0) {
      // Idempotency: keyed off the persisted instant_payouts.id so any retry —
      // network blip, function-restart mid-flight, client double-tap — reuses
      // the same Stripe Transfer instead of double-charging the helper.
      await stripe.transfers.create(
        {
          amount: feeCents,
          currency: "usd",
          destination: (await stripe.accounts.retrieve()).id,
          description: `Instant payout fee — helper ${user.id}`,
          metadata: {
            helper_id: user.id,
            instant_payout_id: record.id,
            type: "instant_payout_fee",
          },
        },
        {
          stripeAccount: profile.stripe_account_id,
          idempotencyKey: `instant-payout-transfer-${record.id}`,
        }
      ).catch(async (feeErr) => {
        // The fee transfer can fail on older Connect setups. We deliberately
        // continue and still pay out only netCents — the fee stays in the
        // helper's connected balance rather than the platform account, so the
        // helper is NOT double-charged. But the platform silently forgoes that
        // fee revenue, so this must be logged + recorded for reconciliation
        // instead of swallowed (was an empty catch — a silent broken promise).
        const feeMsg = feeErr instanceof Error ? feeErr.message : "fee transfer failed";
        console.error(
          `[instant-payout] fee transfer NOT collected for instant_payout ${record.id} (helper ${user.id}, fee ${feeCents}¢): ${feeMsg}`
        );
        // The reconciliation write is itself best-effort: if it fails we still
        // want the net payout below to proceed, so log rather than throw (a
        // throw here would surface as an uncaught rejection inside .catch()).
        const { error: recErr } = await supabaseAdmin
          .from("instant_payouts")
          .update({ error_message: `fee_uncollected: ${feeMsg}` })
          .eq("id", record.id);
        if (recErr) {
          console.error(`[instant-payout] failed to record fee_uncollected for ${record.id}:`, recErr);
        }
      });
      }

      // Execute the instant payout for net amount.
      // Same idempotency rationale as the transfer above. The key includes the
      // instant_payouts row id, so a retry inside the same logical attempt
      // collapses safely while a brand-new attempt (new row) gets its own key.
      const payout = await stripe.payouts.create(
        {
          amount: netCents,
          currency: "usd",
          method: "instant",
          description: "Helpr instant payout",
          metadata: {
            helper_id: user.id,
            instant_payout_id: record.id,
            gross_cents: String(availableCents),
            fee_cents: String(feeCents),
          },
        },
        {
          stripeAccount: profile.stripe_account_id,
          idempotencyKey: `instant-payout-payout-${record.id}`,
        }
      );

      await supabaseAdmin
        .from("instant_payouts")
        .update({
          status: "completed",
          stripe_payout_id: payout.id,
        })
        .eq("id", record.id);

      // Notify the helper
      await supabaseAdmin.from("notifications").insert({
        user_id: user.id,
        title: "⚡ Instant payout on the way",
        message: `$${(netCents / 100).toFixed(2)} is heading to your debit card. Arrives in ~30 min.`,
        type: "financial_alerts",
        link: "/earnings",
      });

      return new Response(
        JSON.stringify({
          success: true,
          payout_id: payout.id,
          gross_cents: availableCents,
          fee_cents: feeCents,
          net_cents: netCents,
          arrival_date: payout.arrival_date,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } catch (payoutErr) {
      const msg = payoutErr instanceof Error ? payoutErr.message : "Payout failed";
      await supabaseAdmin
        .from("instant_payouts")
        .update({ status: "failed", error_message: msg })
        .eq("id", record.id);
      throw payoutErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[instant-payout] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
