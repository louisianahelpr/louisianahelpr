import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

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
    .select("id, sales_tax_amount")
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
