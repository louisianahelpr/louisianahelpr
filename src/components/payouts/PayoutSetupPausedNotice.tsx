import { PauseCircle } from "lucide-react";
import { MoneyNote } from "@/components/money/MoneyNote";
import { PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";

/**
 * The calm notice shown INSTEAD of starting payout setup. No button, no toast,
 * no Stripe call: there is nothing for the member to do. Built on MoneyNote
 * (the one money-state note). `compact` drops the icon for tight spots (a
 * dialog row, a checklist line).
 */
export function PayoutSetupPausedNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <MoneyNote className={className}>
      <div role="status" data-payout-setup-paused="" className="flex items-start gap-2.5">
        {!compact && <PauseCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
        <p className="min-w-0">{PAYOUT_SETUP_PAUSED_COPY}</p>
      </div>
    </MoneyNote>
  );
}
