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
