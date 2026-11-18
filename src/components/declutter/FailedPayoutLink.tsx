import { Link } from "react-router-dom";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";

/**
 * NIGHT-SELL-soldstates-4: a failed seller payout links to the payout settings. While payout setup is paused for
 * everyone (Stripe, owner 2026-10-23) that screen offers nothing to fix, so the link waits (the payout prompt above
 * the sales shows the paused notice), as SellerPayoutPrompt does.
 */
export function FailedPayoutLink() {
  const paused = usePayoutSetupBlock() === "paused";
  if (paused) return null;
  return <>{" "}<Link to="/profile?tab=payment" className="underline font-semibold">Check your payouts</Link></>;
}

/**
 * Area 06 H2 (11-18): "You get $40 once you set up payouts in Settings." had no way there. The words link to the payout
 * settings, held back while setup is paused for everyone (the same rule as the failed-payout link above).
 */
function PayoutSetupLink({ line }: { line: string }) {
  const paused = usePayoutSetupBlock() === "paused";
  if (paused || !/(once you set up payouts in Settings|once your payout account is ready)\.$/.test(line)) return null;
  return <>{" "}<Link to="/profile?tab=payment" className="underline font-semibold" data-payout-setup-link="">Set up payouts</Link></>;
}

/** The seller's payout line, with the payout settings link when the line waits on setup. */
export function PayoutLineText({ line }: { line: string }) {
  return <>{line}<PayoutSetupLink line={line} /></>;
}
