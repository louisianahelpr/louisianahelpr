// H3 (Declutter buy audit 11-08): the server half of the Declutter buy funnel (migration 20261108203450,
// declutter_funnel_server_event): 'paid' when declutter_mark_order_paid answers 'paid', and 'payment_failed' with
// Stripe's last_payment_error code and decline_code (never a card number, name or email). A failure also stamps the
// order (last_payment_error_code / last_decline_code / last_payment_failed_at).
//
// Best-effort: a funnel row is a measurement, never part of the money path, so this never throws
// (a thrown webhook is retried and would replay the money steps). A failed write is logged, not silent.
import type { WebhookContext } from "../context.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordDeclutterFunnel(
  ctx: Pick<WebhookContext, "supabase" | "logStep">,
  step: "paid" | "payment_failed",
  orderId: string | null | undefined,
  errorCode: string | null = null,
  declineCode: string | null = null,
): Promise<void> {
  if (!orderId || !UUID_RE.test(orderId)) return;
  try {
    const { error } = await ctx.supabase.rpc("declutter_funnel_server_event", {
      p_step: step, p_order_id: orderId, p_error_code: errorCode, p_decline_code: declineCode,
    });
    if (error) ctx.logStep("Declutter funnel event not recorded", { step, orderId, error: error.message });
  } catch (e) {
    // Logged, not rethrown: a funnel row is a measurement; a throw would make Stripe replay the money steps.
    ctx.logStep("Declutter funnel event not recorded", { step, orderId, error: caughtMessage(e) });
  }
}
