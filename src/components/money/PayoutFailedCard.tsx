import { Link } from "react-router-dom";
import { formatUsd } from "@/components/money/MoneyNote";
import { payoutFailureWords, useOpenPayoutFailures } from "@/components/money/payoutProblems";

/**
 * Board 143, "Your payout didn't go through": the Home "Needs you" card while
 * a bank payout failure is open. Renders nothing otherwise (and nothing while
 * loading or on a read error: no card is better than a wrong one; the notice
 * the webhook sent still stands). Self-contained: Home mounts it as-is.
 *
 * Copy is what is true: Stripe returns a failed payout to the member's payout
 * balance, and it can't go out again until the bank is fixed. No promise of
 * when it is resent (payout timing is Stripe's schedule).
 */
export function PayoutFailedCard() {
  const { data } = useOpenPayoutFailures();
  const latest = data?.[0];
  if (!latest) return null;
  const words = payoutFailureWords(latest.failure_code);
  // More than one open failure: say so, rather than show one amount as if it
  // were the whole story (lh-money-escrow review, 2026-10-21).
  const more = (data?.length ?? 1) - 1;
  return (
    <div
      data-payout-failed-card=""
      className="rounded-2xl px-4 py-3"
      style={{ background: "hsl(var(--card))", border: "1.5px solid hsl(var(--destructive))" }}
    >
      <p className="flex items-center gap-1.5 text-ds-12 font-semibold" style={{ color: "hsl(var(--destructive-ink))" }}>
        <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: "hsl(var(--destructive))" }} />
        Needs you
      </p>
      <p className="mt-1 font-sans font-bold text-ds-16 leading-snug text-foreground">Your payout didn't go through</p>
      <p className="mt-1 text-ds-13 leading-snug text-muted-foreground">
        <span className="font-bold tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>{formatUsd(latest.amount_cents)}</span>{" "}
        came back{more > 0 ? `, and ${more} more payout${more === 1 ? "" : "s"} too` : ""}. {words ? `${words} ` : ""}It's back in your payout balance. Update your bank or card so it can be sent again.
      </p>
      <Link
        to="/profile?tab=earnings"
        className="btn-grad-primary mt-3 inline-flex items-center justify-center h-10 px-5 rounded-full text-ds-13 font-bold"
      >
        Fix bank
      </Link>
    </div>
  );
}
