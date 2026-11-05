import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { PayoutStatusRow } from "./PayoutStatusRow";

/**
 * The Profile landing's getting-started slot: can we pay you.
 *
 * Its own component (#185, Q1816 ui-sweep #3491) so that ProfileLanding can
 * put a SectionBoundary around it. The payout status is a live Stripe call
 * through an edge function; when its answer was malformed, the hook's render
 * loop ("Maximum update depth exceeded") took down the WHOLE /profile page.
 * A malformed or failed answer is meant to render this slot's own `error`
 * row (We couldn't check your payout account. Retry), and anything worse now
 * stays inside this slot, with the rest of the page still usable.
 */
export function PayoutSlot({ onSetUp }: { onSetUp: () => void }) {
  // Owned here rather than passed in, see the note in `types.ts`. Cached, so
  // re-opening Profile in the same session paints the payout state on the
  // first frame instead of re-asking Stripe every mount.
  const { payoutPrompt, refetchStatus } = useStripeConnectStatus();
  // Owner ruling 2026-10-23: payout setup is paused; the row says so instead
  // of offering "Set up".
  const setupPaused = usePayoutSetupPaused();

  // The row disappears completely once it has nothing to say.
  if (payoutPrompt.kind === "none") return null;
  return (
    /* NO CARD BEHIND THIS BANNER. Owner, 2026-09-11: remove the white card
       behind "Finish setting up". `PayoutStatusRow` draws its own bordered,
       sienna-tinted surface, so a `liquid-glass` box behind it would be a box
       inside a box. */
    <div className="space-y-2">
      <PayoutStatusRow
        prompt={payoutPrompt}
        onSetUp={onSetUp}
        onRetry={refetchStatus}
        setupPaused={setupPaused}
      />
    </div>
  );
}
