// Shops digital downloads (review 11-08; migration 20261108185110): a chargeback on a download's charge stops the
// download while it is open or lost, and gives it back when it is won (shop_digital_dispute_event). Any other
// payment answers 'not_digital' and nothing changes. A failure THROWS, so Stripe redelivers the event (the handlers
// that call this are idempotent on redelivery, and the SQL is too).
import type { WebhookContext } from "../context.ts";

export async function shopDigitalDisputeEvent(
  supabase: WebhookContext["supabase"],
  piId: string | null,
  event: "opened" | "lost" | "won",
  logStep: WebhookContext["logStep"],
): Promise<void> {
  if (!piId) return;
  const { data, error } = await supabase.rpc("shop_digital_dispute_event", { p_payment_intent_id: piId, p_event: event });
  if (error) throw new Error(`shop_digital_dispute_event failed for ${piId}: ${error.message}`);
  if (data !== "not_digital") logStep("Shop download access after a dispute", { pi: piId, event, result: data });
}
