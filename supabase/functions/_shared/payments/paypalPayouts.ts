/**
 * PayoutProvider for PayPal Payouts: Plan A's money-out leg (paying Helprs).
 * Phase 1: built and sandbox-proved, called by nothing yet (phase 4).
 *
 * This leg is its own provider on purpose: live PayPal Payouts was denied for
 * the new HELPR, LLC account on 2026-10-23, so another payout service (or Plan
 * B's delayed disbursement) must be able to replace it without touching the
 * money-in leg or the money rules. See types.ts PayoutProvider.
 *
 * Sandbox, 2026-10-23: a batch to an email with no PayPal account answered
 * batch SUCCESS, fee $0.25, item UNCLAIMED (funds come back after 30 days);
 * the same sender_batch_id again answered 400 "Batch with given
 * sender_batch_id already exists" with a link to the original batch.
 */
import type { PayPalClient } from "./paypalClient.ts";
import { ProviderApiError, centsToDollars, type PayoutItemInput, type PayoutProvider, type PayoutSent } from "./types.ts";

const RECIPIENT: Record<PayoutItemInput["destination"]["kind"], { type: string; wallet: string }> = {
  paypal_payer_id: { type: "PAYPAL_ID", wallet: "PAYPAL" },
  email: { type: "EMAIL", wallet: "PAYPAL" },
  venmo_handle: { type: "USER_HANDLE", wallet: "VENMO" },
};

/**
 * ONE payout per batch. provider_payouts.sender_batch_id is UNIQUE per payout row, so the batch
 * key is that row's own key; a multi-item batch would have to share it and hit the UNIQUE after
 * PayPal had already sent the money (review lh-money-escrow 2026-10-23). PayPal allows 15,000.
 */
const MAX_ITEMS = 1;

/** sender_batch_id: letters, digits, _ and -, at most 127 chars (we keep it short and our own). */
export function isValidBatchKey(k: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(k);
}

export function createPayPalPayoutsProvider(client: PayPalClient): PayoutProvider {
  return {
    id: "paypal_payouts",
    env: client.env,

    async payHelprs(batchKey: string, items: PayoutItemInput[], emailSubject: string): Promise<PayoutSent> {
      if (!isValidBatchKey(batchKey)) throw new Error(`invalid payout batch key: ${batchKey}`);
      if (items.length === 0 || items.length > MAX_ITEMS) throw new Error(`payout batch must have exactly ${MAX_ITEMS} item`);
      for (const it of items) {
        if (!Number.isInteger(it.amountCents) || it.amountCents <= 0) throw new Error(`payout item ${it.senderItemId}: amount must be positive cents`);
        if (!it.destination.value.trim()) throw new Error(`payout item ${it.senderItemId}: empty destination`);
      }
      try {
        const r = await client.request<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
          "POST",
          "/v1/payments/payouts",
          {
            // Two locks: PayPal-Request-Id and sender_batch_id are both our batch key.
            idempotencyKey: `lh:payout:${batchKey}`,
            body: {
              sender_batch_header: { sender_batch_id: batchKey, email_subject: emailSubject.slice(0, 255) },
              items: items.map((it) => ({
                recipient_type: RECIPIENT[it.destination.kind].type,
                recipient_wallet: RECIPIENT[it.destination.kind].wallet,
                receiver: it.destination.value.trim(),
                amount: { value: centsToDollars(it.amountCents), currency: "USD" },
                note: it.note.slice(0, 4000),
                sender_item_id: it.senderItemId,
              })),
            },
          },
        );
        const id = r?.batch_header?.payout_batch_id;
        if (!id) {
          // A 2xx without a batch id: PayPal may have sent money, so this is NOT a retryable failure.
          throw new ProviderApiError("paypal_payout_response_shape: 2xx without batch_header.payout_batch_id", 200, "PAYOUT_RESPONSE_SHAPE", null, null);
        }
        return { providerBatchId: id, batchStatus: r.batch_header.batch_status, duplicate: false };
      } catch (e) {
        if (e instanceof ProviderApiError && e.errorName === "PAYOUT_RESPONSE_SHAPE") throw e;
        // A replay of a batch PayPal already has: nothing new was sent. PayPal links the original
        // batch (sandbox 2026-10-23; Payouts does NOT replay on PayPal-Request-Id, it answers this
        // 400), so the caller can re-read it (GET /v1/payments/payouts/{id}) for its outcome.
        if (e instanceof ProviderApiError && e.httpStatus === 400 && /sender_batch_id already exists/i.test(e.message)) {
          const original = e.links.map((h) => /\/v1\/payments\/payouts\/([A-Z0-9]+)(?:[/?#]|$)/.exec(h)?.[1]).find(Boolean);
          // No linked original: we cannot say what happened to the first batch, so this is NOT
          // "already sent". The caller must not mark anything paid on it.
          if (!original) throw new Error(`paypal_duplicate_batch_unlinked: ${batchKey}`);
          return { providerBatchId: original, batchStatus: "DUPLICATE", duplicate: true };
        }
        throw e;
      }
    },

    async cancelUnclaimed(providerItemId: string): Promise<void> {
      if (!/^[A-Z0-9]+$/.test(providerItemId)) throw new Error(`not a PayPal payout item id: ${providerItemId}`);
      await client.request("POST", `/v1/payments/payouts-item/${providerItemId}/cancel`, {
        idempotencyKey: `lh:payout-cancel:${providerItemId}`,
        body: {},
      });
    },
  };
}
