import { PauseCircle, BriefcaseBusiness } from "lucide-react";
import { MoneyNote } from "@/components/money/MoneyNote";
import { PAYOUT_SETUP_NEEDS_HIRE_COPY, PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";

/**
 * The calm notice shown INSTEAD of starting payout setup. No button, no toast,
 * no Stripe call: there is nothing for the member to do. Built on MoneyNote
 * (the one money-state note). `compact` drops the icon for tight spots (a
 * dialog row, a checklist line).
 *
 * It says WHICH reason holds (usePayoutSetupBlock): setup is paused for
 * everyone (owner 2026-10-23), or nobody has hired this member yet, so setup
 * comes with their first hire (owner 2026-10-25). The paused words win while
 * both hold.
 */
export function PayoutSetupPausedNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const block = usePayoutSetupBlock();
  const needsHire = block === "needs_hire";
  const Icon = needsHire ? BriefcaseBusiness : PauseCircle;
  return (
    <MoneyNote className={className}>
      <div
        role="status"
        data-payout-setup-paused=""
        data-payout-setup-block={needsHire ? "needs_hire" : "paused"}
        className="flex items-start gap-2.5"
      >
        {!compact && <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
        <p className="min-w-0">{needsHire ? PAYOUT_SETUP_NEEDS_HIRE_COPY : PAYOUT_SETUP_PAUSED_COPY}</p>
      </div>
    </MoneyNote>
  );
}
