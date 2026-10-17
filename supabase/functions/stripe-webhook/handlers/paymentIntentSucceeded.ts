import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  logStep("Payment intent succeeded", { id: pi.id, amount: pi.amount });

  // Record the confirmed sales tax amount on the job.
  // Stripe Tax writes the final collected tax on the PaymentIntent at
  // amount_details.tax.total_tax_amount (in cents). Charge metadata has no
  // such field, so the previous charge.retrieve path never populated this
  // column and sales_tax_amount was always left as 0. The parishtax admin
  // view and 1099 reconciliation both depend on this being accurate.
  const { data: taxJob, error: taxJobErr } = await supabase
    .from("jobs")
    .select("id, sales_tax_amount, payment_status, status, customer_id, title, is_seed")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  if (taxJobErr) {
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers. A plain `return` here would
    // commit the dedupe row and ack 200 permanently — the tax amount can never
    // be retried, under-reporting parish tax and 1099 reconciliation.
    throw new Error(`Sales-tax job lookup failed for PI ${pi.id}: ${taxJobErr.message}`);
  }

  if (taxJob) {
    // Take Stripe's number whenever Stripe HAS one — including a genuine $0.
    // This was `taxAmountCents > 0 ? ... : existing`, which meant a real zero
    // could never clear a wrong stored estimate: the row kept whatever was
    // written at insert time forever. Most jobs are in exempt categories and
    // Stripe collects exactly $0 on them, so that branch was the normal case,
    // not the edge case. Fall back to the stored value ONLY when the field is
    // absent (older PI shape / Stripe Tax not applied), which is genuinely
    // "no information", not "zero".
    const taxTotal = (pi.amount_details as any)?.tax?.total_tax_amount;
    const taxAmountCents: number | null = typeof taxTotal === "number" ? taxTotal : null;
    const confirmedTax = taxAmountCents !== null
      ? taxAmountCents / 100
      : (taxJob.sales_tax_amount || 0);

    const { error: taxUpdateErr } = await supabase.from("jobs").update({
      sales_tax_amount: confirmedTax,
    }).eq("id", taxJob.id);

    if (taxUpdateErr) {
      // Same retry contract: throw instead of returning so the idempotency row
      // is rolled back and Stripe re-delivers. A silent 200 here permanently
      // leaves sales_tax_amount at 0, under-reporting parish tax and 1099s.
      throw new Error(`Sales-tax write failed for job ${taxJob.id}: ${taxUpdateErr.message}`);
    }

    logStep("Sales tax recorded on job", { jobId: taxJob.id, tax: confirmedTax, fromStripe: taxAmountCents !== null });

    // ME-046: for async payment methods (ACH / US bank account) the job is still
    // "unpaid" or null when checkout.session.completed fires — that handler no
    // longer sets "escrow" for async payments. Now that the PI succeeded, the
    // money is captured: flip the job to "escrow" and fan out the helper match.
    // State precondition: only a still-unpaid/null/failed job is promoted here.
    // "failed" is included because a card decline within the SAME checkout
    // session marks the job 'failed' first; if the poster then retries with ACH
    // on that same session, the bank debit succeeds and this handler fires — the
    // job must not stay stuck in 'failed' with captured funds.
    // "abandoned" too (Q1879, lh-money-escrow R4 review of PR #3197, #2): the
    // abandon sweep (void-cancelled-payments Parts B/B2) marks an unpaid job
    // 'abandoned' once its checkout session is expired or gone: Part B on an
    // OPEN job, Part B2 on a job that was ALREADY cancelled (the sweep marks,
    // it never cancels). ME-046 keeps that off a job whose bank debit is in
    // flight, but if it ever happens and the debit settles anyway, the money
    // is captured and nothing else would ever fund the job (prod 2026-10-17:
    // 102 abandoned jobs, 101 cancelled, none with a PaymentIntent yet).
    // A CANCELLED job is promoted too, on purpose: void-cancelled-payments
    // Part A (status 'cancelled' + payment_status 'escrow') refunds it on its
    // next run, the same as an unpaid cancelled job promoted here always was.
    // Only a COMPLETED job is refused: escrow there is money nothing pays out
    // or refunds, so it is paged to ops to refund instead.
    // If the job is already "escrow" (sync card payment — this PI also fires for
    // those) or further along, the UPDATE matches zero rows, which is the no-op.
    const isStillUnpaid =
      taxJob.payment_status == null ||
      taxJob.payment_status === "unpaid" ||
      taxJob.payment_status === "failed" ||
      taxJob.payment_status === "abandoned";
    const pageClosedUnfunded = async (jobStatus: string, paymentStatus: string | null) => {
      logStep("Bank payment settled on a completed or deleted unfunded job — not promoted; ops paged to refund", { jobId: taxJob.id, piId: pi.id, status: jobStatus });
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Bank payment settled on a job that can never be funded — refund it",
        message: `A bank (ACH) payment settled for job ${taxJob.id}, but the job is ${jobStatus} and was never funded, so it was NOT moved to escrow (nothing would pay it out or refund it). Refund this PaymentIntent from the Stripe dashboard.`,
        fields: { job_id: taxJob.id, payment_intent: pi.id, job_status: jobStatus, payment_status: paymentStatus ?? "null" },
        oncePerDayKey: `ach-settled-unfundable-job:${pi.id}`,
        seed: taxJob.is_seed ?? false,
      });
    };
    if (isStillUnpaid && taxJob.status === "completed") {
      await pageClosedUnfunded("completed", taxJob.payment_status);
    } else if (isStillUnpaid) {
      const { data: escrowRow, error: escrowErr } = await supabase
        .from("jobs")
        .update({ payment_status: "escrow" })
        .eq("id", taxJob.id)
        .or("payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.failed,payment_status.eq.abandoned")
        .neq("status", "completed")
        .select("id")
        .maybeSingle();
      if (escrowErr) {
        // Throw: the idempotency row rolls back, Stripe retries. A silent 200
        // here would leave the job permanently unpaid with captured funds —
        // browse hides it, helpers never see it, and it can never be paid out.
        throw new Error(`ACH escrow flip failed for job ${taxJob.id} (PI ${pi.id}): ${escrowErr.message}`);
      }
      if (escrowRow) {
        logStep("ACH payment settled — job moved to escrow", { jobId: taxJob.id, piId: pi.id });
        // Trigger helper match now that the job is actually funded.
        // Best-effort: a failure costs reach, not correctness (same contract as
        // the match call in checkoutSessionCompleted).
        try {
          const { error: matchError } = await supabase.functions.invoke("instant-job-match", {
            body: { jobId: taxJob.id },
            headers: {
              Authorization: `Bearer ${(Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!}`,
            },
          });
          if (matchError) {
            logStep("WARN: instant-job-match failed after ACH settlement", { jobId: taxJob.id, error: matchError.message });
          } else {
            logStep("Triggered instant-job-match after ACH settlement", { jobId: taxJob.id });
          }
        } catch (matchErr) {
          logStep("WARN: instant-job-match threw after ACH settlement", { jobId: taxJob.id, error: String(matchErr) });
        }
      } else {
        // Zero rows: the job changed between our select and this write. Re-read
        // it (Q1879): a concurrent delivery that already set escrow is a valid
        // funded state, but a job COMPLETED meanwhile and still unfunded holds
        // captured money nothing will pay out, and is paged as money at risk.
        const { data: now, error: nowErr } = await supabase
          .from("jobs")
          .select("status, payment_status")
          .eq("id", taxJob.id)
          .maybeSingle();
        if (nowErr) {
          // Throw: the idempotency row rolls back and Stripe retries, so the
          // money is never acked without knowing where it landed.
          throw new Error(`ACH escrow re-read failed for job ${taxJob.id} (PI ${pi.id}): ${nowErr.message}`);
        }
        const nowUnfunded = now != null && (
          now.payment_status == null ||
          ["unpaid", "failed", "abandoned"].includes(String(now.payment_status))
        );
        if (!now) {
          // Deleted between the select and the write: captured money with no
          // job to hold it.
          await pageClosedUnfunded("deleted", null);
          return;
        }
        if (nowUnfunded && now.status === "completed") {
          await pageClosedUnfunded("completed", now.payment_status ?? null);
          return;
        }
        logStep("ACH PI succeeded but job already past unpaid — no escrow write needed", { jobId: taxJob.id, piId: pi.id, paymentStatus: now.payment_status });
        await postSlackOpsAlert({
          kind: "custom",
          severity: "warning",
          title: "ACH PI succeeded but the job was no longer unpaid",
          message: `payment_intent.succeeded fired for an ACH job that was no longer unpaid (now ${String(now.payment_status ?? "null")}). This may indicate a duplicate-funding race or a redelivery after checkout.session.completed already set escrow. No action taken; verify the job's payment state.`,
          fields: { job_id: taxJob.id, payment_intent: pi.id, payment_status: String(now.payment_status ?? "null") },
          oncePerDayKey: `ach-already-funded:${taxJob.id}`,
          seed: taxJob.is_seed ?? false,
        });
      }
    }
  } else {
    // No job found for this PI. Two possible causes:
    // 1. Race: this event fired before checkout.session.completed set
    //    stripe_payment_intent_id on the job. The checkout handler now also
    //    records tax (belt-and-suspenders), so tax will be captured there.
    // 2. Unrelated PI (not from a Helpr Checkout session) — no action needed.
    // Either way, we 200-ACK here; the dedupe row is committed so this event
    // won't retry. checkout.session.completed is the authoritative tax writer.
    logStep("No job found for PI — tax not recorded here (race or unrelated PI)", { piId: pi.id });
  }
}
