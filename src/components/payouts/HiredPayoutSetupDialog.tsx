import { BadgeDollarSign, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { useStartPayoutSetup } from "@/hooks/useStartPayoutSetup";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import {
  FINISH_PAYOUT_SETUP_LABEL,
  HIRED_PAYOUT_BODY,
  HIRED_PAYOUT_PAUSED_BODY,
  HIRED_PAYOUT_PAUSED_TITLE,
  HIRED_PAYOUT_TITLE,
} from "@/lib/payoutAfterHire";

/**
 * "You're hired. Set up payouts to get paid." (owner decision 2026-10-25,
 * switch payout_after_hire). Opens right after an accept goes through for a
 * Helpr whose payout account is not ready: the job is theirs already, their
 * pay waits, and one button runs Stripe's ID check and bank setup in one step.
 * "Later" closes it; the job card keeps saying what is left
 * (PayoutSetupJobNotice) and reminders follow.
 *
 * While setup is not offered (usePayoutSetupPaused: paused for everyone), the
 * button gives way to the paused notice; the pay is still held safely.
 */
export function HiredPayoutSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const setupPaused = usePayoutSetupPaused();
  const { start, loading } = useStartPayoutSetup("hired_prompt", () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} data-hired-payout-setup="">
        <DialogHero title={setupPaused ? HIRED_PAYOUT_PAUSED_TITLE : HIRED_PAYOUT_TITLE} />
        <DialogBody>
          <p>{setupPaused ? HIRED_PAYOUT_PAUSED_BODY : HIRED_PAYOUT_BODY}</p>
          {setupPaused && <PayoutSetupPausedNotice compact className="mt-3" />}
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryAction onClick={() => onOpenChange(false)} disabled={loading}>
            {setupPaused ? "OK" : "Later"}
          </DialogSecondaryAction>
          {!setupPaused && (
            <DialogPrimaryAction onClick={() => void start()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BadgeDollarSign className="w-4 h-4 mr-2" />}
              {FINISH_PAYOUT_SETUP_LABEL}
            </DialogPrimaryAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
