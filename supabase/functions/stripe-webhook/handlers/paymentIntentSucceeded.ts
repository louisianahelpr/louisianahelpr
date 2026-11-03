import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { settleOnboardingFee } from "./settleOnboardingFee.ts";
import { pageGiftLeftSpentOnCardFunding } from "./_giftLeftSpentOnCardFunding.ts";
import { commitJobSiteTax } from "./_jobTaxCommit.ts";
import { JOB_TAX_CALC_KEY, JOB_TAX_CENTS_KEY } from "../../_shared/jobTaxAddress.ts";

/**
 * Q1975: the setup fee on a bank (ACH) checkout is settled HERE, when the
 * debit lands, never at checkout.session.completed (which defers it on an
 * "unpaid" session). Runs only on the write that moved the job to escrow, so
 * a redelivery (job already escrow) never settles twice; and only when the
 * charge really is a bank debit, so a card retry on the same checkout (which
 * checkout.session.completed settles itself) is never settled a second time,
 * which would refund the real fee as a "duplicate".
 *
 * Never throws: the job is already funded by the time this runs. A fee it
 * cannot settle is paged so a person sets it by hand.
 */
async function settleDeferredSetupFee(pi: Stripe.PaymentIntent, ctx: WebhookContext, jobId: string, isSeed: boolean): Promise<void> {
  const { stripe, logStep } = ctx;
  if ((pi.metadata as { onboarding_fee_charged?: string } | null)?.onboarding_fee_charged !== "true") return;
  const page = async (why: string) => {
    logStep("ERROR settling the deferred setup fee", { piId: pi.id, jobId, why });
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Bank payment settled but its setup fee was not recorded: set it by hand",
      message: `A bank (ACH) payment that carried the one-time setup fee settled, but the fee could not be recorded (${why}). Set profiles.onboarding_fee_paid for the poster by hand, and jobs.onboarding_fee_amount on the job, or they may be asked to pay it again.`,
      fields: { job_id: jobId, payment_intent: pi.id },
      oncePerDayKey: `deferred-setup-fee:${pi.id}`,
      seed: isSeed,
    });
  };
  let session: Stripe.Checkout.Session | undefined;
  try {
    const listed = await stripe.checkout.sessions.list({
      payment_intent: pi.id,
      limit: 1,
      expand: ["data.payment_intent.latest_charge"],
    });
    session = listed?.data?.[0];
  } catch (e) {
    await page(`checkout session read failed: ${(e as { message?: string })?.message ?? String(e)}`);
    return;
  }
  if (!session) {
    await page("no checkout session found for this payment");
    return;
  }
  const expandedPi = session.payment_intent as Stripe.PaymentIntent | string | null;
  const charge = expandedPi && typeof expandedPi === "object" ? expandedPi.latest_charge : null;
  const methodType = charge && typeof charge === "object" ? charge.payment_method_details?.type : undefined;
  if (methodType === undefined) {
    await page("the payment's charge could not be read");
    return;
  }
  // A card (or Link) payment completed its checkout "paid", and
  // checkout.session.completed settled its fee already.
  if (methodType !== "us_bank_account") return;
  try {
    await settleOnboardingFee(session, pi.id, ctx);
  } catch (e) {
    await page(`settling failed: ${(e as { message?: string })?.message ?? String(e)}`);
  }
}

/** A job in one of these already holds its money: this PI is its own funding. */
const FUNDED_PAYMENT_STATUSES = new Set(["escrow", "payout_pending", "released"]);

/**
 * The PI's charge payment_method_details.type (us_bank_account, card, link...),
 * from the event's latest_charge when it is expanded, else a PI retrieve with
 * latest_charge expanded. null when it cannot be read (Q1994: fail closed).
 */
async function chargePaymentMethodType(
  stripe: Stripe,
  pi: Stripe.PaymentIntent,
  logStep: WebhookContext["logStep"],
): Promise<string | null> {
  const typeOf = (charge: unknown): string | null => {
    const t = (charge as { payment_method_details?: { type?: unknown } } | null)?.payment_method_details?.type;
    return typeof charge === "object" && charge && typeof t === "string" && t ? t : null;
  };
  const fromEvent = typeOf(pi.latest_charge);
  if (fromEvent) return fromEvent;
  try {
    const full = await stripe.paymentIntents.retrieve(pi.id, { expand: ["latest_charge"] });
    return typeOf(full?.latest_charge);
  } catch (err) {
    logStep("WARN: PI retrieve failed while reading the payment method", { piId: pi.id, error: String(err) });
    return null;
  }
}

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  const { stripe, supabase, logStep } = ctx;
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

  // Q2083 (b): the money is captured, so a job-site tax is now owed: commit
  // it to Stripe Tax. Read from the PaymentIntent alone, so it runs even when
  // this event beats checkout.session.completed to the job row. Never throws.
  await commitJobSiteTax({ stripe, pi, logStep, seed: taxJob?.is_seed === true });

  if (taxJob) {
    // Take Stripe's number whenever Stripe HAS one — including a genuine $0.
    // This was `taxAmountCents > 0 ? ... : existing`, which meant a real zero
    // could never clear a wrong stored estimate: the row kept whatever was
    // written at insert time forever. Most jobs are in exempt categories and
    // Stripe collects exactly $0 on them, so that branch was the normal case,
    // not the edge case. Fall back to the stored value ONLY when the field is
    // absent (older PI shape / Stripe Tax not applied), which is genuinely
    // "no information", not "zero".
    // Q2083 (b): a job taxed at the JOB ADDRESS charged its tax as its own
    // line (automatic_tax off), so Stripe's own tax figure is absent or 0;
    // the figure charged is on the PaymentIntent as job_tax_cents.
    const piMd = (pi.metadata ?? {}) as Record<string, string>;
    const siteTax = String(piMd[JOB_TAX_CALC_KEY] ?? "").startsWith("taxcalc_") && /^\d+$/.test(String(piMd[JOB_TAX_CENTS_KEY] ?? ""))
      ? Number(piMd[JOB_TAX_CENTS_KEY])
      : null;
    const taxTotal = (pi.amount_details as any)?.tax?.total_tax_amount;
    const taxAmountCents: number | null = siteTax !== null ? siteTax : typeof taxTotal === "number" ? taxTotal : null;
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
        await settleDeferredSetupFee(pi, ctx, taxJob.id, taxJob.is_seed ?? false);
        // Q1983 (bank half): a bank debit that settled later just funded a job that was not funded; a gift an
        // earlier, never-funded checkout left 'redeemed' on it paid for nothing. Same alert-only check as the
        // card path in checkoutSessionCompleted (never throws). The gift this payment consumed itself (a gift
        // difference payment carries metadata.gift_card_id on its PaymentIntent) is not paged.
        await pageGiftLeftSpentOnCardFunding(supabase, {
          jobId: taxJob.id,
          sessionId: pi.id,
          consumedGiftId: ((pi.metadata as { gift_card_id?: string } | null)?.gift_card_id) || null,
          logStep,
          method: "bank",
        });
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
    } else if (!FUNDED_PAYMENT_STATUSES.has(String(taxJob.payment_status))) {
      // Q1994: the job is past funding without being funded by this payment
      // (refunded, cancelled, cancelling, chargeback, held). A CARD payment
      // here is a redelivery of a charge that was settled, then refunded or
      // closed: nothing to do. A BANK (ACH) payment that settles now is
      // captured money with no escrow to hold it, so ops refund it. Told
      // apart by the charge's payment_method_details.type (as Q1975 does);
      // when that cannot be read, fail closed and page.
      const paidWith = await chargePaymentMethodType(stripe, pi, logStep);
      if (paidWith !== "us_bank_account" && paidWith !== null) {
        logStep("Card-type PI succeeded on a closed job — a redelivery, no action", { jobId: taxJob.id, piId: pi.id, paymentStatus: taxJob.payment_status, paidWith });
        return;
      }
      const known = paidWith === "us_bank_account";
      logStep("PI succeeded on a closed unfunded job — ops paged to refund", { jobId: taxJob.id, piId: pi.id, paymentStatus: taxJob.payment_status, paidWith });
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: known
          ? "Bank payment settled on a job that is already refunded or closed — refund it"
          : "Payment settled on a closed job and its payment method could not be read — check it",
        message: known
          ? `A bank (ACH) payment settled for job ${taxJob.id}, but the job's payment is '${String(taxJob.payment_status)}' (job ${String(taxJob.status)}), so there is no escrow to hold it. The money is captured. Refund this PaymentIntent from the Stripe dashboard.`
          : `payment_intent.succeeded fired for job ${taxJob.id}, whose payment is '${String(taxJob.payment_status)}' (job ${String(taxJob.status)}). The charge's payment method could not be read, so this may be a bank (ACH) payment that settled with no escrow to hold it. Open this PaymentIntent in the Stripe dashboard: if it is a bank payment that was not refunded, refund it.`,
        fields: { job_id: taxJob.id, payment_intent: pi.id, job_status: String(taxJob.status), payment_status: String(taxJob.payment_status), method: paidWith ?? "unknown" },
        oncePerDayKey: `ach-settled-closed-job:${pi.id}`,
        seed: taxJob.is_seed ?? false,
      });
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
