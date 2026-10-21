import { lazy, Suspense } from "react";
import type { useActivityActions } from "@/components/job-card/useActivityActions";
import { PaymentHeldDialog } from "@/components/job-card/PaymentHeldDialog";
import { HelperDoneWhatNextHost } from "@/components/whatNext/HelperDoneWhatNext";

// Dialogs mount only on a user action, so lazy-loading keeps their subtrees
// out of the initial chunk entirely.
const AwardGateDialog = lazy(() =>
  import("@/components/AwardGateDialog").then((m) => ({ default: m.AwardGateDialog })),
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
      {/* Board 81: the Helpr's "What next" after marking a job done (opened by JobTracking). */}
      <HelperDoneWhatNextHost />
    </>
  );
}
