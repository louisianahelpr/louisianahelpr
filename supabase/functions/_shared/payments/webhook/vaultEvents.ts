/**
 * paypal-webhook handlers owned by phase 6 (saved payment methods; see ../webhookHandlers.ts
 * for the rules). Only this phase edits this file.
 *
 * VAULT.PAYMENT-TOKEN.DELETED: the payer (or PayPal) removed a saved method. It is retired at
 * once (paypal_saved_payment_methods active -> revoked), so no repeat visit or auto-tip is ever
 * charged to it again. Idempotent: a token already revoked, or one we never saved, is final.
 */
import { PayPalEventFinal, PayPalEventRetry, type PayPalEventHandlers } from "./eventTypes.ts";

/** The vault token id out of a verified event (resource.id). */
export function vaultTokenIdOf(payload: unknown): string | null {
  const id = (payload as { resource?: { id?: unknown } } | null)?.resource?.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export const VAULT_EVENT_HANDLERS: PayPalEventHandlers = {
  "VAULT.PAYMENT-TOKEN.DELETED": async (event, ctx) => {
    const vaultId = vaultTokenIdOf(event.payload);
    if (!vaultId) throw new PayPalEventFinal("vault event without a token id");
    const { data, error } = await ctx.supabase
      .from("paypal_saved_payment_methods")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("env", ctx.env)
      .eq("vault_id", vaultId)
      .eq("status", "active")
      .select("id");
    if (error) throw new PayPalEventRetry(`saved method revoke failed: ${error.message}`);
    return (data ?? []).length > 0 ? `revoked saved method for token ${vaultId}` : `token ${vaultId} not active here (already revoked or never saved)`;
  },
};
