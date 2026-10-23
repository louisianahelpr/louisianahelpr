import { usePayPalPayee } from "@/hooks/usePayPalPayee";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { PayPalPayeePrompt } from "@/components/payouts/PayPalPayeePrompt";

/**
 * The note a JOBS payout-setup entry point shows while Stripe payout setup is
 * paused (usePayoutSetupPaused):
 *   - `paypal_payments` on, no payable PayPal email yet: "Add your PayPal email"
 *     (PayPalPayeePrompt), since a saved email IS payout setup for jobs
 *     (helper_accept_missing, 20261023231647);
 *   - `paypal_payments` on and a payable email saved: nothing (setup is done);
 *   - otherwise: the calm paused notice, as before.
 * Declutter and Shops keep PayoutSetupPausedNotice: a PayPal email does not
 * pay out their sales yet.
 */
export function PayoutSetupNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const paypal = usePayPalPayee();
  if (paypal.on) {
    if (paypal.loading || paypal.ready) return null;
    return <PayPalPayeePrompt compact={compact} className={className} />;
  }
  return <PayoutSetupPausedNotice compact={compact} className={className} />;
}
