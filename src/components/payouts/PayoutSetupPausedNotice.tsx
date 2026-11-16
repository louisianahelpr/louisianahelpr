import { BriefcaseBusiness } from "lucide-react";
import { PAYOUT_SETUP_NEEDS_HIRE_COPY } from "@/lib/payoutSetupPaused";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";

/**
 * The calm notice shown INSTEAD of starting payout setup. No button, no toast,
 * no Stripe call: there is nothing for the member to do. A quiet neutral card
 * (M12, iOS audit 11-16), not MoneyNote's rust money-state tint. `compact` drops the icon for tight spots (a
 * dialog row, a checklist line).
 *
 * It shows only the NOT-HIRED-YET reason (usePayoutSetupBlock): nobody has
 * hired this member yet, so setup comes with their first hire (owner
 * 2026-10-25). While setup is switched off for everyone it renders NOTHING
 * (owner 2026-10-25, Money page: "remove that red box. its not paused").
 */
export function PayoutSetupPausedNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const block = usePayoutSetupBlock();
  if (block !== "needs_hire") return null;
  return (
    // M12 (iOS audit 11-16): a QUIET card, not the rust money-state note: nothing is wrong and nothing is for the
    // member to do, and the rust box read as an error on an empty Money page. The neutral tint the skeleton draws.
    <div data-payout-quiet-note="" className={`rounded-2xl px-4 py-3 text-ds-13 leading-snug text-muted-foreground ${className}`} style={{ background: "hsl(var(--olivewood) / 0.05)" }}>
      <div
        role="status"
        data-payout-setup-paused=""
        data-payout-setup-block="needs_hire"
        className="flex items-start gap-2.5"
      >
        {!compact && <BriefcaseBusiness className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
        <p className="min-w-0">{PAYOUT_SETUP_NEEDS_HIRE_COPY}</p>
      </div>
    </div>
  );
}
