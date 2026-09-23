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
// until funds LAND was 48h (24h auto-complete + 24h payout hold); since
// 2026-09-23 (Q202) it is 3 days after the job is marked done (24h + 48h). Every
// user-facing copy site derives from COPY_AUTO_RELEASE_HOURS, and the vitest
// parity guards read the cron's own arithmetic, so changing this constant and
// the cron literal together is the entire change.
// The 72h that remains correct elsewhere is the formal dispute deadline
// (`dispute_deadline`) and the post-revision acceptance window
// (`revision_acceptance_deadline`) — both genuinely 72h and NOT this cutoff.

/** Hours after one-sided completion before the job auto-completes (cron cutoff). */
export const AUTO_COMPLETE_HOURS = 24;

/**
 * STANDARD PAY: the payout transfer fires this many days after the job is
 * marked done (owner decision 2026-09-23, docs/OPEN.md Q202, was ~48h). The
 * wait is the card-dispute buffer: money that has not left the platform can
 * still be held when the cardholder disputes the charge. The paid instant
 * payout (instant-payout, _shared/instantPayoutFee.ts) is unchanged: it moves
 * money already SENT to a Helpr's Stripe balance to their card in minutes.
 */
export const STANDARD_PAYOUT_DAYS_AFTER_DONE = 3;

/** STANDARD_PAYOUT_DAYS_AFTER_DONE in hours. */
export const STANDARD_PAYOUT_HOURS_AFTER_DONE = STANDARD_PAYOUT_DAYS_AFTER_DONE * 24;

/** Additional hold (hours) after an AUTO-complete before the payout transfer
 *  fires: whatever is left of the standard wait once the auto-complete window
 *  has run. */
export const PAYOUT_HOLD_HOURS = STANDARD_PAYOUT_HOURS_AFTER_DONE - AUTO_COMPLETE_HOURS;

/** Total hours from one-sided completion until funds actually reach the helper. */
export const TOTAL_TO_PAYOUT_HOURS = AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS;

/**
 * When a standard payout is due: STANDARD_PAYOUT_HOURS_AFTER_DONE after the job
 * was marked done (`doneAtIso`, the Helpr's helper_completed_at), never earlier
 * than now. With no done stamp (the poster confirmed first), the job is done
 * NOW. Every writer of jobs.payout_scheduled_at on the standard path uses this:
 * auto-release-payment, create-payment's two-sided release and the re-pay
 * checkout (src/test/standardPayoutThreeDays.test.ts).
 */
export function standardPayoutAtIso(doneAtIso: string | null | undefined, nowMs: number = Date.now()): string {
  const doneMs = doneAtIso ? Date.parse(doneAtIso) : NaN;
  const anchor = Number.isFinite(doneMs) && doneMs <= nowMs ? doneMs : nowMs;
  return new Date(Math.max(nowMs, anchor + hoursToMs(STANDARD_PAYOUT_HOURS_AFTER_DONE))).toISOString();
}

/** "3 days after the job is marked done" — the one phrase user copy interpolates. */
export const STANDARD_PAYOUT_PHRASE = `${STANDARD_PAYOUT_DAYS_AFTER_DONE} days after the job is marked done`;

/**
 * The auto-release ACTION window as stated to users across Legal / Terms /
 * checkout / activity copy. Now aligned to the cron cutoff — the window a poster
 * has to confirm or dispute before the job auto-completes.
 */
export const COPY_AUTO_RELEASE_HOURS = AUTO_COMPLETE_HOURS;

/** A whole-hours count expressed in milliseconds — matches the cron's arithmetic. */
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
