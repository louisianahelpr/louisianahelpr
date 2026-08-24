// escrowTiming — single source of truth for the escrow auto-release schedule,
// for the Deno edge runtime. Plain TS (no Deno imports at module scope) so the
// vitest parity guard `src/lib/escrowTiming.parity.test.ts` can import it
// directly and keep the user-facing "auto-release" copy in lock-step with the
// cron that actually moves the money.
//
// The schedule has two legs after a job is marked complete by one party:
//
//   1. AUTO_COMPLETE_HOURS — if the OTHER party neither confirms nor disputes
//      within this window, `auto-release-payment` auto-completes the job and
//      flips escrow → payout_pending.
//   2. PAYOUT_HOLD_HOURS  — an additional hold before the transfer to the
//      helper's Connect account actually fires (chargeback safety buffer).
//
// AUTO_COMPLETE_HOURS is the number a poster is promised at checkout / in Legal
// ("payment auto-releases if you don't act within N hours"). It MUST match the
// literal used by the cron cutoff, and the "N hours" stated in user copy.
//
// Reconciled 2026-07-02; TIGHTENED 2026-08-24 (owner, during the two-role
// lifecycle E2E): the poster's confirm-or-dispute window is 24 hours, not 48 —
// "allow the poster 24 hours to confirm before pay is released". Total time
// until funds LAND is now 48h (24h auto-complete + 24h payout hold). Every
// user-facing copy site derives from COPY_AUTO_RELEASE_HOURS, and the vitest
// parity guards read the cron's own arithmetic, so changing this constant and
// the cron literal together is the entire change.
// The 72h that remains correct elsewhere is the formal dispute deadline
// (`dispute_deadline`) and the post-revision acceptance window
// (`revision_acceptance_deadline`) — both genuinely 72h and NOT this cutoff.

/** Hours after one-sided completion before the job auto-completes (cron cutoff). */
export const AUTO_COMPLETE_HOURS = 24;

/** Additional hold (hours) after auto-complete before the payout transfer fires. */
export const PAYOUT_HOLD_HOURS = 24;

/** Total hours from one-sided completion until funds actually reach the helper. */
export const TOTAL_TO_PAYOUT_HOURS = AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS;

/**
 * The auto-release ACTION window as stated to users across Legal / Terms /
 * checkout / activity copy. Now aligned to the cron cutoff — the window a poster
 * has to confirm or dispute before the job auto-completes.
 */
export const COPY_AUTO_RELEASE_HOURS = AUTO_COMPLETE_HOURS;

/** A whole-hours count expressed in milliseconds — matches the cron's arithmetic. */
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
