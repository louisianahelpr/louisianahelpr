// PayoutSetupBanner — extracted from Profile.tsx as the first
// god-component split for that file. Self-contained: a conditional
// nag prompting an approved user to connect Stripe before they can
// be paid out.
//
// Reusable: the same banner could surface on Activity / Dashboard
// when a user is about to apply or accept their first job. Keeping
// it presentational so the parent decides when to show it +
// what to do on click (typically: navigate to a payment-setup tab).

import { Button } from "@/components/ui/button";
import { AlertTriangle, CreditCard } from "lucide-react";

interface PayoutSetupBannerProps {
  /** Whether to render the banner. Parent computes from profile +
   *  stripeConnectStatus to keep this component dumb. */
  show: boolean;
  /** Tap handler — typically routes to the payment tab. */
  onSetupClick: () => void;
}

export function PayoutSetupBanner({ show, onSetupClick }: PayoutSetupBannerProps) {
  if (!show) return null;
  return (
    <div className="rounded-[24px] border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Set up your payout account</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add a bank account in Payment Settings to accept jobs and receive payments.
          </p>
        </div>
      </div>
      <Button onClick={onSetupClick} className="w-full" size="sm">
        <CreditCard className="w-4 h-4 mr-2" /> Go to Payment Settings
      </Button>
    </div>
  );
}
