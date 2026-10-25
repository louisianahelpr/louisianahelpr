/**
 * The payment_refunds.reason a poster's cancel refund records: what it was
 * and exactly what was kept from it, in dollars, naming only the parts that
 * were really kept.
 *
 * Why: void-cancelled-payments wrote "cancellation refund (minus cancellation
 * + service fee)" on EVERY cancel refund, and cancel_escrow wrote "minus
 * non-refundable service fee". Jobs 375000de and 1251173a (2026-10-24) expired
 * with nobody hired: no cancellation fee and no service fee was kept, only
 * Stripe's card fee ($2.48; $4.33) and, on the taxed one, the sales tax on it
 * ($0.49, owner rule Q2082 (a)). The ledger named two fees that did not exist
 * and missed the two that did.
 *
 * Zero imports on purpose: the edge harness runs the real module.
 */
export interface KeptParts {
  /** A late-cancel fee paid to the Helpr. */
  cancellationFeeCents?: number;
  /** A crew's block fees for spots closed close to the start. */
  blockFeeCents?: number;
  /** A legacy job's checkout service fee (kept in place of the card fee when larger). */
  serviceFeeCents?: number;
  /** Stripe's card processing fee. */
  processingFeeCents?: number;
  /** The sales tax on what was kept (owner, 2026-10-18, Q2082 (a)). */
  taxCents?: number;
  /** A first job's one-time $2 setup fee. */
  setupFeeCents?: number;
}

function c(n: number | null | undefined): number {
  const v = Math.round(Number(n ?? 0));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "cancellation refund (minus $4.33 card processing fee and $0.49 sales tax on what was kept)", or "(nothing kept)". */
export function refundReasonWithKeptParts(prefix: string, kept: KeptParts): string {
  const parts = [
    c(kept.cancellationFeeCents) > 0 ? `${dollars(c(kept.cancellationFeeCents))} cancellation fee paid to the Helpr` : null,
    c(kept.blockFeeCents) > 0 ? `${dollars(c(kept.blockFeeCents))} crew spot fees` : null,
    c(kept.serviceFeeCents) > 0 ? `${dollars(c(kept.serviceFeeCents))} service fee` : null,
    c(kept.processingFeeCents) > 0 ? `${dollars(c(kept.processingFeeCents))} card processing fee` : null,
    c(kept.setupFeeCents) > 0 ? `${dollars(c(kept.setupFeeCents))} one-time setup fee` : null,
    c(kept.taxCents) > 0 ? `${dollars(c(kept.taxCents))} sales tax on what was kept` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return `${prefix} (nothing kept)`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${prefix} (minus ${list})`;
}
