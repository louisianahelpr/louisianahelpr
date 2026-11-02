import { formatPriceExact } from "@/lib/format";

/**
 * The /payment-success sentence for a funded (captured) job, by where its money is. `formatPriceExact`, never
 * `formatPrice`: a receipt states the exact sum (see PaymentSuccess.tsx).
 *   released   the payout went out: "was paid and has already been released to your Helpr" (ME-041).
 *   payingOut  payout_pending, both sides confirmed (Q2087): "on its way to your Helpr", never "held until you confirm".
 *   otherwise  escrow: "is held securely — released when you confirm the work is done".
 */
export function PaidAmountLine({ amount, released, payingOut }: { amount: number | null; released: boolean; payingOut: boolean }) {
  const sum = amount != null ? (
    <>
      <span className="font-semibold" style={{ color: "hsl(var(--accent-ink))" }}>
        ${formatPriceExact(amount)}
      </span>{" "}
    </>
  ) : null;
  if (released) return sum ? <>{sum}was paid and has already been released to your Helpr.</> : <>This payment was already released to your Helpr.</>;
  if (payingOut) {
    return sum
      ? <>{sum}was paid. The work is confirmed, and the money is on its way to your Helpr.</>
      : <>The work is confirmed, and the money is on its way to your Helpr.</>;
  }
  return sum ? <>{sum}is held securely — released when you confirm the work is done.</> : <>Held securely until you confirm the work is done.</>;
}
