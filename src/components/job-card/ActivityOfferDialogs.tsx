import { lazy, Suspense } from "react";
import type { useActivityActions } from "@/components/job-card/useActivityActions";
import { PaymentHeldDialog } from "@/components/job-card/PaymentHeldDialog";
import { HelperDoneWhatNextHost } from "@/components/whatNext/HelperDoneWhatNext";

// Dialogs mount only on a user action, so lazy-loading keeps their subtrees
// out of the initial chunk entirely.
const AwardGateDialog = lazy(() =>
  import("@/components/AwardGateDialog").then((m) => ({ default: m.AwardGateDialog })),
);
const SmsPhonePrompt = lazy(() =>
  import("@/components/notificationPreferences/SmsPhonePrompt").then((m) => ({ default: m.SmsPhonePrompt })),
);
const HiredPayoutSetupDialog = lazy(() =>
  import("@/components/payouts/HiredPayoutSetupDialog").then((m) => ({ default: m.HiredPayoutSetupDialog })),
);

/**
 * The pop-ups an offer's send or accept can open on Activity: the award gate
 * (setup still owed) and the
 * "payment is held" notice (Q997). Moved out of JobListPage unchanged apart
 * from the Q997 one (componentSizeRatchet: that page may only shrink).
 */
export function ActivityOfferDialogs({
  actions,
}: {
  actions: ReturnType<typeof useActivityActions>;
}) {
  return (
    <>
      {actions.awardBlockReason && (
        <Suspense fallback={null}>
          <AwardGateDialog
            open={!!actions.awardBlockReason}
            onOpenChange={(o) => {
              if (!o) actions.closeAwardGate();
            }}
            reason={actions.awardBlockReason}
            pendingMissing={actions.acceptPendingMissing}
          />
        </Suspense>
      )}
      {/* Q997: "the payment is held" after an offer is sent or an accept completes. */}
      <PaymentHeldDialog side={actions.paymentHeldSide} who={actions.paymentHeldWho} onClose={() => actions.setPaymentHeldSide(null)} />
      {/* Owner 2026-10-25 (payout_after_hire): "You're hired. Set up payouts to get paid." */}
      {actions.hiredPayout?.open && (
        <Suspense fallback={null}>
          <HiredPayoutSetupDialog open onOpenChange={(o) => { if (!o) actions.hiredPayout?.close(); }} />
        </Suspense>
      )}
      {/* Owner-approved 2026-10-27: the one-time "Add your phone" ask at a Helpr's FIRST hire (the server decides),
          never on top of another of these pop-ups. */}
      {!actions.awardBlockReason && !actions.paymentHeldSide && !actions.hiredPayout?.open && (
        <Suspense fallback={null}>
          <SmsPhonePrompt moment="first_hire" />
        </Suspense>
      )}
      {/* Board 81: the Helpr's "What next" after marking a job done (opened by JobTracking). */}
      <HelperDoneWhatNextHost />
    </>
  );
}
