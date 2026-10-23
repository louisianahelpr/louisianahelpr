/**
 * The words every payout-setup entry point shows while setup is paused (owner
 * ruling 2026-10-23; usePayoutSetupPaused). One sentence set, for every member:
 * never addressed to Helprs or posters only. stripe-connect's 409 carries the
 * same words (supabase/functions/_shared/payoutSetupPause.ts,
 * PAYOUT_SETUP_PAUSED_MESSAGE; src/test/payoutSetupPausedEntryPoints.test.ts
 * keeps the two equal), so an old app build that toasts the refusal still reads
 * the calm notice.
 */
export const PAYOUT_SETUP_PAUSED_COPY =
  "Payout setup is paused while our payment provider reviews our account. Your profile and jobs are not affected. We'll let you know when it's back.";
