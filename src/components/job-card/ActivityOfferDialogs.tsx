import { lazy, Suspense } from "react";
import type { useActivityActions } from "@/components/job-card/useActivityActions";
import { PaymentHeldDialog } from "@/components/job-card/PaymentHeldDialog";

// Dialogs mount only on a user action, so lazy-loading keeps their subtrees
// out of the initial chunk entirely.
const AwardGateDialog = lazy(() =>
  import("@/components/AwardGateDialog").then((m) => ({ default: m.AwardGateDialog })),
);
const W9CollectionDialog = lazy(() => import("@/components/W9CollectionDialog"));

/**
 * The pop-ups an offer's send or accept can open on Activity: the award gate
 * (setup still owed), the W-9 a business job requires at accept, and the
 * "payment is held" notice (Q997). Moved out of JobListPage unchanged apart
 * from the Q997 one (componentSizeRatchet: that page may only shrink).
 */
export function ActivityOfferDialogs({
  actions,
  userId,
}: {
  actions: ReturnType<typeof useActivityActions>;
  userId: string | null;
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
      {actions.w9Context && userId && (
        <Suspense fallback={null}>
          <W9CollectionDialog
            open={actions.w9DialogOpen}
            onOpenChange={actions.setW9DialogOpen}
            jobId={actions.w9Context.jobId}
            helperId={userId}
            businessId={actions.w9Context.businessId}
          />
        </Suspense>
      )}
      {/* Q997: "the payment is held" after an offer is sent or an accept completes. */}
      <PaymentHeldDialog side={actions.paymentHeldSide} onClose={() => actions.setPaymentHeldSide(null)} />
    </>
  );
}
