import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banknote } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";

interface PaymentTabProps {
  /** Fires once every query this block renders from has answered — the setup
   *  form — so its height is final. EarningsTab keeps the
   *  connect card's bones in its slot until then (that slot only; the page
   *  itself never waits for Stripe, owner 2026-10-04). */
  onSettled?: () => void;
}

/**
 * The PAYOUT ACCOUNT block of the Money tab: Stripe connect state
 * (PayoutSetupForm). The "Next expected" estimate (last payout + 7 days) was
 * removed (owner 2026-10-25): it showed a date already past.
 *
 * It renders at the top of the Money tab while payouts are not set up (the
 * "Connect to start earning" card), and at the bottom of the Earned half once
 * they are (the bank account). Two things left it with Q1177:
 *  - "Last payout · $X on date" — the payouts list states every payout with
 *    its amount and date, so this line was the same fact twice.
 *  - The Spent card, which is now the Spent half of the tab (SpentSection),
 *    with its range row, unchanged figures and the jobs it sums.
 */
export function PaymentTab({ onSettled }: PaymentTabProps) {
  const { user } = useCurrentUser();
  // Returning from Stripe Connect onboarding used to confirm by toast — a
  // channel that no longer renders — so the round-trip completed in total
  // silence. One-shot inline banner instead; the param is stripped so a
  // refresh doesn't repeat it. `refresh` is Stripe's "the link expired or
  // more info is needed" return, not a failure.
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectReturn] = useState<"success" | "refresh" | null>(() => {
    const v = searchParams.get("connect");
    return v === "success" || v === "refresh" ? v : null;
  });
  if (connectReturn && searchParams.get("connect")) {
    const next = new URLSearchParams(searchParams);
    next.delete("connect");
    setSearchParams(next, { replace: true });
  }

  // While payout setup is paused (owner 2026-10-23) the "tap Set up payouts"
  // return banner is not shown: the form below shows the paused notice.
  const setupPaused = usePayoutSetupPaused();
  const showConnectReturn = connectReturn === "success" || (!!connectReturn && !setupPaused);
  const [formSettled, setFormSettled] = useState(false);
  const markFormSettled = useCallback(() => setFormSettled(true), []);
  const settled = !!user?.id && formSettled;
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);

  return (
    <div className="space-y-section">
      {showConnectReturn && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-2xl"
          style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
          role="status"
        >
          <Banknote className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
            {connectReturn === "success"
              ? "Welcome back from Stripe — your payout status below is up to date."
              : "Stripe needs one more pass — tap Set up payouts to finish."}
          </p>
        </div>
      )}
      {/* Hidden when the form renders nothing (setup switched off, no account). */}
      <section className="space-y-2 has-[>div:empty]:hidden">
        <div className="rounded-2xl liquid-glass p-card">
          <PayoutSetupForm onSettled={markFormSettled} />
        </div>
      </section>

    </div>
  );
}
