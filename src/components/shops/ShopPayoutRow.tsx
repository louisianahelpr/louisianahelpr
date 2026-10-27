/**
 * SH12 (lead 2026-10-19): the payout-setup row on the shop dashboard. Shown
 * only while this account cannot be paid yet (or the check failed), and only
 * once a sale is owed to the owner (2026-10-27); nothing once payouts work. It is the Profile's own row and hook
 * (useStripeConnectStatus + PayoutStatusRow), so both places always agree,
 * and "Set Up" goes to the one payout screen (/profile?tab=payment), never a
 * second one.
 */
import { useNavigate } from "react-router-dom";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { PayoutStatusRow } from "@/components/profile/profileLanding/PayoutStatusRow";

export default function ShopPayoutRow() {
  const navigate = useNavigate();
  const { payoutPrompt, refetchStatus } = useStripeConnectStatus();
  // Owner ruling 2026-10-23: payout setup is paused; the row says so instead of "Set up".
  const setupBlock = usePayoutSetupBlock();
  // Setup only when owed (owner 2026-10-27): an owner with no captured order
  // and no payouts has nothing to set up for yet, so the row waits for the
  // first sale. A failed status read still shows (with its Retry).
  if (setupBlock === "needs_hire" && payoutPrompt.kind === "setup") return null;
  return (
    <PayoutStatusRow
      prompt={payoutPrompt}
      onSetUp={() => navigate("/profile?tab=payment")}
      onRetry={refetchStatus}
      setupPaused={setupBlock === "paused"}
    />
  );
}
