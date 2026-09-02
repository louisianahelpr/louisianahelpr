import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  computeInstantPayoutFeeCents,
  INSTANT_PAYOUT_MIN_CENTS,
} from "../_shared/instantPayoutFee.ts";
import { formatPayoutCents } from "../_shared/money.ts";

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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action = body?.action === undefined ? "quote" : body.action; // "quote" | "execute"

    // Look up helper's Stripe Connect account
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, full_name, subscription_tier, subscription_expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // Distinguish a transient read failure from a genuine no-account state —
    // otherwise a blip throws "set up your payout account" and misleads a
    // helper who already onboarded into re-doing Connect onboarding.
    if (profileErr) {
      throw new Error("Could not load your payout account right now. Please try again in a moment.");
    }
    if (!profile?.stripe_account_id) {
      return new Response(JSON.stringify({ error: "No payout account connected. Set up your payout account first." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // PAID ENTITLEMENT — enforced on the server, for BOTH quote and execute.
    //
    // Instant Payouts is sold on Basic/Pro/Elite, but the only gate used to be
    // the client (EarningsTab.tsx `canUseInstantPayout` and WalletCard). A
    // 2026-08-31 audit called this endpoint directly with
    // `subscription_tier = null` and it executed a REAL payout
    // (po_1UAWFR3gUgw4QMyhMnVrRjbA, $66.93 net, ledger row completed). Any
    // free account could take the paid feature — and pay us the 3% fee for a
    // service they were never entitled to buy, which is the worse half.
    //
    // The tier ladder and the expiry convention are mirrored EXACTLY from
    // EarningsTab.tsx:84-94 so the button and the endpoint cannot disagree:
    // a null expiry means "active" (lifetime/comped), a past expiry means
    // lapsed. The minimum-cashout floor below already carries the same
    // "a client that skips the UI gate" reasoning — this closes the gap it
    // left open.
    const tier = profile?.subscription_tier ?? "free";
    const expiresAt = profile?.subscription_expires_at
      ? new Date(profile.subscription_expires_at)
      : null;
    const subActive = expiresAt ? expiresAt > new Date() : true;
    const entitled = subActive && (tier === "basic" || tier === "pro" || tier === "elite");
    if (!entitled) {
      return new Response(
        JSON.stringify({
          error: "Instant payout is a membership feature. Upgrade to Basic, Pro or Elite to cash out instantly — your funds still pay out free on the standard schedule.",
          code: "membership_required",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 },
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Check instant-available balance on the connected account
    const balance = await stripe.balance.retrieve({ stripeAccount: profile.stripe_account_id });
    const usdInstant = balance.instant_available?.find((b) => b.currency === "usd");
    const availableCents = usdInstant?.amount ?? 0;

    if (availableCents <= 0) {
      return new Response(JSON.stringify({ error: "No funds available for instant payout right now. Funds become available once jobs are completed and released." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Minimum-cashout floor. Below this, a flat 3% doesn't reliably clear
    // Stripe's per-instant-payout cost (~1%, $0.50 minimum), so instant is
    // disabled and the free standard payout is the path. Enforced here on the
    // server for BOTH quote and execute so a client that skips the UI gate
    // (or calls the API directly) still can't cash out under the floor.
    if (availableCents < INSTANT_PAYOUT_MIN_CENTS) {
      const min = (INSTANT_PAYOUT_MIN_CENTS / 100).toFixed(2);
      return new Response(JSON.stringify({ error: `Instant payout needs at least $${min} available. You have less than that right now, so these funds will pay out on the standard schedule for free.` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const feeCents = computeInstantPayoutFeeCents(availableCents);
    const netCents = availableCents - feeCents;

    if (netCents <= 0) {
      return new Response(JSON.stringify({ error: "Balance is too low to cover the instant payout fee." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
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
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
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

    // 23505 = the `instant_payouts_one_pending_per_helper` partial unique index
    // (migration 20260823010000). It is the real guard against a concurrent
    // second payout: the Stripe idempotency keys below are derived from
    // `record.id`, so two simultaneous requests would mint two rows, two ids,
    // two keys and two Stripe calls — the key cannot bind what it is derived
    // from. Surfacing it as a human 409 rather than the generic throw, because
    // the helper needs to know their money is already moving, not that
    // something broke.
    if (recordErr && (recordErr as { code?: string }).code === "23505") {
      return new Response(
        JSON.stringify({ error: "A payout is already in progress. Give it a moment before trying again." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (recordErr || !record) throw new Error("Failed to create payout record");

    // Track whether the fee transfer completed so the payout catch block can
    // include the full picture in error_message — without this, a
    // fee-succeeded + payout-failed scenario overwrites any fee information
    // with only the payout error, leaving admins unable to tell from the DB
    // alone whether the helper's Connect account was already debited.
    let feeTransferSucceeded = false;

    try {
      // Transfer the fee to the platform account first.
      // Guard: a flat 3% of a sub-17¢ balance rounds to 0¢, and Stripe rejects a
      // zero-amount transfer. Skip it — there's genuinely no fee to collect, so
      // attempting the transfer would drop into the catch below and mislabel a
      // normal $0 fee as `fee_uncollected`. (The old fee had a $2 minimum, so
      // feeCents was never 0 and this case couldn't arise.)
      if (feeCents > 0) {
        // Resolve the platform account ID before calling stripe.transfers.create().
        // If this were nested as `(await stripe.accounts.retrieve()).id` inside the
        // argument object, a rejection would bypass the .catch() below (which only
        // covers stripe.transfers.create() rejections) and land in the outer catch,
        // marking the whole payout failed. Since fee transfer is best-effort, a
        // retrieval failure should only skip the fee — not abort the payout.
        let platformAccountId: string | undefined;
        try {
          platformAccountId = (await stripe.accounts.retrieve()).id;
        } catch (acctErr) {
          const acctMsg = acctErr instanceof Error ? acctErr.message : String(acctErr);
          console.error(
            `[instant-payout] platform account retrieval failed — fee transfer skipped for instant_payout ${record.id}: ${acctMsg}`
          );
          // Best-effort reconciliation write so the skipped fee is visible in the DB.
          const { error: acctRecErr } = await supabaseAdmin
            .from("instant_payouts")
            .update({ error_message: `fee_uncollected: platform_account_retrieval_failed: ${acctMsg}` })
            .eq("id", record.id);
          if (acctRecErr) {
            console.error(`[instant-payout] failed to record platform_account_retrieval_failed for ${record.id}:`, acctRecErr);
          }
        }

        if (platformAccountId) {
        // Idempotency: keyed off the persisted instant_payouts.id, so a retry of
        // THIS request — network blip, function restart mid-flight — reuses the
        // same Stripe Transfer instead of double-charging the helper.
        //
        // It does NOT cover a client double-tap, and the comment here used to
        // claim it did. Two concurrent requests each INSERT their own row, so
        // they get different ids and therefore different keys. That case is
        // handled one level up by the partial unique index on
        // (helper_id) WHERE status = 'pending' — see the 23505 branch above.
        await stripe.transfers.create(
          {
            amount: feeCents,
            currency: "usd",
            destination: platformAccountId,
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
        ).then(() => {
          feeTransferSucceeded = true;
        }).catch(async (feeErr) => {
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
          // The `fee_uncollected` marker is write-only — nothing sweeps it, so
          // without an alert this is revenue the platform quietly forgoes
          // forever. Surface it so someone can either collect it or fix the
          // Connect setup that caused it.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Instant-payout fee NOT collected",
            message: `An instant payout completed but its platform fee transfer failed, so the fee stayed in the helper's connected balance. The helper was not double-charged; the platform forgoes this fee unless it is collected manually.`,
            fields: {
              "Instant payout ID": String(record.id),
              "Helper ID": user.id,
              "Fee (cents)": String(feeCents),
              Error: feeMsg.slice(0, 200),
            },
          });
        });
        }
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

      // The money is out. This write is the only thing that moves the row off
      // 'pending' — and 'pending' is the exact predicate of the partial unique
      // index `instant_payouts_one_pending_per_helper` (20260823010000:127-129).
      // So a zero-row match here does not merely leave a stale row: it leaves a
      // row that permanently blocks EVERY future instant payout for this helper,
      // with no sweeper, no timeout and no admin tool to clear it. The helper
      // just finds the feature dead, forever, with no way to say why.
      //
      // Guarded like the release-path writes: an explicit precondition on the
      // state this write may walk forward from, `.select("id")`, and a zero-row
      // branch that reports instead of proceeding silently. Modelled on
      // execute-dispute-split:879-885.
      const { data: completedRows, error: completeErr } = await supabaseAdmin
        .from("instant_payouts")
        .update({
          status: "completed",
          stripe_payout_id: payout.id,
        })
        .eq("id", record.id)
        .eq("status", "pending")
        .select("id");
      if (completeErr || !completedRows || completedRows.length === 0) {
        const zeroRow = !completeErr;
        console.error(
          `CRITICAL: [instant-payout] payout ${payout.id} SENT but the instant_payouts row ${record.id} was not marked completed ` +
            `(${zeroRow ? "zero rows matched — status is no longer 'pending'" : completeErr?.message}). ` +
            `While it stays 'pending', helper ${user.id} cannot start another instant payout.`,
        );
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "critical",
          title: "Instant payout sent but the record was not completed",
          message:
            "A real Stripe instant payout succeeded but its instant_payouts row could not be marked completed. While that row stays 'pending' the partial unique index blocks every further instant payout for this helper — the feature is dead for them until it is cleared. The reaper (reap_stranded_instant_payouts) will release the lock within the hour, but the row's true outcome must be reconciled by hand.",
          fields: {
            "Instant payout ID": String(record.id),
            "Helper ID": user.id,
            "Stripe payout": payout.id,
            "Net (cents)": String(netCents),
            Reason: zeroRow ? "zero rows matched" : (completeErr?.message ?? "").slice(0, 200),
          },
        });
      }

      // Notify the helper
      await supabaseAdmin.from("notifications").insert({
        user_id: user.id,
        title: "Instant payout on the way",
        message: `$${formatPayoutCents(netCents)} is heading to your debit card. Arrives in ~30 min.`,
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
      // Append fee-transfer outcome so admins can determine from the DB record
      // alone whether the helper's Connect account was already debited before
      // the payout failed — without this note the record is ambiguous and
      // requires manual Stripe reconciliation on every failed instant payout.
      let fullError = msg;
      if (feeCents > 0) {
        fullError += feeTransferSucceeded
          ? ` | IMPORTANT: fee of ${feeCents}¢ was already transferred to platform — reverse transfer to helper's Connect account before closing`
          : ` | fee transfer also failed (fee not collected)`;
      }
      // Same hazard as the completion write above, and this one did not even
      // destructure `error` — a rejected or zero-row update was invisible. A
      // failed payout whose row stays 'pending' locks the helper out of the
      // feature permanently, which turns a transient Stripe error into a
      // silent, unbounded loss of access.
      const { data: failedRows, error: failWriteErr } = await supabaseAdmin
        .from("instant_payouts")
        .update({ status: "failed", error_message: fullError })
        .eq("id", record.id)
        .eq("status", "pending")
        .select("id");
      if (failWriteErr || !failedRows || failedRows.length === 0) {
        const zeroRow = !failWriteErr;
        console.error(
          `CRITICAL: [instant-payout] payout FAILED for record ${record.id} and the row could not be marked failed ` +
            `(${zeroRow ? "zero rows matched — status is no longer 'pending'" : failWriteErr?.message}). ` +
            `Helper ${user.id} is locked out of instant payouts while it stays 'pending'.`,
        );
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "critical",
          title: "Instant payout failed AND its record could not be marked failed",
          message:
            "An instant payout failed and the instant_payouts row could not be moved off 'pending'. The partial unique index means this helper cannot start another instant payout until the row is cleared. The reaper (reap_stranded_instant_payouts) releases it within the hour; the underlying Stripe failure still needs a look.",
          fields: {
            "Instant payout ID": String(record.id),
            "Helper ID": user.id,
            "Payout error": fullError.slice(0, 200),
            Reason: zeroRow ? "zero rows matched" : (failWriteErr?.message ?? "").slice(0, 200),
          },
        });
      }
      throw payoutErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[instant-payout] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
