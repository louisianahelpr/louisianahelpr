// escrowTiming — single source of truth for when a Helpr is paid, for the Deno
// edge runtime. Plain TS (no Deno imports at module scope) so the vitest parity
// guards can import it directly and keep the user-facing copy in lock-step with
// the code that actually moves the money.
//
// THE RULE (owner, 2026-10-23, after the Mow two lawns job 7c6deb77):
//
//   1. The money moves only after the person who posted the job APPROVES the
//      work (poster_completed_at). Nothing releases on a timer.
//   2. APPROVAL_WINDOW_HOURS after the Helpr marks the work done, if the poster
//      has neither approved nor asked for a change, Helpr support is asked to
//      step in (auto-release-payment files a job_approval_escalations row, the
//      admin queue, and tells both sides). The money stays held. An admin then
//      approves for the poster, refunds, or keeps talking to them.
//   3. The payout clock starts at the approval: the transfer is sent
//      STANDARD_PAYOUT_DAYS_AFTER_APPROVAL days later (the card-dispute buffer,
//      Q202). It used to start when the Helpr marked done, so a poster who
//      approved a day later shortened the buffer and the Helpr was told
//      "3 days after the job is marked done" with no date.
//   4. Every notice that says when a Helpr is paid names the DAY
//      (payoutDayLabel: "Sun, Oct 25"), never "payment has been captured" or
//      "is being processed".
//
// History: the 24h one-sided auto-complete (2026-08-24) and the 3 days after
// the job was marked done (Q202, 2026-09-23) are both retired by this rule.
// The 72h that remains elsewhere is the formal dispute deadline
// (`dispute_deadline`) and the revision acceptance window
// (`revision_acceptance_deadline`); a revision fix the poster never answers is
// escalated the same way, never paid.

/** Hours the poster has to approve (or ask for a change) before Helpr support is asked to step in. */
export const APPROVAL_WINDOW_HOURS = 24;

/**
 * STANDARD PAY: the payout transfer fires this many days after the poster
 * APPROVES the work (owner 2026-10-23; the 3 days are Q202's card-dispute
 * buffer). The paid instant payout (instant-payout, _shared/instantPayoutFee.ts)
 * is unchanged: it moves money already SENT to a Helpr's Stripe balance to
 * their card in minutes.
 */
export const STANDARD_PAYOUT_DAYS_AFTER_APPROVAL = 3;

/** STANDARD_PAYOUT_DAYS_AFTER_APPROVAL in hours. */
export const STANDARD_PAYOUT_HOURS_AFTER_APPROVAL = STANDARD_PAYOUT_DAYS_AFTER_APPROVAL * 24;

/**
 * When a standard payout is due: STANDARD_PAYOUT_HOURS_AFTER_APPROVAL after the
 * poster approved (`approvedAtIso`, the job's poster_completed_at), never
 * earlier than now. With no approval stamp (the approval is happening NOW), the
 * clock starts now. Every writer of jobs.payout_scheduled_at on the standard
 * path uses this: create-payment's release (the poster's or an admin's approval)
 * and auto-release-payment's release of a job the poster already approved
 * (src/test/standardPayoutThreeDays.test.ts).
 */
export function standardPayoutAtIso(approvedAtIso: string | null | undefined, nowMs: number = Date.now()): string {
  const approvedMs = approvedAtIso ? Date.parse(approvedAtIso) : NaN;
  const anchor = Number.isFinite(approvedMs) && approvedMs <= nowMs ? approvedMs : nowMs;
  return new Date(Math.max(nowMs, anchor + hoursToMs(STANDARD_PAYOUT_HOURS_AFTER_APPROVAL))).toISOString();
}

/** "3 days after the job is approved": the phrase copy uses where no date is known yet. */
export const STANDARD_PAYOUT_PHRASE = `${STANDARD_PAYOUT_DAYS_AFTER_APPROVAL} days after the job is approved`;

/**
 * The DAY a payout is sent, as members read it: "Sun, Oct 25", in Louisiana
 * time (America/Chicago), whatever the server's or device's zone. Returns null
 * for a missing or unreadable timestamp, so a caller can never print
 * "Invalid Date" in a money notice.
 */
export function payoutDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

/** A whole-hours count expressed in milliseconds — matches the cron's arithmetic. */
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
