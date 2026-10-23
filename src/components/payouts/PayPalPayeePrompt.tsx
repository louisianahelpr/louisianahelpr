import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { MoneyNote } from "@/components/money/MoneyNote";

/** The setup screen PayPalPayeeCard lives on (the Money tab's payout block). */
export const PAYPAL_PAYEE_SETUP_PATH = "/profile?tab=payment";

/**
 * "Add your PayPal email to get paid": what a jobs payout-setup entry point
 * shows in place of the paused Stripe notice while `paypal_payments` is on for
 * the member and they have not saved a payable PayPal email yet. Rendered only
 * through PayoutSetupNotice, which decides; it links to the one setup screen.
 */
export function PayPalPayeePrompt({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <MoneyNote className={className}>
      <div role="status" data-paypal-payee-prompt="" className="flex items-start gap-2.5">
        {!compact && <Wallet className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
        <p className="min-w-0">
          We pay through PayPal.{" "}
          <Link to={PAYPAL_PAYEE_SETUP_PATH} className="font-semibold underline underline-offset-2">
            Add your PayPal email
          </Link>{" "}
          to get paid.
        </p>
      </div>
    </MoneyNote>
  );
}
