import { COPY_AUTO_RELEASE_HOURS } from "../../../supabase/functions/_shared/escrowTiming";

/**
 * What each completed transition tells the helper, and (because these events
 * are the poster's only signal that anything happened) what it tells them the
 * POSTER now knows. Every transition used to fire haptics and nothing else —
 * on web, where there are no haptics, a successful tap produced no feedback of
 * any kind. `arrived` has no entry: that path speaks for itself, through the
 * RPC's own verdict (`arrivalVerdictMessage`) — the one message that knows
 * whether the location confirmed anything, and the one that has to name the
 * poster's tap as what comes next. A generic line here would talk over it.
 */
export const TRANSITION_TOAST: Record<string, string> = {
  confirmed: "You're marked as accepted.",
  on_the_way: "The person who posted this job knows you're on the way.",
  working: "The person who posted this job knows work has started.",
  // Interpolated, never restated as a literal — see escrowTiming.ts and the
  // copy-parity guard in src/lib/escrowTiming.copyParity.test.ts.
  done: `Payout requested. The person who posted this job has ${COPY_AUTO_RELEASE_HOURS} hours to approve before your payment releases automatically.`,
};
