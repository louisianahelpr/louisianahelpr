import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  logStep("Payment intent succeeded", { id: pi.id, amount: pi.amount });

  // Record the confirmed sales tax amount on the job
  const { data: taxJob } = await supabase
    .from("jobs")
    .select("id, customer_id, title, sales_tax_amount")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  if (taxJob) {
    // Extract actual tax from Stripe if available via latest_charge
    let confirmedTax = taxJob.sales_tax_amount || 0;
    try {
      const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge as any)?.id;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
        // If Stripe Tax was used, the tax is embedded in the charge metadata or line items
        const stripeTax = (charge.metadata as any)?.sales_tax_amount;
        if (stripeTax) {
          confirmedTax = parseFloat(stripeTax);
        }
      }
    } catch (e) {
      logStep("Could not retrieve charge tax details", { error: String(e) });
    }

    await supabase.from("jobs").update({
      sales_tax_amount: confirmedTax,
    }).eq("id", taxJob.id);

    logStep("Sales tax recorded on job", { jobId: taxJob.id, tax: confirmedTax });
  }
}
