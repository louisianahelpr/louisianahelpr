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
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { stripeProcessingCostCents } from "../_shared/stripeFees.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

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
    const stripe = new Stripe(stripeSecretKey!, { apiVersion: "2025-08-27.basil" });

    const { data: candidates, error: candErr } = await supabase.rpc("auto_tip_candidates", {
      _since_hours: 24,
    });
    if (candErr) {
      log("ERROR loading candidates", { error: candErr.message });
      throw new Error(`auto_tip_candidates failed: ${candErr.message}`);
    }

    const results = { considered: candidates?.length ?? 0, charged: 0, prompted: 0, failed: 0 };
    // `results.failed` is NOT the page-worthy counter. It mixes real defects
    // (a read that errored) with business outcomes that recur forever by
    // design: a helper with no connected account, a poster with no saved card,
    // a declined card. Paging on it would fire every hour for one bad card,
    // which is how a watcher gets muted. `defects` counts only the broken ones.
    const defects = defectTracker();

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
          defects.record(`claim ${jobId}: ${claimErr?.message}`);
        }
        continue;
      }

      // Release the claim row so the NEXT cron tick can retry this job, and
      // PROVE the row went away.
      //
      // A DELETE matching zero rows returns `{ data: [], error: null }`, so
      // discarding the result — which this used to do entirely, no error check
      // and no returning projection — makes the worst outcome the invisible
      // one. A surviving claim row is worse than a 23505 on the next tick:
      // `auto_tip_candidates` excludes any job that already has a
      // `source='auto'` tips row, so the job drops out of the candidate list
      // ENTIRELY and no tick ever looks at it again. The poster asked for an
      // automatic tip, the helper never receives it, and nothing in the system
      // says so.
      //
      // Policy on zero rows: fail the RUN loudly, and do not try to recover
      // here. There is no safe automatic recovery — `giveUp()` is the obvious
      // candidate and is exactly wrong, because it sets `auto_prompt_sent_at`
      // and marks the tip failed, permanently cementing the state we are trying
      // to escape. Retrying the delete would only repeat the same predicate.
      // The claim row is durable and visible (`payment_status='pending'`), so a
      // human deleting one row restores the retry — what they need is to be
      // told. `defects.record()` makes the run answer 500 through `cronResult`,
      // which is the one channel `sweep_cron_http_failures()` watches. It is a
      // true defect, not a business outcome: nothing about the poster, the
      // helper or the card caused it.
      const releaseClaimForRetry = async (why: string) => {
        const { data: released, error: releaseErr } = await supabase
          .from("tips")
          .delete()
          .eq("id", tipRow.id)
          .select("id");
        if (releaseErr) {
          log("ERROR releasing tip claim — auto-tip for this job is now blocked", {
            jobId, tipId: tipRow.id, error: releaseErr.message,
          });
          defects.record(`tip claim release ${jobId} (${why}): ${releaseErr.message}`);
          return;
        }
        if (!released || released.length === 0) {
          log("Tip claim release matched ZERO rows — auto-tip for this job is now blocked", {
            jobId, tipId: tipRow.id,
          });
          defects.record(
            `tip claim release ${jobId} (${why}): matched 0 rows — the pending claim row survives and removes this job from auto_tip_candidates forever; delete tips.id=${tipRow.id} to unblock`,
          );
        }
      };

      // Write a TERMINAL outcome onto the claim row, and prove it landed.
      //
      // `.select("id")` because `tips` genuinely has an `id` column — unlike
      // `stripe_webhook_events`, whose primary key is `event_id` and which 400s
      // on `select=id`. The right projection is a per-table fact, not a reflex.
      //
      // Zero rows is never legitimate at either call site:
      //   • `tipRow.id` came from THIS iteration's own claim INSERT moments ago.
      //   • The only code that removes that row is `releaseClaimForRetry()`, and
      //     every path calling it `continue`s without reaching here.
      //   • Nothing else in the repo updates or deletes `tips` at all (grepped
      //     across src/ and supabase/functions/), so no concurrent writer exists.
      //   • A concurrent tick cannot have claimed the same job — the unique
      //     partial index on (job_id) WHERE source='auto' guarantees it.
      //   • An UPDATE returns its matched rows even when the values are
      //     unchanged, so a repeat write still matches 1 row rather than 0.
      // So zero rows means the write did not happen. And because
      // `auto_tip_candidates()` filters on `NOT EXISTS (… tips WHERE
      // source='auto')` — the STATUS is never consulted, only the row's
      // existence — the job leaves the candidate list either way and no tick
      // ever revisits it. A defect, not a business outcome: nothing about the
      // poster, the helper or the card can produce it. `defects.record()` makes
      // the run answer 500 through `cronResult`, the one channel
      // `sweep_cron_http_failures()` watches, and the reason names `tips.id` so
      // clearing it is not a hunt.
      const settleTip = async (
        patch: Record<string, unknown>,
        what: string,
        consequence: string,
      ): Promise<boolean> => {
        const { data: settled, error: settleErr } = await supabase
          .from("tips")
          .update(patch)
          .eq("id", tipRow.id)
          .select("id");
        if (settleErr) {
          log(`ERROR: ${what}`, { jobId, tipId: tipRow.id, error: settleErr.message });
          defects.record(
            `${what} ${jobId}: ${settleErr.message} — ${consequence}; row is tips.id=${tipRow.id}`,
          );
          return false;
        }
        if (!settled || settled.length === 0) {
          log(`${what} matched ZERO rows`, { jobId, tipId: tipRow.id });
          defects.record(
            `${what} ${jobId}: matched 0 rows with no error — ${consequence}; row is tips.id=${tipRow.id}`,
          );
          return false;
        }
        return true;
      };

      // Mark the row failed-with-reason rather than deleting it: a poster who
      // meant to tip and couldn't should be asked, and a deleted row would
      // make the sweeper re-attempt the same doomed charge every tick.
      //
      // `notify` is false for failures the POSTER cannot act on. Telling
      // someone "your tip failed" when the cause is the helper's missing
      // payout account is noise they can do nothing with, and it leaks the
      // other party's account state.
      const giveUp = async (reason: string, notify: boolean) => {
        // A no-op here is the more insidious half of the pair the claim-release
        // guard fixes: it tells the system the tip is permanently resolved when
        // it may have written nothing at all. The row stays `pending` with no
        // `failure_reason` and no `auto_prompt_sent_at`, so the "confirm your
        // tip" nudge that reads that column never fires — while the poster has
        // already been told the tip failed, if `notify`.
        await settleTip(
          {
            payment_status: "failed",
            failure_reason: reason,
            auto_prompt_sent_at: new Date().toISOString(),
          },
          "tip give-up write",
          `the row stays 'pending' with no failure_reason and no auto_prompt_sent_at, so the poster is never nudged to tip manually and no tick revisits this job (reason was "${reason}")`,
        );

        // The poster is told either way. Whether we managed to record the
        // failure has no bearing on whether it happened to them.
        if (!notify) return;
        // The one thing this function must never do is fail silently. A
        // poster who configured an automatic tip and got nothing — no charge,
        // no message — would reasonably believe their helper was tipped.
        const { error: notifyErr } = await supabase.from("notifications").insert({
          user_id: c.customer_id,
          type: "payment",
          title: "Your tip didn't go through",
          message:
            "We couldn't charge your automatic tip — usually because there's no saved card on file. You can send it in a tap.",
          // Straight to the finished job the tip was for. A bare "/my-posts"
          // opened on "Needs you", which a completed job is never in — so the
          // "send it in a tap" was a tap into an empty list.
          link: `/my-posts?job=${c.job_id}`,
        });
        if (notifyErr) {
          // Never swallowed: if this insert fails the poster is back to
          // silence, which is the exact failure mode being guarded against.
          log("ERROR writing tip-failure notification", { jobId, error: notifyErr.message });
          defects.record(`tip-failure notification ${jobId}: ${notifyErr.message}`);
        }
      };

      try {
        const { data: helperProfile, error: helperProfileErr } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("user_id", c.helper_id)
          .maybeSingle();

        if (helperProfileErr) {
          // Transient read failure — delete the claim so the next cron tick can
          // retry rather than permanently mis-labelling the tip as failed and
          // setting auto_prompt_sent_at (which giveUp does), which would block
          // all future retry attempts for this job's auto-tip.
          log("ERROR reading helper profile — deleting claim for retry", { jobId, error: helperProfileErr.message });
          await releaseClaimForRetry("helper profile read");
          results.failed++;
          defects.record(`helper profile read ${jobId}: ${helperProfileErr.message}`);
          continue;
        }

        // No connected account means the helper cannot receive money at all.
        // Charging the poster and holding it on the platform would be taking
        // money for a transfer that can't happen.
        if (!helperProfile?.stripe_account_id) {
          await giveUp("helper_not_connected", false);
          results.failed++;
          continue;
        }

        const { data: authUser, error: authUserErr } = await supabase.auth.admin.getUserById(c.customer_id as string);
        if (authUserErr) {
          // Same reasoning as helperProfileErr above: don't call giveUp on a
          // transient auth read failure — delete the claim and retry next tick.
          log("ERROR reading poster auth record — deleting claim for retry", { jobId, error: authUserErr.message });
          await releaseClaimForRetry("poster auth read");
          results.failed++;
          defects.record(`poster auth read ${jobId}: ${authUserErr.message}`);
          continue;
        }
        const email = authUser?.user?.email;
        if (!email) {
          await giveUp("no_poster_email", false);
          results.failed++;
          continue;
        }

        // ONE EMAIL, MANY STRIPE CUSTOMERS. Stripe does not treat email as a
        // key: every checkout that did not explicitly reuse an existing
        // customer mints a new record, and this function used to resolve by
        // `customers.list({ email, limit: 1 })` — picking whichever record
        // is newest, with no regard for which one (if any) actually holds a
        // saved card. A poster who had checked out more than once could have
        // their real, working card sitting on an older record while the
        // newest one was empty: this would call `giveUp("no_saved_card",
        // true)`, tell the poster their payment had a problem, and never
        // charge them — for a card that was fine all along.
        //
        // `charge-recurring-visits` hit and fixed the identical bug
        // (documented there in full) by scanning every candidate record for
        // one that actually has a card, batched so it costs one round trip
        // per MAX_CUSTOMER_RECORDS_PER_BATCH candidates rather than one per
        // record. With a single customer record — the common case — this is
        // byte-for-byte the old behaviour; it only differs where the old
        // code picked the wrong record.
        const customers = await stripe.customers.list({ email, limit: 100 });
        let customerId: string | undefined;
        let paymentMethodId: string | undefined;
        const MAX_CUSTOMER_RECORDS_PER_BATCH = 10;
        for (
          let i = 0;
          i < customers.data.length && !customerId;
          i += MAX_CUSTOMER_RECORDS_PER_BATCH
        ) {
          const batch = customers.data.slice(i, i + MAX_CUSTOMER_RECORDS_PER_BATCH);
          const cards = await Promise.all(
            batch.map(async (candidate) => {
              const methods = await stripe.paymentMethods.list({
                customer: candidate.id,
                type: "card",
                limit: 1,
              });
              return methods.data[0]?.id;
            }),
          );
          const hit = cards.findIndex((id) => !!id);
          if (hit >= 0) {
            customerId = batch[hit].id;
            paymentMethodId = cards[hit];
          }
        }

        if (!customerId) {
          await giveUp("no_stripe_customer", true);
          results.prompted++;
          continue;
        }
        // A saved card is what makes this possible without a redirect. It
        // exists only if the poster ticked "Save card for next time" at
        // checkout (setup_future_usage). Without one we stop and let the app
        // ask — never a silent no-op.
        if (!paymentMethodId) {
          await giveUp("no_saved_card", true);
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
            // The asymmetry this closes: a FAILED auto-tip already gets a
            // notification (giveUp, above) — a successful one, the card
            // actually being charged off-session with no confirmation step
            // at all, got nothing. Stripe's own receipt is the cheapest
            // confirmation channel available for a charge with no client
            // present to show a success toast to.
            receipt_email: email,
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
          // THE MONEY HAS ALREADY MOVED. This is the one write in the function
          // that runs after a real charge, and it was the only one with neither
          // an error check nor a returning projection — so the worst outcome in
          // the file was also the most invisible: the poster is debited, the
          // helper's transfer is on its way, and `tips` still reads 'pending'
          // with a null `stripe_payment_intent_id`.
          //
          // That is not merely a stale label. The intent id is the ONLY join key
          // between this charge and the ledger, so without it the charge is
          // unreconcilable — money-reconciliation cannot match it to anything —
          // and `auto_tip_candidates()` still excludes the job (it tests the
          // row's existence, not its status), so nothing revisits it to notice.
          // The comment at the top of this file says a payment with no row is
          // money nobody can account for; a payment with an unfinished row is
          // the same hole one column narrower.
          //
          // Observation only: the success path still does exactly what it did.
          // Charging is NOT retried on a failed settle — `results.charged` and
          // the log stay truthful about the charge, because the charge really
          // did succeed. What changes is that the run now reports the defect
          // instead of returning 200 as though the tip were fully recorded.
          await settleTip(
            { payment_status: "paid", stripe_payment_intent_id: intent.id },
            "tip paid-settlement write",
            `the poster WAS charged (payment_intent ${intent.id}, ${tipCents}c) but the tips row still reads 'pending' with no stripe_payment_intent_id, leaving the charge unreconcilable`,
          );
          results.charged++;
          log("charged", { jobId, tipCents });

          // SC-003: the failure path (giveUp, above) has told the poster for
          // as long as this function has existed. The success path — a card
          // being charged off-session, without them present to see a toast —
          // told them nothing at all, so the FIRST time they learned about an
          // auto-tip was potentially a bank statement line. Mirrors the
          // failure notification's shape and its "never swallowed" guard.
          const { error: successNotifyErr } = await supabase.from("notifications").insert({
            user_id: c.customer_id,
            type: "payment",
            title: "Your auto-tip was sent",
            message: `We sent a $${(tipCents / 100).toFixed(2)} tip to your helper for this job — no action needed.`,
            link: `/my-posts?job=${c.job_id}`,
          });
          if (successNotifyErr) {
            log("ERROR writing tip-success notification", { jobId, error: successNotifyErr.message });
            defects.record(`tip-success notification ${jobId}: ${successNotifyErr.message}`);
          }
        } else {
          // requires_action means the card wants SCA, which needs the user
          // present — exactly what off-session cannot do. Treat as prompt.
          await giveUp(`intent_${intent.status}`, true);
          results.prompted++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Card declines land here (authentication_required, card_declined…).
        await giveUp(message.slice(0, 200), true);
        results.failed++;
        log("charge failed", { jobId, error: message });
      }
    }

    log("done", results);
    return cronResult("auto-tip-charge", results, defects.defects, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("FATAL", { error: message });
    return cronError("auto-tip-charge", message, corsHeaders);
  }
});
