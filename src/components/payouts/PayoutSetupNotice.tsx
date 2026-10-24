import { Link } from "react-router-dom";
import { usePayPalPayee } from "@/hooks/usePayPalPayee";
import { MoneyNote } from "@/components/money/MoneyNote";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { PayPalPayeePrompt, PAYPAL_PAYEE_SETUP_PATH } from "@/components/payouts/PayPalPayeePrompt";

/**
 * The note a JOBS payout-setup entry point shows while Stripe payout setup is
 * paused (usePayoutSetupPaused):
 *   - `paypal_payments` on: by where the member's PayPal email stands
 *     (usePayPalPayee): nothing while loading or once a payable email is saved
 *     (a saved email IS payout setup for jobs, helper_accept_missing,
 *     20261023231647); "Add your PayPal email" with none; the hold with one on
 *     hold; and "we couldn't check" when the read failed, never "add";
 *   - otherwise: the calm paused notice, as before.
 * Declutter and Shops keep PayoutSetupPausedNotice: a PayPal email does not
 * pay out their sales yet.
 */
export function PayoutSetupNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const paypal = usePayPalPayee();
  if (paypal.on) {
    switch (paypal.status) {
      case "loading":
      case "ready":
        return null;
      case "none":
        return <PayPalPayeePrompt compact={compact} className={className} />;
      case "on_hold":
        return (
          <MoneyNote className={className}>
            <p role="status" data-paypal-payee-hold="">Your payouts are on hold. Write to us from Help and we'll sort it out.</p>
          </MoneyNote>
        );
      case "error":
        return (
          <MoneyNote className={className}>
            <p role="status" data-paypal-payee-unknown="">
              We couldn't check your PayPal email just now.{" "}
              <Link to={PAYPAL_PAYEE_SETUP_PATH} className="font-semibold underline underline-offset-2">Check it here</Link>.
            </p>
          </MoneyNote>
        );
    }
  }
  return <PayoutSetupPausedNotice compact={compact} className={className} />;
}
