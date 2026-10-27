import { Link } from "react-router-dom";
import { usePayoutSetupHireAllowed } from "@/hooks/usePayoutSetupHireAllowed";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { DeclutterNotice } from "./declutterUi";

/**
 * The one payout prompt on the Sell and Move screens (owner 2026-10-27: list
 * first, set up at first sale). Shown only when ALL of these hold:
 *   - the server says money is owed to this member
 *     (payout_setup_hire_allowed_for_me: a paid sale, a delivery, or a hire);
 *   - Stripe says their payouts are not ready (useStripeConnectStatus "setup");
 * then the paused notice while setup is paused for everyone, else the prompt.
 * A member who is owed nothing sees nothing (and Stripe is not even asked):
 * listing never waits on payouts. The words name the money waiting, not a
 * sale, because a hire also counts.
 */
export function SellerPayoutPrompt() {
  const owed = usePayoutSetupHireAllowed();
  if (!owed) return null;
  return <OwedPayoutPrompt />;
}

function OwedPayoutPrompt() {
  // The one reader every payout-setup entry point uses (payoutSetupPausedEntryPoints guard). Money is owed
  // here, so its only possible "no" is the pause for everyone.
  const paused = usePayoutSetupBlock() === "paused";
  const { payoutPrompt } = useStripeConnectStatus();
  if (payoutPrompt.kind !== "setup") return null;
  if (paused) return <PayoutSetupPausedNotice />;
  return (
    <DeclutterNotice tone="warn" title="Set up payouts to get paid.">
      You have money waiting. It is held safely until payouts are set up, one short step.{" "}
      <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
    </DeclutterNotice>
  );
}
