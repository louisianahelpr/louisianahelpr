import {
  BUCKET_LABEL,
  agreedJobStage,
  appliedActivityBucket,
  jobIsOverdue,
  listingHasExpired,
  offerHasExpired,
  postedActivityBucket,
  submissionAwaitingPoster,
  workIsBackWithHelper,
  type ActivityBucket,
} from "@/components/job-card/activityFilters";
import { assertNever } from "@/lib/assertNever";
import { isExpiredListing } from "@/lib/expiredListing";
import { posterFirstName } from "@/lib/deletedPerson";
import { reviewWindowOpen } from "@/lib/reviewWindow";
import { afterPhotoIsThePrimary, beforePhotoIsThePrimary } from "./primaryPhotoAsk";
import { arrivalEstablished } from "@/lib/arrivalGate";
import type { AppliedApp, Job } from "./activityConstants";
import { derivePosterStep, posterConfirmationRung } from "../../pages/posts/postedJobCard/steps/posterStepContract";
import { PAYMENT_PROBLEM_COPY, cardPaymentProblem, type JobPaymentProblem } from "@/lib/jobPaymentCardState";
import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../supabase/functions/_shared/escrowTiming";
import { confirmDeadlineMs, confirmOpensMs, posterConfirmClosesMs } from "@/lib/jobDate";
import { EXPIRED_WORD, jobStartDateTime } from "@/lib/dateUtils";
import { workHasBegun } from "@/components/tracker/workHasBegun";

/**
 * WHAT THIS CARD IS WAITING ON — one sentence, on every collapsed job card.
 *
 * Owner, 2026-09-19, looking at the collapsed cards on /posts:
 *   "in the box to the left of the dots should show what we are waiting on,
 *    like if the person is on their way or confirmed but now you need to
 *    confirm etc, remove the dots"
 * and, the same day, on the treatment:
 *   "similar to how dispute open displays."
 *
 * ── THIS SUPERSEDES THE DOTS, IT DOES NOT SIT BESIDE THEM ─────────────────
 * Hours earlier the same owner chose a compact 16px-dot rail for the bottom of
 * the collapsed card, because the labelled rail could not fit (8x28 + 7x6 =
 * 266px against a 212px row at 320). They have now seen it: eight anonymous
 * dots tell you a POSITION ON A TRACK; a sentence tells you WHAT TO DO. The
 * rail (`JobStepRailCompact`) is deleted and this replaces it outright.
 *
 * ── IT INVENTS NO STATE MACHINE. IT JOINS THE TWO THE APP ALREADY HAS ─────
 * Every line is EYEBROW + DETAIL, and the two halves come from two existing
 * sources of truth, neither of them re-derived here:
 *
 *   EYEBROW = whose move it is = `postedActivityBucket` / `appliedActivityBucket`
 *             wearing `BUCKET_LABEL` — literally the word the tab the card is
 *             sitting in already uses (Needs You / Waiting / Scheduled / Done /
 *             Cancelled). If the card said "Waiting" under a "Needs You" tab,
 *             one of them would be lying; taking the tab's own answer makes
 *             that impossible.
 *   DETAIL  = what is owed = the poster's confirmation ladder
 *             (`posterConfirmationRung` — which already computes the next owed
 *             confirmation, its label and its honest blocked reason), the
 *             bucket's own predicates (`submissionAwaitingPoster`,
 *             `workIsBackWithHelper`, `jobIsOverdue`, `listingHasExpired`), and
 *             the job's own stamps.
 *
 * ── WHERE THE TWO DISAGREE, THE DETAIL WINS AND SAYS SO ───────────────────
 * (Money problems, Q360, are a fifth kind of override, and not a bucket
 * disagreement: see `problemWait` — a chargeback or a declined card is
 * invisible in `jobs.status`, so no bucket could ever name it.)
 * The eyebrow is overridden in exactly four places, each one a case where the
 * BUCKET files a job under "Needs you" while nothing whatsoever is owed by the
 * reader. Every override is marked `eyebrow:` in the tables below with a note.
 * They are reported as findings, not papered over — the bucket is not wrong for
 * its own purpose (it is a coarse attention sort with five chips), but a
 * sentence that says "Needs you · Your Helpr is on the way" is asking the
 * reader for something they cannot give.
 *
 * ── EVERY STATE HAS A SENTENCE, OR THE BUILD FAILS ────────────────────────
 * `POSTER_WAIT` / `HELPER_WAIT` are `Record<Wait, …>` keyed by a closed union,
 * so a new state with no sentence is a COMPILE error, not a blank strip. And
 * both derivations end in `assertNever`, so a `job_status` added to the DB enum
 * breaks the build here too. `src/test/collapsedStatusSentence.test.tsx` drives
 * a matrix of real job shapes through both and asserts the inventory is covered
 * and every sentence fits its card.
 */

/** The strip's six looks. Colour is never the only channel — see JobStatusStrip. */
export type JobStatusTone =
  /** A dispute. Sienna. */
  | "alarm"
  /** The reader owes the next move. Bark green. */
  | "you"
  /** Somebody else owes it. Olivewood. */
  | "them"
  /** Agreed, and still ahead. Olivewood. */
  | "ahead"
  /** Finished, paid. Bark green. */
  | "done"
  /** Never happened. Olivewood, muted. */
  | "over";

export interface JobStatusLine {
  /** The derived state's id — the inventory key, and the strip's data attribute. */
  id: string;
  /** Small-caps left word: WHOSE MOVE IT IS. */
  eyebrow: string;
  /** The sentence: what is owed, and by whom. */
  detail: string;
  tone: JobStatusTone;
  /** True while the reader themselves owes a CONFIRMATION tap (the old
   *  `PosterConfirmationBadge`'s whole job, now one value of this line). */
  owesConfirmation: boolean;
  /**
   * What follows the detail after a middle dot, when THIS job has one: the
   * cancellation reason on a cancelled job, the poster's note on a revision.
   * It is the job's own words, so it is never measured against the width
   * budget; the strip truncates it instead.
   */
  suffix?: string | null;
  /**
   * The clock this state runs on, when it has one. Every deadline the live
   * tracker counts down is also on the collapsed line (owner, 2026-10-01:
   * "every deadline or countdown in the live tracker must be visible").
   * Rendered by the shared `DeadlineCountdown` in its `compact` form.
   */
  deadline?: StatusDeadline | null;
}

/** One countdown on the collapsed line. */
export interface StatusDeadline {
  /** Which column (or derived clock) it reads: the guard's inventory key. */
  source: DeadlineSource;
  at: string;
  /** Reads after a duration: "1d 2h left to answer". On a card it is ONE line at 375 (owner 2026-10-25), so
   *  it stays within CARD_COUNTDOWN_MAX_CHARS with the longest card duration ("99d 23h"). */
  consequenceText: string;
  /** Shown instead once the clock has run out. */
  expiredText: string;
}

/**
 * Every clock the tracker counts down. The `jobs` columns are spelled as their
 * column names; `auto_complete` is `helper_completed_at + APPROVAL_WINDOW_HOURS`.
 */
/** The longest one-line countdown a card prints ("99d 23h " + the clause, or the expired text): one line at 375. */
export const CARD_COUNTDOWN_MAX_CHARS = 30;

export type DeadlineSource =
  | "direct_offer_expires_at"
  | "response_deadline"
  | "revision_deadline"
  | "revision_acceptance_deadline"
  | "dispute_deadline"
  | "auto_complete"
  /** The day-before confirm's deadline (confirmDeadlineMs, the server's rule): 2 hours before the start. */
  | "confirm_deadline";

/**
 * The reason shown after "Cancelled ·", or null.
 *
 * Reasons are written by people AND by machinery, and the machinery tags its
 * own: `[ADMIN REFUND] …`, `[Admin removed] …`, `[Admin override] …`,
 * `[SWEEP] …`. Those tags are bookkeeping for the admin console, not words for
 * the reader, so every leading `[…]` tag is stripped. What is left is dropped
 * when it is empty: "Cancelled ·" over nothing is worse than "Cancelled".
 */
function sanitizeCancellationReason(reason: string | null | undefined): string | null {
  if (typeof reason !== "string") return null;
  let out = reason.trim();
  for (;;) {
    const next = out.replace(/^\[[^\]]+\]\s*/, "");
    if (next === out) break;
    out = next.trim();
  }
  return out.length > 0 ? out : null;
}

/** A note the job carries, trimmed, or null. */
function noteOrNull(note: string | null | undefined): string | null {
  if (typeof note !== "string") return null;
  const t = note.trim();
  return t.length > 0 ? t : null;
}

/** The day-before confirm's clock: "1d 5h left to confirm" (item 6). */
function confirmDeadline(job: Job): StatusDeadline | null {
  if (!job.date_needed) return null;
  const ms = confirmDeadlineMs(job.date_needed, job.start_time ?? null);
  return Number.isNaN(ms) ? null : { source: "confirm_deadline", at: new Date(ms).toISOString(), consequenceText: "left to confirm", expiredText: "Confirm window passed" };
}

function columnDeadline(
  source: Exclude<DeadlineSource, "auto_complete">,
  at: string | null | undefined,
  consequenceText: string,
  expiredText: string,
): StatusDeadline | null {
  return at ? { source, at, consequenceText, expiredText } : null;
}

/** When the poster's approval window on submitted work ends (Helpr support steps in), or null. */
function autoCompleteAt(job: Pick<Job, "helper_completed_at">): string | null {
  if (!job.helper_completed_at) return null;
  const t = new Date(job.helper_completed_at).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + hoursToMs(APPROVAL_WINDOW_HOURS)).toISOString();
}

/** The offer's clock: the same `??` OfferedActions reads. */
function offerDeadline(job: Job, consequenceText: string): StatusDeadline | null {
  if (job.response_deadline) {
    return columnDeadline("response_deadline", job.response_deadline, consequenceText, "Offer expired");
  }
  return columnDeadline("direct_offer_expires_at", job.direct_offer_expires_at, consequenceText, "Offer expired");
}

/** A dispute's clock runs only until an admin takes it (posterDisputeControls). */
function disputeDeadline(job: Job): StatusDeadline | null {
  const status = (job as { dispute_status?: string | null }).dispute_status;
  if (status === "escalated" || status === "resolved") return null;
  return columnDeadline(
    "dispute_deadline",
    job.dispute_deadline,
    "until support decides",
    "With Helpr support",
  );
}

/** A row of the copy tables. `eyebrow`/`tone` override the bucket's own. */
interface WaitCopy {
  detail: string;
  eyebrow?: string;
  tone?: JobStatusTone;
}

/** The two money-problem lines, identical on both tabs (never role-based). */
const PROBLEM_WAIT: Record<JobPaymentProblem, "bank_dispute" | "payment_failed"> = {
  chargeback: "bank_dispute",
  failed: "payment_failed",
};
function problemCopy(): Record<"bank_dispute" | "payment_failed", WaitCopy> {
  const line = (p: JobPaymentProblem): WaitCopy => ({
    detail: PAYMENT_PROBLEM_COPY[p].detail,
    eyebrow: PAYMENT_PROBLEM_COPY[p].eyebrow,
    tone: "alarm",
  });
  return { bank_dispute: line("chargeback"), payment_failed: line("failed") };
}

/**
 * The money problem that outranks what `jobs.status` says, or null. The
 * precedence (a chargeback outranks everything, a declined card everything but
 * a cancelled job) lives in `cardPaymentProblem`, shared with the notice.
 */
function problemWait(job: Job): "bank_dispute" | "payment_failed" | null {
  const problem = cardPaymentProblem(job);
  return problem ? PROBLEM_WAIT[problem] : null;
}

const BUCKET_TONE: Record<ActivityBucket, JobStatusTone> = {
  needs_you: "you",
  waiting: "them",
  scheduled: "ahead",
  done: "done",
  cancelled: "over",
};

/* ═══════════════════════════ THE POSTER'S SIDE ═══════════════════════════ */

export type PosterWait =
  | "in_review"
  | "applicants"
  | "listing_expired"
  | "no_applicants"
  | "offer_out"
  | "unconfirmed"
  | "confirmed"
  | "confirm_still_on"
  | "on_the_way"
  | "confirm_arrival"
  | "working"
  | "approve"
  | "revision_out"
  | "revision_fixed"
  | "stalled"
  | "overdue_unhired"
  | "overdue_unconfirmed"
  | "overdue_not_started"
  | "overdue_not_arrived"
  | "overdue_no_show"
  | "overdue_unfinished"
  | "started_no_checkin"
  | "crew_underway"
  | "crew_overdue"
  | "dispute"
  | "dispute_escalated"
  | "bank_dispute"
  | "payment_failed"
  | "dispute_settling"
  | "done_payout_pending"
  | "done_refunded"
  | "done_paid"
  | "done_tip_open"
  | "done_tip_open_review_closed"
  | "done_review_open"
  | "done_both_open"
  | "done_marked"
  | "cancelled";

/**
 * The poster's sentence for every state a collapsed /posts card can hold.
 *
 * Written from the POSTER's point of view — the same job says something
 * different on the other tab (see HELPER_WAIT). The owner's own example, "now
 * you need to confirm", is this table's `confirm_arrival`.
 */
export const POSTER_WAIT: Record<PosterWait, WaitCopy> = {
  in_review: { detail: "We're checking this post" },
  applicants: { detail: "Applicants are waiting" },
  listing_expired: { detail: "The listing has expired" },
  no_applicants: { detail: "No applicants yet" },
  offer_out: { detail: "Your offer is with them" },
  /* ACCEPT, NOT CONFIRM (owner, 2026-10-07, Q1399): this is an offer the
     Helpr has not accepted yet; "confirm" is the later day-before step
     (JobConfirmation), and the two words on one card read as one state. */
  unconfirmed: { detail: "Offer sent — they haven't accepted yet" },
  confirmed: { detail: "Booked: they accepted" },
  /* The day-before window is open and the poster has not said the job is
     still on (Q1574): the card sits in Needs You, so its sentence says why. */
  confirm_still_on: { detail: "Confirm the job is still on" },
  /* FINDING #2: `postedActivityBucket` files any job whose DAY IS TODAY under
     Needs You (`jobIsLive`), which is right for a sort and wrong for a
     sentence — a Helpr driving over is not something the poster can act on.
     This is the owner's own example ("if the person is on their way"). */
  on_the_way: { detail: "Your Helpr is on the way", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  /* FINDING #5, and the mirror image of #2: `postedActivityBucket` files an
     `in_progress` job dated in the FUTURE under Scheduled (`jobIsLive` only
     lifts TODAY into Needs You), so a Helpr who starts early leaves the poster
     reading "Scheduled · Confirm they arrived" — a calm word over a tap the
     poster owes right now. The confirmation ladder is the authority on whether
     a confirmation is owed, and when it says yes the eyebrow may not disagree.
     These two are also the owner's own example: "confirmed but now you need to
     confirm". */
  confirm_arrival: { detail: "Confirm they arrived", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  /* FINDING #2 again, same rule, later step. */
  working: { detail: "Your Helpr is working", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  approve: { detail: "Approve & release pay" },
  /* FINDING #3: `postedActivityBucket` returns Needs You for EVERY
     `revision_requested` job, including the half of it where the poster has
     already asked and the fix is out with the Helpr — which `workIsBackWithHelper`
     (the bucket's own predicate, two functions away) answers correctly and the
     bucket never consults. */
  revision_out: { detail: "They're making the fix", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  revision_fixed: { detail: "Check their fix" },
  /* Owner, 2026-10-01: say WHO is being waited on. "Waiting on your Helpr to
     mark the work done" was asked for; at 215.4px it breaks the 194px budget
     at 320, so this is the same sentence with "it" for "the work". */
  // Needs you, so it names the fact, not a wait (lead 2026-10-20); the face offers Message.
  stalled: { detail: "Your Helpr hasn't marked it done" },
  /* PAST THE DAY, NAMED BY THE STEP THAT IS ACTUALLY NEXT (owner, 2026-10-01).
     "Day passed — mark it done or cancel" offered the poster a "mark it done"
     their tracker never has before the Helpr submits. Each of these names the
     tracker's own next move for the state the job is in: the open and
     scheduled steps carry Cancel, an in-progress job whose Helpr never arrived
     carries No-Show (InProgressStep), and an in-progress job whose Helpr is
     there has nothing for the poster to do until the work is submitted. */
  overdue_unhired: { detail: "Day passed, nobody hired — cancel?" },
  overdue_unconfirmed: { detail: "Your Helpr never accepted — cancel?" },
  overdue_not_started: { detail: "Your Helpr never started — cancel?" },
  overdue_not_arrived: { detail: "Your Helpr never arrived — cancel?" },
  overdue_no_show: { detail: "Your Helpr never arrived — No-Show?" },
  overdue_unfinished: { detail: "Waiting on your Helpr to finish", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  /* THE START TIME PASSED AND NOBODY CHECKED IN (audit 2026-10-29 A2-B12). auto-start-due-jobs turns every booked
     job in_progress at its start, whether or not the Helpr set out or arrived; the card read "Eli is at the job",
     the job page "Work is underway". The eyebrow says the start passed; what to do (wait, message, or report a no-show) is the poster's call. */
  started_no_checkin: { detail: "Your Helpr hasn't checked in", eyebrow: "Start time passed", tone: "you" },
  /* A CREW HAS NO ONE HELPR (JOBS-4). helper_id is null on a crew and the arrival stamps live per member in
     group_job_helpers, so every line above read "Your Helpr never arrived — No-Show?" over a roster of confirmed
     people, and report_helper_no_show always refuses it (no_helper_assigned). The roster on the card says who is where. */
  crew_underway: { detail: "Waiting on your crew to finish", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  crew_overdue: { detail: "Your crew hasn't finished yet", eyebrow: "Past the day", tone: "them" },
  /* THE OLD `DisputeOpenBadge`, VERBATIM — the words, the tone and the
     consequence line are unchanged, because this strip IS that badge
     generalised (owner: "similar to how dispute open displays"). The eyebrow
     overrides the bucket's "Needs You" because "Needs you · Payment on hold"
     loses the one word that matters. */
  dispute: { detail: "Payment on hold", eyebrow: "Dispute open", tone: "alarm" },
  dispute_escalated: { detail: "Payment on hold", eyebrow: "Admin reviewing", tone: "alarm" },
  /* MONEY PROBLEMS (Q360). jobs.status cannot show them: a chargeback leaves
     the job 'completed' (or wherever it was) and a declined card leaves it
     'open'. Same words on both tabs — see PAYMENT_PROBLEM_COPY. */
  ...problemCopy(),
  /* DECIDED IS NOT PAID (Q344). rpc_decide_dispute moves the job to completed
     or cancelled the moment an admin rules, and execute-dispute-split moves
     the money later. Until the dispute row reads execution_status='executed'
     this card said "Done · paid and closed" (poster) / "Paid out" (Helpr) over
     money that had not moved. The flag comes from the dispute row, not the
     job: a withdrawn dispute writes the same job columns. */
  dispute_settling: { detail: "Decided — payment processing", eyebrow: "Dispute decided", tone: "them" },
  /* DONE MEANS BOTH (owner, 2026-09-21): "it shouldnt say done if tip is not
     complete… it shouldnt say done if reviewed and tip have not both been done.
     it should also only have 1 check at the bottom. it cant be both done and
     reviewed tip open."
     The card used to carry TWO rows here — PostedJobCard printed its own
     "Reviewed — tip still open" strip above this one, so a job with a loose end
     showed a check for the loose end AND a check for "Done". Both rows are this
     one row now, and the check is reserved for the state that has earned it.
     Clock rather than alert on the open ones: the work is finished and paid, so
     nothing is wrong — something is merely outstanding. */
  /* PAYOUT PENDING IS NOT PAID (Q451, owner 2026-09-27): "a completed job whose
     payout has not been sent yet must read 'Done · payout pending' instead of
     'Done · paid and closed' / 'Paid out'." Approving completion sets
     payment_status = 'payout_pending' immediately; it only becomes 'released'
     once the transfer actually settles, hours to days later (see
     supabase/migrations/20260825053000_reviews_allow_payout_pending.sql). This
     card said "paid and closed" for that whole window over money that had not
     moved — the same class of bug `dispute_settling` (Q344) fixed above, for
     the ordinary case instead of the disputed one. */
  done_payout_pending: { detail: "Done · payout pending" },
  /* REFUNDED IS NOT PENDING (Q757(2), lh-money-escrow note on Q451): a full
     Stripe refund closes a completed job's `payout_pending` to `refunded`
     (stripe-webhook chargeRefunded, REFUND_CLOSABLE_PAYMENT_STATES), and this
     card then said "payout pending" over money that had gone back to the
     card. The line states only what the row holds: the payment was refunded.
     Same words on both tabs (completedAndRefunded). */
  done_refunded: { detail: "Done · payment refunded" },
  done_paid: { detail: "Done · paid and closed" },
  done_tip_open: { detail: "Reviewed — tip still open", tone: "them" },
  /* Not reviewed, but the review window has closed (30 days, DH-003): only the tip is left to offer. */
  done_tip_open_review_closed: { detail: "Tip still open", tone: "them" },
  done_review_open: { detail: "Tip left — review still open", tone: "them" },
  done_both_open: { detail: "Review and tip still open", tone: "them" },
  /* A cancelled job filed under Done (owner 2026-10-25, jobs.poster_marked_done_at):
     "just have them in my done section", and no "done outside the app" wording. */
  done_marked: { detail: "Done" },
  /* The reason, when the job has one, follows as the line's `suffix`. */
  cancelled: { detail: "Cancelled" },
};

/**
 * Q344: the job carries a decided dispute whose money has not moved yet.
 *
 * Not on the jobs row (a withdrawn dispute writes the same status and
 * dispute_status as a decided one): the card attaches it from the dispute row
 * with `withDisputeSettling` (useUnsettledDisputeJobIds).
 */
export type DisputeSettlingFlag = { dispute_settling?: boolean };

function disputeSettling(job: object): boolean {
  return (job as DisputeSettlingFlag).dispute_settling === true;
}

/**
 * Q451: a completed job's payout has not actually been sent yet.
 *
 * `jobs.payment_status` reaches this point (a `completed` job, not disputed
 * and not a chargeback/decline — those are handled earlier) at one of the
 * MOVING values from the `jobs_payment_status_check` constraint
 * (supabase/migrations/20260824210000_r19_r20_latent_leaks_and_cancelling_status.sql):
 * `'payout_pending'`, `'released'`, `'refunded'`, `'chargeback'`, `'cancelling'`,
 * or occasionally still `'escrow'` for a job whose approval write hasn't
 * landed yet. `'released'` is the ONLY one of those that means the transfer to
 * the Helpr has actually settled — see
 * supabase/migrations/20260825053000_reviews_allow_payout_pending.sql, whose
 * comment states plainly that approval sets `payout_pending` first and the
 * row only becomes `released` "when the payout actually settles, hours
 * later". Anything else reaching here (including a null/missing value) is
 * treated as "not yet paid out" — the safer default for a money label.
 */
function payoutNotSettled(job: { payment_status?: string | null }): boolean {
  return job.payment_status !== "released";
}

/**
 * Q757(2): a completed job whose payment went back to the card. Checked
 * before the status switch on both tabs, after the card-problem states, so
 * neither "payout pending" nor a loose-end line is drawn over a refund.
 */
function completedAndRefunded(job: { status?: string | null; payment_status?: string | null }): boolean {
  return job.status === "completed" && job.payment_status === "refunded";
}

/** The job, flagged when its dispute is decided but not yet executed. */
export function withDisputeSettling<J extends { id: string }>(
  job: J,
  unsettledJobIds: ReadonlySet<string> | undefined,
): J & DisputeSettlingFlag {
  return unsettledJobIds?.has(job.id) ? { ...job, dispute_settling: true } : job;
}

/** What the card knows of a finished job's loose ends (useActivityData's CompletedJobMeta entry). */
type PosterCompletion = { tipped: boolean; reviewed: boolean; crewToReview?: ReadonlyArray<{ id: string }> };

/**
 * Is there anyone to review or tip on this finished job? (Live bug 2026-10-29, AL-009's class.)
 *
 * A Helpr who deleted their account leaves `helper_id` NULL (jobs_helper_id_fkey ON DELETE SET NULL), and a crew
 * whose every member left has nobody in `crewToReview`. The face's Review handler (openReviewForPosted) returns early
 * on both and the Tip has no payee, so a loose end there would be a button that does nothing. CompletedStep's
 * canReview refuses the same cases. Guard: src/test/faceNeverOffersADeadReview.test.ts.
 */
/**
 * Can the poster still leave a review? CompletedStep's canReview, minus the counterpart (hasCounterpart): the
 * reviews INSERT policy takes one only once the payout is approved (payout_pending or released) and only inside
 * the 30-day window (DH-003, reviewWindowOpen). Past either, a "Leave a review" button would be refused.
 */
function reviewCanBeLeft(job: Job): boolean {
  return (job.payment_status === "released" || job.payment_status === "payout_pending") && reviewWindowOpen(job);
}

function hasCounterpart(job: Pick<Job, "is_group_job" | "helper_id">, completion: PosterCompletion): boolean {
  if (job.is_group_job) return (completion.crewToReview?.length ?? 0) > 0 || completion.reviewed;
  return !!job.helper_id;
}

/**
 * Which sentence a job I POSTED is owed.
 *
 * PRECEDENCE MIRRORS `postedActivityBucket`'s OWN, deliberately and in the same
 * order: terminal states, then a submission awaiting approval, then a revision,
 * then overdue, then the open-listing branch. Where the two walked different
 * orders the eyebrow and the detail could name different steps of one job.
 */
export function derivePosterWait(
  job: Job,
  pendingApplicantCount = 0,
  now: Date = new Date(),
  /**
   * Whether the poster has tipped and reviewed, when the caller knows.
   *
   * It belongs HERE rather than as a refinement applied afterwards in
   * `posterStatusLine`, and the guard is what settled that:
   * `collapsedStatusSentence.test.tsx` asserts every id in `PosterWait` is
   * produced by THIS function from its declared inputs. A state reachable only
   * through a later refinement would have been permanently "unproven" — the
   * check would have been telling the truth, so the fix is to make the input
   * real rather than to loosen the check.
   *
   * Absent meta keeps the old answer, `done_paid`: a caller that cannot see the
   * loose end must not invent one.
   */
  completion?: PosterCompletion,
): PosterWait {
  // Money first (Q360): a chargeback or a declined card is invisible in
  // `jobs.status`, so the switch below would call the job healthy.
  const problem = problemWait(job);
  if (problem) return problem;
  if (completedAndRefunded(job)) return "done_refunded";
  switch (job.status) {
    case "cancelled":
      if (disputeSettling(job)) return "dispute_settling";
      return job.poster_marked_done_at ? "done_marked" : "cancelled";
    case "completed":
      if (disputeSettling(job)) return "dispute_settling";
      /* Which finish it is depends on the loose ends, not on the row. A loose end needs someone to close it
         with (hasCounterpart): with nobody, the job is simply finished. */
      if (completion && hasCounterpart(job, completion)) {
        // Past the review window (or before the payout is approved) no review is offered: the server would refuse it.
        const reviewOpen = !completion.reviewed && reviewCanBeLeft(job);
        if (!completion.tipped && !reviewOpen) return completion.reviewed ? "done_tip_open" : "done_tip_open_review_closed";
        if (completion.tipped && reviewOpen) return "done_review_open";
        if (reviewOpen) return "done_both_open";
      }
      return payoutNotSettled(job) ? "done_payout_pending" : "done_paid";
    case "disputed":
      return (job as { dispute_status?: string | null }).dispute_status === "escalated"
        ? "dispute_escalated"
        : "dispute";
    case "pending_approval":
      return "in_review";
    case "open":
      if (job.direct_offer_status === "pending") return "offer_out";
      if (jobIsOverdue(job)) return "overdue_unhired";
      if (pendingApplicantCount > 0) return "applicants";
      if (listingHasExpired(job.expires_at, now)) return "listing_expired";
      return "no_applicants";
    case "accepted":
    case "in_progress":
    case "revision_requested": {
      // Work submitted and not yet approved is the poster's move whatever else
      // is true of the job — the bucket checks this first too.
      if (submissionAwaitingPoster(job)) return "approve";
      if (job.status === "revision_requested") {
        return workIsBackWithHelper(job) ? "revision_out" : "revision_fixed";
      }
      // A crew has no one Helpr to confirm, chase or report (JOBS-4): none of the single-Helpr lines below is true of it.
      if (job.is_group_job && (job.status === "in_progress" || jobIsOverdue(job))) {
        return jobIsOverdue(job) ? "crew_overdue" : "crew_underway";
      }
      /* THE LADDER, ASKED ONCE, AND ASKED BEFORE THE CALENDAR.
         It owns "what confirmation is owed right now", including the
         stalled-job notice, and nothing here may enable one it would not.

         IT OUTRANKS `overdue` DELIBERATELY, and `posterStepContract` already
         argued the same precedence for the same reason: a specific blocker
         beats a vaguer one downstream of it. Every stalled job is by
         definition past its day, so an overdue check above this one would
         swallow the stalled notice entirely — the poster would read "The day
         has passed" where the truth is "nobody marked it done and your money
         is still held". The EYEBROW is unaffected either way: `jobIsOverdue`
         and the ladder both bucket to Needs You, so this changes which
         sentence is shown, never whose move the card claims it is. */
      const rung = posterConfirmationRung(job, derivePosterStep(job.status)!, now);
      if (rung?.stalled) return "stalled";
      // The WORKING vouch is not a collapsed state any more (Q1571): it waits
      // for the Helpr's Start working, which is on their tracker, not on this
      // row, and it is optional (owner answer 3). The card says "Lexi is working".
      if (rung?.enabled && rung.action === "arrival") return "confirm_arrival";
      if (jobIsOverdue(job)) {
        if (job.status === "in_progress") {
          return job.helper_arrived_at ? "overdue_unfinished" : "overdue_no_show";
        }
        if (!job.helper_confirmed_at) return "overdue_unconfirmed";
        if (!job.helper_on_the_way_at) return "overdue_not_started";
        return "overdue_not_arrived";
      }
      if (job.status === "accepted" && !job.helper_confirmed_at) return "unconfirmed";
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      // In progress by the clock only (auto-start-due-jobs), with no arrival anyone recorded: not "at the job" (A2-B12).
      if (job.status === "in_progress" && !job.helper_arrived_at && !job.poster_confirmed_arrival_at && !job.poster_confirmed_working_at) {
        // T12-B: a start still ahead hasn't "passed", and Report no-show would be refused or wrong: it stays confirmed.
        const start = jobStartDateTime(job.date_needed, job.start_time);
        return start && start.getTime() > now.getTime() ? "confirmed" : "started_no_checkin";
      }
      if (job.status === "in_progress") return "working";
      if (agreedJobStage(job, "poster", now) === "confirm_owed") return "confirm_still_on";
      return "confirmed";
    }
    default:
      // A new `job_status` enum member is a BUILD error here, not a blank strip.
      return assertNever(job.status);
  }
}

export function posterStatusLine(
  job: Job,
  pendingApplicantCount = 0,
  now: Date = new Date(),
  /**
   * Whether the poster has tipped and reviewed this job, when known.
   *
   * Optional and defaulted so every existing call site keeps working and keeps
   * reading "Done · paid and closed" — the completion meta lives in
   * `useCardExpansion`'s `CompletedJobMeta` and only the card that renders a
   * finished job has it. Absent meta is NOT treated as "both open": a caller
   * that cannot see the loose end should not invent one.
   */
  completion?: PosterCompletion,
  /**
   * The poster's instant-release setting (`profiles.auto_release_on_complete`).
   * It is not on the job row, so only a caller that has it can pass it; with it
   * on there is no auto-complete clock to show (InProgressStep hides it too).
   */
  instantRelease = false,
  /** The hired Helpr's display name: the sentence names them (Q1552). */
  helperName?: string | null,
  /** The surface's tracking-row progress, when it has it (the job page's tracker): see workHasBegun. */
  progress?: { workUnderway?: boolean },
): JobStatusLine {
  const id = derivePosterWait(job, pendingApplicantCount, now, completion);
  const copy = POSTER_WAIT[id];
  const bucket = postedActivityBucket(job, pendingApplicantCount, now);
  // "working" says "is working" exactly when the tracker's Working step has begun (workHasBegun: one rule for the
  // card line, the tracker's line and the step colour; lead 2026-10-31), else "is at the job".
  const atTheJob = id === "working" && !workHasBegun(job, { workUnderway: progress?.workUnderway });
  const named = helperName ? (atTheJob ? `${firstName(helperName)} is at the job` : POSTER_NAMED[id]?.(helperName, job)) : undefined;
  // Expired is not cancelled (owner 10-31, src/lib/expiredListing.ts): the poster's
  // own card says "Expired", never "Cancelled", and keeps its Post again.
  const expired = id === "cancelled" && isExpiredListing(job);
  return {
    id,
    eyebrow: expired ? EXPIRED_WORD : copy.eyebrow ?? BUCKET_LABEL[bucket],
    detail: expired ? EXPIRED_LISTING_DETAIL : named ?? (atTheJob ? "Your Helpr is at the job" : copy.detail),
    tone: copy.tone ?? BUCKET_TONE[bucket],
    owesConfirmation: id === "confirm_arrival",
    suffix: id === "cancelled" ? cancelledSuffix(job) : null,
    deadline: posterDeadline(id, job, instantRelease),
  };
}

/** The poster's line for a listing that expired with no Helpr (never "Cancelled"). */
export const EXPIRED_LISTING_DETAIL = "No Helpr was hired in time";
/** What an APPLICANT reads for a listing that expired (owner 10-31: "Expired" is the poster's word only). */
const APPLICANT_CLOSED_EYEBROW = "Closed";
const APPLICANT_CLOSED_DETAIL = "No longer open";

/** The cancelled line's tail for the POSTER: the reason, and that their money
 *  came back when it did (owner, 2026-10-06). Only on payment_status
 *  'refunded', the state void-cancelled-payments writes after a full refund. */
export function cancelledSuffix(job: Job): string | null {
  // An expired listing's fixed sweep reason is the detail's own sentence; only the refund follows.
  const reason = isExpiredListing(job) ? null : sanitizeCancellationReason(job.cancellation_reason);
  if (job.payment_status !== "refunded") return reason;
  return reason ? `${reason} · Your payment was refunded` : "Your payment was refunded";
}

/** The clock behind each poster state that has one; null for the rest. */
export function posterDeadline(id: PosterWait, job: Job, instantRelease = false): StatusDeadline | null {
  switch (id) {
    case "offer_out":
      return offerDeadline(job, "left for their answer");
    // Past the day and still unconfirmed: the Helpr's confirm window is still
    // running (ScheduledStep shows it expanded), so the collapsed line shows it too.
    case "unconfirmed":
    case "overdue_unconfirmed":
      return columnDeadline("response_deadline", job.response_deadline, "left to accept", "Accept window passed");
    case "revision_out":
      return columnDeadline("revision_deadline", job.revision_deadline, "left for their fix", "Fix deadline passed");
    // In the confirm window the clock that matters is the confirm's own deadline, not the start (item 6).
    case "confirm_still_on":
      return confirmDeadline(job);
    case "revision_fixed":
      return columnDeadline(
        "revision_acceptance_deadline",
        job.revision_acceptance_deadline,
        "to accept the fix",
        "Helpr support is stepping in",
      );
    case "dispute":
      return disputeDeadline(job);
    case "approve": {
      const at = instantRelease ? null : autoCompleteAt(job);
      return at
        ? {
            source: "auto_complete",
            at,
            consequenceText: "left to review",
            expiredText: "Helpr support is stepping in",
          }
        : null;
    }
    default:
      return null;
  }
}

/* ═══════════════════════════ THE HELPER'S SIDE ═══════════════════════════ */

export type HelperWait =
  | "job_gone"
  | "not_selected"
  | "helper_cancelled"
  | "reported_no_show"
  | "cancelled"
  | "applied"
  | "offer"
  | "offer_expired"
  | "confirm_booking"
  | "confirm_spot"
  | "confirmed"
  | "confirm_day"
  | "today"
  | "on_the_way"
  | "before_photo"
  | "start_working"
  | "arrival_unconfirmed"
  | "after_photo"
  | "working"
  | "submitted"
  | "revision"
  | "revision_sent"
  | "overdue_not_started"
  | "overdue_not_arrived"
  | "overdue_unfinished"
  | "overdue_before_photo"
  | "overdue_start_working"
  | "overdue_arrival_unconfirmed"
  | "overdue_after_photo"
  | "dispute"
  | "dispute_escalated"
  | "bank_dispute"
  | "payment_failed"
  | "dispute_settling"
  | "done_payout_pending"
  | "done_refunded"
  | "done_paid";

/**
 * The helper's sentence — the SAME jobs as POSTER_WAIT, read from the other end.
 *
 * "Approve & release pay" over there is "With them for approval" here; "They
 * haven't confirmed" is "Confirm you'll be there". That asymmetry is the whole
 * reason the line is derived per side rather than shared: a status word is the
 * same for both parties, and whose move it is never is.
 */
export const HELPER_WAIT: Record<HelperWait, WaitCopy> = {
  job_gone: { detail: "This job has closed" },
  not_selected: { detail: "You weren't picked" },
  /* They cancelled it themselves (closed_reason 'helper_cancelled', 20261031013445, JOBS-21): nobody passed on them. */
  helper_cancelled: { detail: "You cancelled this job" },
  /* Closed by the poster's no-show report (closed_reason 'no_show', 20261029180706): nobody passed on them. The
     collapsed card's one line (collapsedStatusSentence: 194px at 320) holds the short form; the closed label and
     the job page say the whole sentence, "This job was reported as a no-show". */
  reported_no_show: { detail: "Reported as a no-show" },
  /* The reason, when the job has one, follows as the line's `suffix`. */
  cancelled: { detail: "Cancelled" },
  applied: { detail: "They haven't replied yet" },
  offer: { detail: "Accept or decline it" },
  /* Its answer window closed (offerClock): filed under Cancelled with the
     card's own "This offer has expired" (owner, 2026-10-03). */
  offer_expired: { detail: "The offer expired" },
  /* Accept, not confirm (owner, 2026-10-07, Q1399): confirm is the later
     day-before step. */
  confirm_booking: { detail: "Accept or decline it" },
  /* A crew member the poster hired, whose spot is not confirmed yet (Q1402):
     the crew card's one button is "Confirm My Spot" (CrewMemberSection), so
     "Accept or decline it" named a choice that card does not offer. */
  // A crew member ACCEPTS their spot (Q1523, owner Q1399): the strip names the button's step.
  confirm_spot: { detail: "Accept your spot" },
  confirmed: { detail: "You're scheduled" },
  /* The day-before window is open and this Helpr has not confirmed (Q1574). */
  confirm_day: { detail: "Confirm you'll be at the job" },
  // The job's start has come (agreedJobStage "started"); the countdown said the rest (Q1552).
  today: { detail: "It's time — tap I'm on my way" },
  /* FINDING #5 on the Helpr's side. `appliedActivityBucket` lifts only TODAY's
     work into Needs You, so a job started a day early reads "Scheduled ·
     You're on the way" / "Scheduled · Finish and mark it done" — a commitment
     word over the two things a Helpr is mid-way through doing. Both are
     unambiguously theirs to finish whatever the calendar says. */
  on_the_way: { detail: "You're on the way", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  /* Arrived, and the owed before photo is the card's primary ("Take Before
     Photo", primaryPhotoAsk.ts): the line names that step, not the finish
     (seed job 90aa6c8b at 375, 2026-10-12, read "Finish and mark it done"). */
  before_photo: { detail: "Take the before photo", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  /* Arrived, on the on-site step (the tracking row says work has not
     started), before photo taken or not owed: the expanded primary is the
     tracker's "Start working" (lane B, 2026-10-12: the line read "Finish and
     mark it done"). Read only when the card passes its tracking progress. */
  start_working: { detail: "Tap Start working", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  /* The same step while Start working is still locked on the arrival rule
     (no GPS match, no poster tap: arrivalEstablished). The tracker's amber
     line names the poster's "Confirm they've arrived" as the one way out. */
  arrival_unconfirmed: { detail: "Waiting on them to confirm you arrived", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  /* Working (tracking row), and the owed after photo is the working step's
     primary ("Take After photo", primaryPhotoAsk.ts). */
  after_photo: { detail: "Take the after photo", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  working: { detail: "Finish and mark it done", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  submitted: { detail: "With them for approval" },
  /* The poster's note, when there is one, follows as the line's `suffix`. */
  revision: { detail: "Revision requested" },
  /* FINDING #4, the helper's half of finding #3: `appliedActivityBucket`
     returns Needs You for `revision_requested` unconditionally, so a Helpr who
     has already resubmitted is told they still owe something. */
  revision_sent: { detail: "Your fix is with them", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  /* PAST THE DAY, NAMED BY THE NEXT TRACKER STEP (owner, 2026-10-01). "Mark
     it done or cancel" offered a "mark it done" the Helpr's tracker does not
     have until they are at the job. A Helpr who has not set off owes On My
     Way (or `helper_cancel_booking`), one on the way owes I've arrived, and
     one at the job owes finishing and Mark Done. */
  overdue_not_started: { detail: "Day passed — On My Way or cancel" },
  overdue_not_arrived: { detail: "Day passed — tap I've arrived" },
  overdue_unfinished: { detail: "Day passed — finish and mark it done" },
  /* Past the day, at the job, and the before photo is still the primary. */
  overdue_before_photo: { detail: "Day passed — take the before photo" },
  /* Past the day, at the job, work not started (tracking row): the next step is Start working. */
  overdue_start_working: { detail: "Day passed — tap Start working" },
  /* Shorter than its on-the-day twin: the 320 line has room for no name here. */
  overdue_arrival_unconfirmed: { detail: "Day passed — arrival not confirmed" },
  overdue_after_photo: { detail: "Day passed — take the after photo" },
  dispute: { detail: "Payment on hold", eyebrow: "Dispute open", tone: "alarm" },
  dispute_escalated: { detail: "Payment on hold", eyebrow: "Admin reviewing", tone: "alarm" },
  ...problemCopy(),
  /* Q344, the Helpr's half: see POSTER_WAIT.dispute_settling. */
  dispute_settling: { detail: "Decided — payment processing", eyebrow: "Dispute decided", tone: "them" },
  /* Q451, the Helpr's half: see POSTER_WAIT.done_payout_pending. Same
     condition (`payoutNotSettled`), same not-actually-paid window; the
     existing "Paid out" line claimed the transfer had happened the moment the
     poster approved, which is up to a few days early. */
  done_payout_pending: { detail: "Done · payout pending" },
  /* Q757(2): see POSTER_WAIT.done_refunded. It says nothing about the Helpr's
     own payout, which this row cannot tell. */
  done_refunded: { detail: "Done · payment refunded" },
  done_paid: { detail: "Paid out" },
};

/**
 * What the card's tracking row adds to the jobs row: whether work has started
 * (helperProgress, src/pages/jobs/appliedJobCard/steps/helperProgress.ts, the
 * derivation the expanded card picks its step from). Absent = not known, and
 * an arrived job reads as before ("working").
 */
export type HelperCardProgress = { workUnderway: boolean };

/**
 * An arrived Helpr's next step, named the way the expanded card names its
 * primary: at the working step (tracking row) the owed after photo, else
 * finishing; at the on-site step the owed before photo, else the tracker's
 * Start working, or its arrival lock (arrivalEstablished) while that is shut.
 * Without the card's progress an arrived job reads as before: the before photo
 * when it is owed (no photo, no Start working: tracker_requires_before_photo),
 * else "working".
 */
type ArrivedWait = "after_photo" | "working" | "before_photo" | "start_working" | "arrival_unconfirmed";
function arrivedWait(job: Job, progress: HelperCardProgress | undefined): ArrivedWait {
  // An owed BEFORE photo comes first, even when the card infers work is underway (no tracking row it knows of,
  // the poster confirmed the arrival): the server lets nobody start without it (enforce_job_tracking_arrival_gate)
  // or finish without it (completion_requires_proof_photos), so "Take the after photo" would skip a photo that is
  // still required (owner, 2026-10-23: keep the before and after photos). Guard: trackerKeepsThePhotos.test.tsx.
  if (beforePhotoIsThePrimary(job)) return "before_photo";
  if (progress?.workUnderway) return afterPhotoIsThePrimary(job) ? "after_photo" : "working";
  if (!progress || !job.helper_arrived_at) return "working";
  return arrivalEstablished(job) ? "start_working" : "arrival_unconfirmed";
}

/**
 * Which sentence a job I APPLIED TO is owed.
 *
 * Same precedence as `appliedActivityBucket`, including its first rule: NO JOB
 * ROW MEANS THE JOB IS GONE, not "still waiting on a decision".
 */
export function deriveHelperWait(app: AppliedApp, progress?: HelperCardProgress): HelperWait {
  const job = app.job;
  if (!job) return "job_gone";
  // Q1207: the hourly sweep (expire_unanswered_offers) closes a lapsed offer
  // as 'rejected' and reopens the job, so after it runs only this stamp says
  // the offer expired. Nobody passed on this Helpr.
  if (app.status === "rejected" && app.closed_reason === "offer_expired") return "offer_expired";
  // The poster reported a no-show (report_helper_no_show closes the application with closed_reason
  // 'no_show'): say so plainly, never "You weren't picked".
  if (app.status === "rejected" && app.closed_reason === "no_show") return "reported_no_show";
  if (app.status === "rejected" && app.closed_reason === "helper_cancelled") return "helper_cancelled";
  // A job-cancel close (Q274) is 'rejected' too, but nobody passed on this
  // applicant: let the job's own status speak.
  if (app.status === "rejected" && app.closed_reason !== "job_cancelled") return "not_selected";
  // Money first (Q360), for everyone still on the job: a passed-over applicant
  // (any rejection, a job-cancel close included) is not told about someone
  // else's payment. appliedActivityBucket and AppliedJobCard's notice use the
  // same `app.status !== "rejected"` gate.
  const problem = app.status === "rejected" ? null : problemWait(job);
  if (problem) return problem;
  if (completedAndRefunded(job)) return "done_refunded";

  switch (job.status) {
    case "cancelled":
      return disputeSettling(job) ? "dispute_settling" : "cancelled";
    case "completed":
      if (disputeSettling(job)) return "dispute_settling";
      return payoutNotSettled(job) ? "done_payout_pending" : "done_paid";
    case "disputed":
      return (job as { dispute_status?: string | null }).dispute_status === "escalated"
        ? "dispute_escalated"
        : "dispute";
    case "pending_approval":
      return "applied";
    case "revision_requested":
      return workIsBackWithHelper(job) ? "revision" : "revision_sent";
    case "in_progress":
      // Submitted and sitting on the poster — the bucket says Waiting here too,
      // and stays Waiting even past the day: the Helpr has done everything.
      if (job.helper_completed_at && !job.poster_completed_at) return "submitted";
      if (jobIsOverdue(job)) return helperOverdue(job, progress);
      // AUD31-76: auto_start_due_jobs (20261029160717) moves every booked job to in_progress at its start time, so
      // the status no longer says the Helpr set out. With no On my way and no arrival (a one-Helpr job: a crew's
      // steps are per member, on the roster), the next step is still I'm on my way, never "Finish and mark it done".
      if (!job.is_group_job && !setOutOrArrived(job)) return "today";
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      // The expanded card's primary, photo or tracker step (primaryPhotoAsk.ts, helperProgress.ts).
      return arrivedWait(job, progress);
    case "open":
    case "accepted": {
      // A pending DIRECT OFFER, or an accepted application the Helpr has not
      // said yes to: the two states where the job is being HELD for them and
      // lapses if they do nothing. `needsHelperResponse` is the bucket's own
      // rule; this splits its two halves because the words differ. Past its
      // window either one is over, as appliedActivityBucket files it.
      if (offerHasExpired(app)) return "offer_expired";
      if (job.direct_offer_status === "pending" && job.offered_to_helper_id === app.helper_id) {
        return "offer";
      }
      if (app.status !== "accepted") return "applied";
      if (!job.helper_confirmed_at) return job.is_group_job ? "confirm_spot" : "confirm_booking";
      if (jobIsOverdue(job)) return helperOverdue(job, progress);
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      const stage = agreedJobStage(job, "helper");
      if (stage === "confirm_owed") return "confirm_day";
      if (stage === "started") return "today";
      return "confirmed";
    }
    default:
      return assertNever(job.status);
  }
}

/**
 * Which step an overdue Helpr is stuck before. The job row's stamps do not
 * separate arrived from working; the tracking row does, so with the card's
 * progress an arrived Helpr who has not started is owed Start working (or its
 * arrival lock), and without it the answer stays finish and mark it done.
 */
const OVERDUE_ARRIVED: Record<ArrivedWait, HelperWait> = {
  after_photo: "overdue_after_photo",
  working: "overdue_unfinished",
  before_photo: "overdue_before_photo",
  start_working: "overdue_start_working",
  arrival_unconfirmed: "overdue_arrival_unconfirmed",
};
/** Any stamp that says the Helpr set out or got there (their own taps, the GPS check, the poster's confirmations). */
function setOutOrArrived(job: Job): boolean {
  return !!(job.helper_on_the_way_at || job.helper_arrived_at || job.helper_arrival_verified_at || job.poster_confirmed_arrival_at || job.poster_confirmed_working_at);
}
function helperOverdue(job: Job, progress?: HelperCardProgress): HelperWait {
  if (job.helper_arrived_at) return OVERDUE_ARRIVED[arrivedWait(job, progress)];
  if (job.helper_on_the_way_at) return "overdue_not_arrived";
  // AUD31-76: an auto-started (in_progress) job with no On my way is not underway; only a crew's job-level stamps stay
  // empty while its members work (their steps are on the roster).
  return job.status === "in_progress" && (job.is_group_job || setOutOrArrived(job)) ? "overdue_unfinished" : "overdue_not_started";
}

export function helperStatusLine(
  app: AppliedApp,
  /** The poster's instant-release setting; see `posterStatusLine`. */
  posterInstantRelease = false,
  /** The card's tracking progress (helperProgress); absent on a reader without one. */
  progress?: HelperCardProgress,
): JobStatusLine {
  const id = deriveHelperWait(app, progress);
  const copy = HELPER_WAIT[id];
  const bucket = appliedActivityBucket(app);
  const posterFirst = posterFirstName(app.posterName);
  const named = posterFirst ? HELPER_NAMED[id]?.(posterFirst) : undefined;
  // Expired is not cancelled (owner 10-31): an applicant to a listing that
  // expired with no Helpr reads "Closed · No longer open", never "Cancelled"
  // and never "Expired" (only the poster sees "Expired", on their own jobs).
  const expired = id === "cancelled" && !!app.job && isExpiredListing(app.job);
  return {
    id,
    eyebrow: expired ? APPLICANT_CLOSED_EYEBROW : copy.eyebrow ?? BUCKET_LABEL[bucket],
    detail: expired ? APPLICANT_CLOSED_DETAIL : named ?? copy.detail,
    tone: copy.tone ?? BUCKET_TONE[bucket],
    owesConfirmation: id === "confirm_booking" || id === "confirm_spot",
    suffix:
      expired
        ? null
        : id === "cancelled"
        ? sanitizeCancellationReason(app.job?.cancellation_reason)
        : id === "revision"
          ? noteOrNull(app.job?.revision_note)
          : null,
    deadline: app.job ? helperDeadline(id, app.job, posterInstantRelease) : null,
  };
}

/** The clock behind each Helpr state that has one; null for the rest. */
export function helperDeadline(id: HelperWait, job: Job, posterInstantRelease = false): StatusDeadline | null {
  switch (id) {
    case "offer":
      return offerDeadline(job, "left to answer");
    case "confirm_booking":
      return columnDeadline("response_deadline", job.response_deadline, "left to confirm", "Confirm window passed");
    case "revision":
      return columnDeadline("revision_deadline", job.revision_deadline, "left to send the fix", "Fix deadline passed");
    case "confirm_day":
      return confirmDeadline(job);
    case "revision_sent":
      return columnDeadline(
        "revision_acceptance_deadline",
        job.revision_acceptance_deadline,
        "for them to review",
        "Helpr support is stepping in",
      );
    case "dispute":
      return disputeDeadline(job);
    case "submitted": {
      const at = posterInstantRelease ? null : autoCompleteAt(job);
      return at
        ? {
            source: "auto_complete",
            at,
            consequenceText: "for them to approve",
            expiredText: "Helpr support is stepping in",
          }
        : null;
    }
    default:
      return null;
  }
}

/* ── NAMES IN THE SENTENCE (owner, 2026-10-08, Q1552: "it should also say the
   person's name ... so Lexi Accepted or Lexi Confirmed or Lexi is on the way,
   Lexi is working"). The unnamed tables above stay the fallback when the name
   is not known; these replace only the states that are about the other
   person. ── */
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
/** "Sat 1:00 PM" in Louisiana time. */
const dayTime = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
const POSTER_NAMED: Partial<Record<PosterWait, (name: string, job: Job) => string>> = {
  offer_out: (n) => `Your offer is with ${firstName(n)}`,
  unconfirmed: (n) => `Offer sent — ${firstName(n)} hasn't accepted yet`,
  // WHAT IS NEXT, AND BY WHEN (owner, 2026-10-23, card critique item 5): not just "Hallie accepted".
  confirmed: (n, job) => {
    const f = firstName(n);
    if (job.helper_dayof_confirmed_at) return job.poster_confirmed_at ? `${f} confirmed · taps On my way when leaving` : `${f} confirmed`;
    if (!job.date_needed || Date.now() < confirmOpensMs(job.date_needed)) return `${f} accepted · confirms the day before`;
    // A2-C40: past the start the confirm deadline is gone; never "confirm by" a time already passed.
    if (Date.now() >= posterConfirmClosesMs(job.date_needed, job.start_time)) return `It's start time. ${f} hasn't confirmed`;
    return `Waiting on ${f} to confirm by ${dayTime(confirmDeadlineMs(job.date_needed, job.start_time ?? null))}`;
  },
  confirm_still_on: (n, job) =>
    `${firstName(n)} ${job.helper_dayof_confirmed_at ? "confirmed" : "accepted"} · confirm the job is still on`,
  on_the_way: (n) => `${firstName(n)} is on the way`,
  confirm_arrival: (n) => `${firstName(n)} arrived — confirm it`,
  // Work has begun (posterStatusLine sends the not-begun case to "is at the job"): the tracker's own rule, workHasBegun.
  working: (n) => `${firstName(n)} is working`,
  revision_out: (n) => `${firstName(n)} is making the fix`,
  revision_fixed: (n) => `${firstName(n)} sent the fix — check it`,
  stalled: (n) => `${firstName(n)} hasn't marked it done`,
  approve: (n) => `${firstName(n)} marked it done — approve & release pay`,
  overdue_unconfirmed: (n) => `${firstName(n)} never accepted — cancel?`,
  overdue_not_started: (n) => `${firstName(n)} never started — cancel?`,
  overdue_not_arrived: (n) => `${firstName(n)} never arrived — cancel?`,
  overdue_no_show: (n) => `${firstName(n)} never arrived — No-Show?`,
  overdue_unfinished: (n) => `Waiting on ${firstName(n)} to finish`,
  started_no_checkin: (n) => `${firstName(n)} hasn't checked in`,
};
const HELPER_NAMED: Partial<Record<HelperWait, (name: string) => string>> = {
  applied: (n) => `${n} hasn't replied yet`,
  offer: (n) => `${n} offered you this job`,
  confirm_booking: (n) => `${n} offered you this job`,
  submitted: (n) => `With ${n} for approval`,
  revision: (n) => `${n} asked for a fix`,
  revision_sent: (n) => `Your fix is with ${n}`,
  arrival_unconfirmed: (n) => `Waiting on ${n} to confirm you arrived`,
};

/** Every id both tables define — the inventory the guard measures against. */
export const POSTER_WAIT_IDS = Object.keys(POSTER_WAIT) as PosterWait[];
export const HELPER_WAIT_IDS = Object.keys(HELPER_WAIT) as HelperWait[];
