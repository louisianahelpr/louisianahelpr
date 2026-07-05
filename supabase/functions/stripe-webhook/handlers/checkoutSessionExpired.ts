import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

// A recipient started paying the shortfall on a Pay-It-Forward gift (their
// credit was smaller than the job budget), so create-payment's PIF branch
// RESERVED the credit against that job (status='reserved', job_id set) and
// opened a Stripe Checkout for the difference. If they abandon that checkout,
// Stripe expires the session and the credit would otherwise sit 'reserved'
// forever — unusable on any OTHER job and with no TTL to free it. Flip it back
// to 'sent' with job_id cleared so the recipient can redeem it again.
//
// Idempotent: the UPDATE only matches a still-'reserved' row for this exact
// credit, so a re-delivered expiry event (or one that races the completed
// event) is a harmless no-op. If the difference was actually paid, the credit
// is already 'redeemed' and this won't touch it.
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const pifCreditId = (session.metadata as Record<string, string> | null)?.pif_credit_id;
  if (!pifCreditId) return; // not a PIF difference checkout — nothing to unwind

  const { data: freed, error: freeErr } = await supabase
    .from("pif_credits")
    .update({ status: "sent", job_id: null })
    .eq("id", pifCreditId)
    .eq("status", "reserved")
    .select("id")
    .maybeSingle();

  if (freeErr) {
    // Non-fatal: the credit stays reserved and an operator can free it, but a
    // dropped error here would hide a stuck gift. Surface it in the logs.
    logStep("ERROR un-reserving pif credit on expired checkout", { error: freeErr.message, pifCreditId });
    return;
  }
  if (freed) {
    logStep("Abandoned difference checkout — pif credit un-reserved", { pifCreditId, sessionId: session.id });
  } else {
    logStep("Expired checkout — pif credit already consumed/not reserved, no-op", { pifCreditId, sessionId: session.id });
  }
}
