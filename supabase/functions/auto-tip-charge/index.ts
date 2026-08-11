// auto-tip-charge — charges a poster's standing auto-tip after a job completes.
//
// Lyft's model: the poster sets a preference once (Profile → Money → Auto-tip)
// and the tip is charged automatically when the work is done. It is NOT
// bundled into the job's original charge — Helpr captures the job in full at
// checkout, so a bundled tip would have to be REFUNDED whenever the poster
// adjusted it down, and Stripe keeps the processing fee on refunds.
//
// Invoked by pg_cron. Never by a user: this moves money without a tap, so the
// only caller is the scheduler holding the service key.
//
// Money shape matches the MANUAL tip exactly (create-payment, action="tip"):
// the full tip transfers to the helper's connected account and the platform
// takes an application fee equal to Stripe's processing cost — "no platform
// cut, just the card-processing fee". Same deal, no surprises for the helper.
//
// Safety properties, in order of how much they matter:
//   1. At most ONE automatic tip per job, enforced by a UNIQUE index, not by
//      this function's bookkeeping. Overlapping ticks or a slow Stripe call
//      cannot double-charge.
//   2. The tips row is written BEFORE the charge. A row with no payment is
//      recoverable and visible; a payment with no row is money nobody can
//      account for.
//   3. A poster with no saved card is never silently skipped forever — the
//      row records why and is marked prompted, so the app can ask them once.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { stripeProcessingCostCents } from "../_shared/stripeFees.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) =>
  console.log(`[auto-tip-charge] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET");

    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
    if (missing.length) {
      log("misconfigured", { missing });
      return new Response(JSON.stringify({ error: `Missing env: ${missing.join(", ")}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Same guard as the other cron-invoked functions. No user path exists.
    const authHeader = req.headers.get("Authorization");
    const authorized =
      authHeader &&
      ((cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        authHeader === `Bearer ${serviceRoleKey}`);
    if (!authorized) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    const stripe = new Stripe(stripeSecretKey!, { apiVersion: "2023-10-16" });

    const { data: candidates, error: candErr } = await supabase.rpc("auto_tip_candidates", {
      _since_hours: 24,
    });
    if (candErr) {
      log("ERROR loading candidates", { error: candErr.message });
      throw new Error(`auto_tip_candidates failed: ${candErr.message}`);
    }

    const results = { considered: candidates?.length ?? 0, charged: 0, prompted: 0, failed: 0 };

    for (const c of candidates ?? []) {
      const jobId = c.job_id as string;
      const tipDollars = Number(c.tip_amount);
      const tipCents = Math.round(tipDollars * 100);
      if (!Number.isFinite(tipCents) || tipCents <= 0) continue;

      // Claim the job FIRST. The unique partial index on (job_id) WHERE
      // source='auto' means a concurrent tick loses this insert and skips the
      // job entirely — the charge below can only ever run once.
      const { data: tipRow, error: claimErr } = await supabase
        .from("tips")
        .insert({
          job_id: jobId,
          tipper_id: c.customer_id,
          helper_id: c.helper_id,
          amount: tipDollars,
          source: "auto",
          payment_status: "pending",
        })
        .select("id")
        .single();

      if (claimErr || !tipRow) {
        // 23505 = another tick already claimed it. Not an error worth logging
        // loudly; it is the guard doing its job.
        if ((claimErr as { code?: string } | null)?.code !== "23505") {
          log("ERROR claiming tip row", { jobId, error: claimErr?.message });
          results.failed++;
        }
        continue;
      }

      // Mark the row failed-with-reason rather than deleting it: a poster who
      // meant to tip and couldn't should be asked, and a deleted row would
      // make the sweeper re-attempt the same doomed charge every tick.
      const giveUp = async (reason: string) => {
        await supabase
          .from("tips")
          .update({
            payment_status: "failed",
            failure_reason: reason,
            auto_prompt_sent_at: new Date().toISOString(),
          })
          .eq("id", tipRow.id);
      };

      try {
        const { data: helperProfile } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("user_id", c.helper_id)
          .maybeSingle();

        // No connected account means the helper cannot receive money at all.
        // Charging the poster and holding it on the platform would be taking
        // money for a transfer that can't happen.
        if (!helperProfile?.stripe_account_id) {
          await giveUp("helper_not_connected");
          results.failed++;
          continue;
        }

        const { data: authUser } = await supabase.auth.admin.getUserById(c.customer_id as string);
        const email = authUser?.user?.email;
        if (!email) {
          await giveUp("no_poster_email");
          results.failed++;
          continue;
        }

        // The Stripe customer is resolved by email, matching create-payment —
        // there is no stripe_customer_id column on profiles.
        const customers = await stripe.customers.list({ email, limit: 1 });
        const customerId = customers.data[0]?.id;
        if (!customerId) {
          await giveUp("no_stripe_customer");
          results.prompted++;
          continue;
        }

        // A saved card is what makes this possible without a redirect. It
        // exists only if the poster ticked "Save card for next time" at
        // checkout (setup_future_usage). Without one we stop and let the app
        // ask — never a silent no-op.
        const methods = await stripe.paymentMethods.list({
          customer: customerId,
          type: "card",
          limit: 1,
        });
        const paymentMethodId = methods.data[0]?.id;
        if (!paymentMethodId) {
          await giveUp("no_saved_card");
          results.prompted++;
          continue;
        }

        const feeCents = stripeProcessingCostCents(tipCents);

        const intent = await stripe.paymentIntents.create(
          {
            amount: tipCents,
            currency: "usd",
            customer: customerId,
            payment_method: paymentMethodId,
            // The whole point: no redirect, no user present.
            off_session: true,
            confirm: true,
            description: `Auto-tip — job ${jobId}`,
            transfer_data: { destination: helperProfile.stripe_account_id as string },
            application_fee_amount: feeCents,
            metadata: {
              type: "tip",
              source: "auto",
              job_id: jobId,
              tipper_id: String(c.customer_id),
              helper_id: String(c.helper_id),
            },
          },
          {
            // Keyed on the tips row id, which is unique per job by the index
            // above. A Stripe-level retry of this exact call can never mint a
            // second charge.
            idempotencyKey: `auto-tip:${tipRow.id}`,
          },
        );

        if (intent.status === "succeeded") {
          await supabase
            .from("tips")
            .update({ payment_status: "paid", stripe_payment_intent_id: intent.id })
            .eq("id", tipRow.id);
          results.charged++;
          log("charged", { jobId, tipCents });
        } else {
          // requires_action means the card wants SCA, which needs the user
          // present — exactly what off-session cannot do. Treat as prompt.
          await giveUp(`intent_${intent.status}`);
          results.prompted++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Card declines land here (authentication_required, card_declined…).
        await giveUp(message.slice(0, 200));
        results.failed++;
        log("charge failed", { jobId, error: message });
      }
    }

    log("done", results);
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("FATAL", { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
