/**
 * How many cents Stripe actually CAPTURED for a job, from its PaymentIntent.
 *
 * Both payout paths (`release-payout`, `process-scheduled-payouts`) cap the
 * transfer at what the escrow was funded with, so both need this number, and
 * both had the same latent bug when the cap first shipped: they read
 * `pi.amount_received` and treated a non-numeric value as ZERO.
 *
 * Zero is the one answer that must never be inferred. It is indistinguishable
 * from "the poster paid nothing", so a Stripe response that simply omitted the
 * field — an API-version change, a partially-expanded object, a mocked client
 * in a test — would have silently capped every payout at the gift balance and
 * refused the lot. One missing field, every payout on the platform stops, and
 * the admin alert says "payout exceeds captured escrow", which points the
 * on-call at the poster's budget instead of at the integration.
 *
 * So this returns a discriminated result rather than a number:
 *
 *   - `captured`   — a trustworthy figure, safe to cap against.
 *   - `unverifiable` — we could not establish what was captured. The caller
 *     must refuse the payout (money is still money), but must report it as its
 *     own condition, because the fix is an engineering one, not a refund.
 *
 * `amount_received` is the primary source: it is what Stripe actually took.
 * `amount` is the documented fallback and is EQUAL to `amount_received` on a
 * succeeded PaymentIntent — it is the intended charge, and once the intent has
 * succeeded the intent was met. It is only consulted when `amount_received` is
 * unusable, and it is never consulted for an intent that has not succeeded,
 * where `amount` is an intention and nothing has been collected at all.
 */
export type CapturedEscrow =
  | { kind: "captured"; cents: number; source: "amount_received" | "amount" }
  | { kind: "unverifiable"; reason: string };

/** The fields this needs — narrower than Stripe's type so tests can pass a literal. */
export interface CapturableIntent {
  status?: string | null;
  amount_received?: number | null;
  amount?: number | null;
}

const usable = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

export function resolveCapturedEscrow(pi: CapturableIntent | null | undefined): CapturedEscrow {
  if (!pi) return { kind: "unverifiable", reason: "no payment intent object" };

  // Only a succeeded intent has captured anything. Callers check status too and
  // refuse earlier with a better message; this is the belt to that braces, so a
  // future caller cannot read `amount` off an uncaptured intent and pay it out.
  if (pi.status !== "succeeded") {
    return { kind: "unverifiable", reason: `payment intent status "${pi.status ?? "unknown"}" is not succeeded` };
  }

  if (usable(pi.amount_received)) {
    return { kind: "captured", cents: pi.amount_received, source: "amount_received" };
  }
  if (usable(pi.amount)) {
    return { kind: "captured", cents: pi.amount, source: "amount" };
  }
  return {
    kind: "unverifiable",
    reason: "succeeded payment intent carried neither a usable amount_received nor amount",
  };
}
