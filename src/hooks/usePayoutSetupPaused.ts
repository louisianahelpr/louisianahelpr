import { useFeature } from "@/hooks/useFeature";
import { usePayoutSetupHireAllowed } from "@/hooks/usePayoutSetupHireAllowed";

/** Why setup is not offered right now: paused for everyone, or not hired yet; null when it is offered. */
export type PayoutSetupBlock = "paused" | "needs_hire" | null;

/** The reason behind usePayoutSetupPaused(), for the notice that explains it. */
export function usePayoutSetupBlock(): PayoutSetupBlock {
  const switchOn = useFeature("payout_setup");
  const hireAllowed = usePayoutSetupHireAllowed();
  if (!switchOn) return "paused";
  if (!hireAllowed) return "needs_hire";
  return null;
}

/**
 * Is Helpr payout setup NOT offered to this member right now?
 *
 * Two reasons, either one hides every "set up payouts" control:
 *   - PAUSED (owner ruling 2026-10-23: Stripe closed Helpr's platform account):
 *     the hidden feature switch `payout_setup` (migration 20261023201657),
 *     created OFF; an admin sets it to Everyone to bring setup back.
 *   - NOT HIRED YET (owner decision 2026-10-25): nobody has chosen this member
 *     for a job that holds money (usePayoutSetupHireAllowed above).
 *
 * TRUE while either answer is loading, on a read error and when signed out (it
 * fails closed): a member is never sent into a Stripe setup the server has not
 * said is open. The server refuses on its own anyway (stripe-connect answers
 * 409 payout_setup_paused or 403 payout_setup_needs_hire), so this only decides
 * what the app SHOWS: the notice (PayoutSetupPausedNotice, which says which of
 * the two it is) in place of every "set up payouts" control.
 *
 * Every entry point to payout setup calls this; the class guard
 * src/test/payoutSetupPausedEntryPoints.test.ts fails on one that does not.
 */
export function usePayoutSetupPaused(): boolean {
  return usePayoutSetupBlock() !== null;
}
