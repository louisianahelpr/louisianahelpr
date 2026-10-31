/**
 * The one short screen a first-time claimer reads (owner 2026-10-30: "First-timers must be told plainly why it's
 * required, once and never again. Item stays free."). Asking is free; once the giver picks them, a first-timer pays
 * the one-time fee FIRST, then verifies, once ever. The server decides at the free checkout (declutter_free_claim_gate,
 * refusal setup_fee_required_to_claim); this screen only answers that refusal, so it can never show to a member who has paid.
 * It is where the pay button lives, so someone who backs out meets it again next time and never after paying.
 * Mounted once, inside IdentityCheckHost: nothing draws while the ID check switch is off.
 */
import { useSyncExternalStore, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { formatFeeLabel, useOnboardingFeeCents } from "@/hooks/useOnboardingFee";
import { openIdentityCheck } from "@/lib/identityCheck";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import {
  closeFreeClaimFirstTime,
  isFreeClaimFirstTimeOpen,
  payAccountSetupFee,
  subscribeFreeClaimFirstTime,
} from "@/lib/declutter/setupFee";

export function FreeClaimFirstTime() {
  const open = useSyncExternalStore(subscribeFreeClaimFirstTime, isFreeClaimFirstTimeOpen, isFreeClaimFirstTimeOpen);
  // The host draws it only while identity_check is on; it reads the switch itself too, so it can never ask with it off.
  const idOn = useIdentityCheckOnStore();
  // The host is mounted on every screen: the fee is read only once the screen opens, never for everyone else.
  return open && idOn ? <FreeClaimFirstTimeOpen /> : null;
}

function FreeClaimFirstTimeOpen() {
  // An unread amount has no number to show, and the checkout still shows the real one before anything is charged.
  const feeLabel = formatFeeLabel(useOnboardingFeeCents());
  const [opening, setOpening] = useState(false);

  const pay = async () => {
    setOpening(true);
    try {
      const outcome = await payAccountSetupFee("declutter_free_claim");
      if (outcome === "failed") return;
      closeFreeClaimFirstTime();
      // Paid already (a read that lagged the webhook): the next step is the ID check itself.
      if (outcome === "already_paid") openIdentityCheck("claim");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : closeFreeClaimFirstTime())}>
      <DialogContent>
        <DialogHero title="A one-time ID check" />
        <div className="space-y-2 min-w-0" data-free-claim-first-time="">
          <p className="font-sans text-ds-13 text-foreground">
            A claim shares a real person's address, so we check ID once to keep members safe.
          </p>
          <p className="font-sans text-ds-13 text-foreground">
            {feeLabel ? `${feeLabel} covers the check.` : "A one-time fee covers the check."} You pay it first, then verify with Stripe in about 2 minutes. You'll never be asked again, and the item stays free.
          </p>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={closeFreeClaimFirstTime}>Not now</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => void pay()} disabled={opening}>
            {opening ? "Opening…" : feeLabel ? `Pay ${feeLabel}` : "Continue to payment"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
