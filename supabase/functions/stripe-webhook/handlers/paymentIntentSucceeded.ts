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
  const { data: taxJob } = await supabase
    .from("jobs")
    .select("id, sales_tax_amount")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  if (taxJob) {
    const taxAmountCents = (pi.amount_details as any)?.tax?.total_tax_amount ?? 0;
    const confirmedTax = taxAmountCents > 0
      ? taxAmountCents / 100
      : (taxJob.sales_tax_amount || 0);

    await supabase.from("jobs").update({
      sales_tax_amount: confirmedTax,
    }).eq("id", taxJob.id);

    logStep("Sales tax recorded on job", { jobId: taxJob.id, tax: confirmedTax, fromStripe: taxAmountCents > 0 });
  }
}
