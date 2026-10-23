/**
 * SH12 (lead 2026-10-19): the payout-setup row on the shop dashboard. Shown
 * only while this account cannot be paid yet (or the check failed); nothing
 * once payouts work. It is the Profile's own row and hook
 * (useStripeConnectStatus + PayoutStatusRow), so both places always agree,
 * and "Set Up" goes to the one payout screen (/profile?tab=payment), never a
 * second one.
 */
import { useNavigate } from "react-router-dom";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { PayoutStatusRow } from "@/components/profile/profileLanding/PayoutStatusRow";

export default function ShopPayoutRow() {
  const navigate = useNavigate();
  const { payoutPrompt, refetchStatus } = useStripeConnectStatus();
  // Owner ruling 2026-10-23: payout setup is paused; the row says so instead of "Set up".
  const setupPaused = usePayoutSetupPaused();
  return (
    <PayoutStatusRow
      prompt={payoutPrompt}
      onSetUp={() => navigate("/profile?tab=payment")}
      onRetry={refetchStatus}
      setupPaused={setupPaused}
    />
  );
}
