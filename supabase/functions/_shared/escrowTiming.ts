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
// ⚠️ Known divergence (see escrowTiming.parity.test.ts): user-facing copy across
// Legal, Terms, PaymentSuccess, the Help Center, and the dispute dialogs says
// "72 hours", but the cron cutoff is 48h. These consts encode the ACTUAL cron
// values so the drift is caught and documented rather than silently shipped.

/** Hours after one-sided completion before the job auto-completes (cron cutoff). */
export const AUTO_COMPLETE_HOURS = 48;

/** Additional hold (hours) after auto-complete before the payout transfer fires. */
export const PAYOUT_HOLD_HOURS = 24;

/** Total hours from one-sided completion until funds actually reach the helper. */
export const TOTAL_TO_PAYOUT_HOURS = AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS;

/** The auto-release window as stated to users across Legal / Terms / checkout copy. */
export const COPY_AUTO_RELEASE_HOURS = 72;

/** A whole-hours count expressed in milliseconds — matches the cron's arithmetic. */
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
