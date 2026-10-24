/**
 * paypal-webhook handlers owned by phase 6 (saved payment methods; see ../webhookHandlers.ts
 * for the rules). Only this phase edits this file. The logic is ../vaultTokenDeleted.ts.
 */
import { PayPalEventFinal, PayPalEventRetry, type PayPalEventHandlers } from "./eventTypes.ts";
import { revokeDeletedVaultToken } from "../vaultTokenDeleted.ts";

export const VAULT_EVENT_HANDLERS: PayPalEventHandlers = {
  "VAULT.PAYMENT-TOKEN.DELETED": async (event, ctx) => {
    const a = await revokeDeletedVaultToken(ctx.supabase, ctx.env, event.payload);
    if (a.kind === "final") throw new PayPalEventFinal(a.note);
    if (a.kind === "retry") throw new PayPalEventRetry(a.note);
    return a.note;
  },
};
