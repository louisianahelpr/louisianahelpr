import { useFeature } from "@/hooks/useFeature";

/**
 * Is Helpr payout setup (Stripe Connect onboarding) paused for this member?
 *
 * Owner ruling, 2026-10-23: Stripe closed Helpr's platform account, so setting
 * up, finishing or resetting a payout account is paused. Posting and paying for
 * jobs are not. The switch is the hidden feature switch `payout_setup`
 * (migration 20261023201657), created OFF; OFF is the pause, and an admin sets
 * it to Everyone in Admin -> Settings to bring setup back.
 *
 * TRUE while the answer is loading, on a read error and when signed out (it
 * fails closed): a member is never sent into a Stripe setup the server has not
 * said is open. The server refuses on its own anyway (stripe-connect answers
 * 409 payout_setup_paused), so this only decides what the app SHOWS:
 * nothing in place of every "set up payouts" control (the notice was removed,
 * owner 2026-10-25: "its not paused").
 *
 * Every entry point to payout setup calls this; the class guard
 * src/test/payoutSetupPausedEntryPoints.test.ts fails on one that does not.
 */
export function usePayoutSetupPaused(): boolean {
  return !useFeature("payout_setup");
}
