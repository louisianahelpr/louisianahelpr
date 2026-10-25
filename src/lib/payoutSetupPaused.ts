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

/**
 * The words every payout-setup entry point shows to a member nobody has hired
 * yet (owner decision 2026-10-25: payout setup moves from sign-up to the hire;
 * copy approved by the lead 2026-10-25). stripe-connect's 403
 * payout_setup_needs_hire carries the same words
 * (supabase/functions/_shared/payoutSetupHire.ts; the guard
 * src/test/payoutSetupNeedsHire.test.ts keeps the two equal).
 */
export const PAYOUT_SETUP_NEEDS_HIRE_COPY = "You'll set up payouts when you're hired for your first job.";
