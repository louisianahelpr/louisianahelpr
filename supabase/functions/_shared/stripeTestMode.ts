/**
 * Stripe TEST-mode scope (lead 11-04, owner rule "test data never reaches the owner").
 *
 * The TEST tax probe (run 41930346999) was processed by stripe-webhook, and its lost dispute and partial refund
 * paged the owner ("Stripe chargeback filed", "chargeback LOST", "Refund made, but the card holder was not fully
 * told"). A TEST-mode event has no real money behind it. stripe-webhook runs every handler for an event with
 * livemode=false inside its scope (stripe-webhook/testModeScope.ts); while it is on, postSlackOpsAlert only logs the
 * alert as test (no Slack, no ledger row, no digest row) and loadAdminIds answers no admins, so no admin notice is
 * written. The event itself is processed exactly as before.
 *
 * No imports on purpose: slack-alerts.ts and adminIds.ts load this in nearly every edge function, so the
 * node:async_hooks import lives only in stripe-webhook, which registers its reader here. Every other function
 * has no reader and answers false.
 */
const HOOK = "__lhStripeTestModeScope";

/** stripe-webhook only: the reader of its per-request scope. */
export function registerStripeTestModeReader(read: () => boolean): void {
  (globalThis as Record<string, unknown>)[HOOK] = read;
}

/** True inside stripe-webhook's handling of a TEST-mode event; false everywhere else. */
export function inStripeTestMode(): boolean {
  const read = (globalThis as Record<string, unknown>)[HOOK];
  return typeof read === "function" && (read as () => boolean)() === true;
}
