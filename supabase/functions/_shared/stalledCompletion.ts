// stalledCompletion — the one rule for "this job is in_progress, its scheduled
// work is over, and NEITHER side has said it is done".
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT WAS BROKEN (verified on prod fncmgoasalhdgfwzhsqa, 2026-09-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// A job that reaches `in_progress` and is never marked complete by either side
// matched NO scheduled sweep at all:
//
//   auto-expire-jobs   §1 needs status='accepted' AND helper_confirmed_at IS NULL
//                      §2 needs status='open'
//                      §3 expire_unanswered_offers   — status='accepted'
//                      §4 expire_pending_direct_offers
//   auto-release-payment  needs poster_completed_at <= cutoff
//                         OR helper_completed_at <= cutoff
//                         (AUTO_COMPLETE_HOURS = 24, escrowTiming.ts)
//   arrival-confirm-reminder  needs poster_confirmed_arrival_at IS NULL, and an
//                             in_progress job has that stamp by definition
//
// So the escrow sat held forever, and the person who posted the job was shown
// no Approve control either — `InProgressStep.tsx` gates it on
// `helper_completed_at`. Eleven such rows were sitting on prod when this was
// written (all `is_seed`, but the trap is real and catches the first live one).
//
// AND THOSE ELEVEN ARE SWEPT. This rule has no seed notion at all —
// `StalledEvidence` carries no `is_seed` column and nothing below reads one —
// and since the owner's 2026-09-19 pop-up ("Sweep everything, fixtures
// included.") neither does the sweep's own query. A fixture job in this trap is
// nudged and escalated like any other. `arrival-confirm-reminder` and
// `money-reconciliation` keep their `is_seed = false` scope; that decision was
// about THIS sweep only.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DECISION (owner, 2026-09-19, pop-up: "Nudge both, then admin queue.
// Never move money automatically.")
// ═══════════════════════════════════════════════════════════════════════════
//
//   +2h  after the scheduled work ends  → tell BOTH parties (first)
//   +24h                                → tell BOTH parties again (second)
//   +48h                                → a queue item awaiting an admin,
//                                         plus an ops alert (escalate)
//
// Money NEVER moves on this path. Nobody can prove from the data whether the
// work happened, so the escrow is released or refunded only by a human
// decision. That is the whole point of stage three being a QUEUE ITEM rather
// than a transfer.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE THREE NUMBERS COME FROM — each is an existing app constant
// ═══════════════════════════════════════════════════════════════════════════
//
//   2h  — the app's finest "this is late" unit. `cancellationFeePercent`'s
//         harshest tier is `hoursUntilJob < 2`, and `arrivalNudge.ts`'s
//         SECOND_AFTER_HOURS is 2. Two hours past an ESTIMATED end is short
//         enough to be useful and long enough not to accuse a Helpr who is
//         still working.
//   24h — `escrowTiming.ts` AUTO_COMPLETE_HOURS. That is already the window
//         this app gives a silent party to act before anything happens to
//         their job; the second nudge lands exactly at it.
//   48h — chosen as the moment funds WOULD have reached the Helpr under the
//         schedule of the day (24 auto-complete + 24 payout hold). The owner's
//         rule is that money never moves here, so a person is asked instead.
//         Q202 (2026-09-23) moved standard pay to 3 days after the job is
//         marked done (TOTAL_TO_PAYOUT_HOURS = 72) to buffer card disputes; that
//         is a money-safety wait, not a reason to page an admin a day later
//         about a job nobody marked done, so this stays 48 on its own.
//
// And one guard borrowed from `arrivalNudge.ts`: never escalate in the same
// breath as a late first nudge. If this sweep ships (or recovers from an
// outage) with week-old rows in the trap, both parties still get
// STALLED_MIN_HOURS_AFTER_FIRST to answer before an admin is pulled in.
//
// Pure: no Deno and no Supabase imports at module scope, so the vitest suite
// imports it directly (same contract as escrowTiming.ts / arrivalNudge.ts) and
// the app may import it too — the card must never imply a window the cron does
// not enforce.
import { jobLocalMidnightMs, jobLocalStartMs } from "./cancellationFee.ts";
import type { NudgeLedger } from "./arrivalNudge.ts";

export type { NudgeLedger };

const HOUR_MS = 3_600_000;

/** Hours past the scheduled end before the first nudge goes out. */
export const STALLED_FIRST_AFTER_HOURS = 2;
/** Hours past the scheduled end before the second nudge goes out. */
export const STALLED_SECOND_AFTER_HOURS = 24;
/** Hours past the scheduled end before a human is asked to decide. */
export const STALLED_ESCALATE_AFTER_HOURS = 48;

/**
 * The ladder's own GAPS — how long each stage must stand before the next one
 * may follow, derived from the thresholds rather than typed a second time.
 *
 * They exist for rows that were already old when this sweep first ran, and for
 * rows that sat through a cron outage. Without them a week-old job would be
 * nudged and escalated on consecutive runs, and nobody would have been given a
 * real chance to answer — the same trap `arrivalNudge.ts` guards against with
 * "never escalate in the same breath as a late first nudge".
 */
export const STALLED_GAP_FIRST_TO_SECOND =
  STALLED_SECOND_AFTER_HOURS - STALLED_FIRST_AFTER_HOURS;
export const STALLED_GAP_BEFORE_ESCALATE =
  STALLED_ESCALATE_AFTER_HOURS - STALLED_SECOND_AFTER_HOURS;

export type StalledStage = "first" | "second" | "escalate" | null;

/**
 * The job columns this rule reads. Exactly the set the app's job card already
 * has in hand, so the card can answer "why is there no Approve button?" from
 * the same predicate the cron uses, with no new column and no extra fetch.
 */
export type StalledEvidence = {
  status: string | null;
  helper_completed_at: string | null;
  poster_completed_at: string | null;
  date_needed: string | null;
  start_time: string | null;
  estimated_hours: number | null;
};

/** The calendar day AFTER `dateNeeded`, as another bare `YYYY-MM-DD`. */
function nextDay(dateNeeded: string): string {
  const [y, m, d] = dateNeeded.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Epoch ms at which this job's work was scheduled to be OVER.
 *
 * Two candidates, and the LATER one wins, because every error here must err
 * late. A premature nudge tells a Helpr who is still working that they have
 * failed to do something — the opposite of the defect this exists to fix.
 *
 *   a) the end of the job's calendar day in America/Chicago (midnight the next
 *      morning). `date_needed` is a bare DATE; with no `start_time` that is
 *      genuinely all we know, and "some time that day" cannot be over before
 *      the day is.
 *   b) `start_time` + `estimated_hours`, for a job that runs past midnight.
 *
 * DST is handled by `jobLocalStartMs`/`jobLocalMidnightMs`, which resolve the
 * offset at the real instant; `nextDay` is pure calendar arithmetic, so the two
 * short/long days of the year cannot shift it (same reasoning as
 * `confirmDeadline.ts`'s `previousDay`).
 */
export function scheduledEndMs(
  dateNeeded: string,
  startTime: string | null,
  estimatedHours: number | null,
): number {
  const dayOver = jobLocalMidnightMs(nextDay(dateNeeded));
  const hours = typeof estimatedHours === "number" && Number.isFinite(estimatedHours)
    ? Math.max(estimatedHours, 0)
    : 0;
  const workOver = jobLocalStartMs(dateNeeded, startTime) + hours * HOUR_MS;
  return Math.max(dayOver, workOver);
}

/** The scheduled end for a job row, or NaN when the row carries no date. */
export function jobScheduledEndMs(job: StalledEvidence): number {
  if (!job.date_needed) return Number.NaN;
  return scheduledEndMs(job.date_needed, job.start_time, job.estimated_hours);
}

/** Hours since this job's work was scheduled to be over (negative = not yet). */
export function hoursPastScheduledEnd(job: StalledEvidence, now: Date): number {
  const end = jobScheduledEndMs(job);
  if (!Number.isFinite(end)) return Number.NaN;
  return (now.getTime() - end) / HOUR_MS;
}

/**
 * THE PREDICATE. True when this job is in the trap: still running, scheduled
 * work over by at least the first-nudge grace, and neither side has marked it
 * done.
 *
 * Read by the sweep AND by the app's job card, so the disabled "Work Done"
 * affordance and the reminder that explains it can never disagree.
 */
export function completionStalled(job: StalledEvidence, now: Date): boolean {
  if (job.status !== "in_progress") return false;
  if (job.helper_completed_at || job.poster_completed_at) return false;
  const hours = hoursPastScheduledEnd(job, now);
  return Number.isFinite(hours) && hours >= STALLED_FIRST_AFTER_HOURS;
}

/**
 * Which stage this job is due for, given what has already been sent.
 *
 * Mirrors `arrivalNudgeStage`'s contract — one stage per call, each claimed
 * once in a ledger — but its own ladder, because that one's first nudge fires
 * the instant its anchor lands and every stage after it is measured from the
 * first send. Here all three thresholds are measured from ONE anchor (the
 * scheduled end), so a missed run cannot compress the ladder.
 *
 * `escalate` wins over an unsent `second`: a job that sat through an outage
 * long enough to need a human does not first get a nudge it has outgrown.
 */
export function stalledCompletionStage(
  job: StalledEvidence,
  ledger: NudgeLedger,
  now: Date,
): StalledStage {
  if (!completionStalled(job, now)) return null;
  const hours = hoursPastScheduledEnd(job, now);
  if (!ledger?.first_sent_at) return "first";
  if (ledger.escalated_at) return null;

  const firstMs = new Date(ledger.first_sent_at).getTime();
  const secondMs = ledger.second_sent_at ? new Date(ledger.second_sent_at).getTime() : Number.NaN;
  if (!Number.isFinite(firstMs)) return null;
  const sinceFirst = (now.getTime() - firstMs) / HOUR_MS;
  // The last thing either party was actually told, whichever that was.
  const sinceLastSent = (now.getTime() - Math.max(firstMs, Number.isFinite(secondMs) ? secondMs : firstMs)) / HOUR_MS;

  if (hours >= STALLED_ESCALATE_AFTER_HOURS && sinceLastSent >= STALLED_GAP_BEFORE_ESCALATE) {
    return "escalate";
  }
  if (
    !ledger.second_sent_at &&
    hours >= STALLED_SECOND_AFTER_HOURS &&
    sinceFirst >= STALLED_GAP_FIRST_TO_SECOND
  ) {
    return "second";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY — one source for the sweep's messages AND the job card's disabled
// "Work Done" affordance.
// ═══════════════════════════════════════════════════════════════════════════
//
// Role-neutral, per CLAUDE.md and src/test/roleNeutralCopy.test.ts: the other
// party is named by what they DID on this job, never by a role they are.

/**
 * Short label for the DISABLED "Work Done" affordance on the card of the person
 * who posted the job. Fits a button caption.
 */
export const STALLED_APPROVE_DISABLED_LABEL = "Waiting on the Helpr to mark it done";

/**
 * THE ONE SENTENCE shown under that disabled control.
 *
 * OWNER, 2026-09-19, on the first version of this line: "trim to one sentence.
 * rest behind the tap."
 *
 * The first version said all four things at once — what is missing, what to ask
 * for, that the escrow is held, and that support steps in — and it MEASURED
 * 112px / 7 lines at 375 and 128px / 8 lines at 320, in 11px semibold amber,
 * centred, directly above a three-line disabled button. Roughly a quarter of
 * the viewport, and visually LOUDER than the tracker above it: a passive
 * explanation of inaction outranking the job's own state.
 *
 * What survives the trim is chosen by what the reader is actually anxious
 * about: whose move it is, that somebody has already chased it, and that their
 * money has not gone anywhere. Everything that is an INSTRUCTION or a FUTURE
 * step moved to {@link STALLED_APPROVE_DISABLED_DETAIL}, behind one tap.
 */
export const STALLED_APPROVE_DISABLED_REASON =
  "Your Helpr hasn't marked this job done yet — we've reminded them, and your payment stays in escrow.";

/** Heading over the detail, wherever a surface puts it behind a tap. */
export const STALLED_APPROVE_DETAIL_TITLE = "Why This Is Waiting";

/**
 * THE REST, behind the tap. Exported and pinned alongside the short line so the
 * two halves cannot drift, and so the trim can never quietly become a deletion:
 * every fact the long version carried is still in one of these two strings.
 *
 * Still says the money does not move by itself — that promise is the whole
 * reason this notice exists (the owner's rule: a stalled job is released or
 * refunded only by a human decision) — it just says it to someone who asked.
 */
export const STALLED_APPROVE_DISABLED_DETAIL =
  "If the work is finished, ask your Helpr to tap Mark Job Complete. " +
  "Nothing is released or refunded until someone acts, and our team steps in if this stays stuck.";

/** First and second reminder to the person who posted the job. */
export const STALLED_NUDGE_TITLE_POSTED = "Has this job been finished?";
export const stalledNudgeBodyPosted = (title: string, second: boolean): string =>
  second
    ? `"${title}" — your Helpr still hasn't marked it done, so your payment is still in escrow. Message them, or report a problem and our team will review it.`
    : `"${title}" — its scheduled time has passed and nobody has marked it done. Message your Helpr, or report a problem if something went wrong.`;

/** First and second reminder to the Helpr doing the job. */
export const STALLED_NUDGE_TITLE_WORKING = "Did you finish this job?";
export const stalledNudgeBodyWorking = (title: string, second: boolean): string =>
  second
    ? `"${title}" — you still haven't marked it done, so you haven't been paid. Tap Mark Job Complete, or report a problem if you couldn't finish.`
    : `"${title}" — its scheduled time has passed. Tap Mark Job Complete so your payment can be released.`;

/** What both parties are told when it goes to a human. */
export const STALLED_ESCALATED_TITLE = "We've asked support to step in";
export const stalledEscalatedBody = (title: string): string =>
  `"${title}" — nobody marked this job done, so our team is reviewing it. The payment stays in escrow until a person decides; nothing has been released or refunded.`;

/**
 * The admin queue item's headline and body. Admin-only, so it may name the two
 * sides of the job the way an operator triages them — the same carve-out
 * `arrival-confirm-reminder`'s admin_alert has in the role-copy allowlist.
 */
export const STALLED_ADMIN_TITLE = "Job stalled — nobody marked it done";
export const stalledAdminBody = (title: string, hours: number): string =>
  `"${title}" — in progress, ${Math.round(hours)}h past its scheduled end, and neither side has marked it complete. Escrow is still held. Decide it by hand: release, refund, or open a dispute. Nothing moves automatically.`;
