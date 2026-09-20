import {
  BUCKET_LABEL,
  appliedActivityBucket,
  jobIsOverdue,
  listingHasExpired,
  postedActivityBucket,
  submissionAwaitingPoster,
  workIsBackWithHelper,
  type ActivityBucket,
} from "@/pages/activity/activityFilters";
import { assertNever } from "@/lib/assertNever";
import type { AppliedApp, Job } from "./activityConstants";
import { shouldShowUnfundedNotice } from "./postedJobCard/UnfundedJobNotice";
import { derivePosterStep, posterConfirmationRung } from "./postedJobCard/steps/posterStepContract";

/**
 * WHAT THIS CARD IS WAITING ON — one sentence, on every collapsed job card.
 *
 * Owner, 2026-09-19, looking at the collapsed cards on /my-posts:
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
}

/** A row of the copy tables. `eyebrow`/`tone` override the bucket's own. */
interface WaitCopy {
  detail: string;
  eyebrow?: string;
  tone?: JobStatusTone;
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
  | "unfunded"
  | "in_review"
  | "applicants"
  | "listing_expired"
  | "no_applicants"
  | "offer_out"
  | "unconfirmed"
  | "confirmed"
  | "on_the_way"
  | "confirm_arrival"
  | "confirm_working"
  | "working"
  | "approve"
  | "revision_out"
  | "revision_fixed"
  | "stalled"
  | "overdue"
  | "dispute"
  | "dispute_escalated"
  | "done_paid"
  | "cancelled";

/**
 * The poster's sentence for every state a collapsed /my-posts card can hold.
 *
 * Written from the POSTER's point of view — the same job says something
 * different on the other tab (see HELPER_WAIT). The owner's own example, "now
 * you need to confirm", is this table's `confirm_arrival`.
 */
export const POSTER_WAIT: Record<PosterWait, WaitCopy> = {
  /* THE BUCKET DOES NOT KNOW ABOUT MONEY. An unfunded job is `open` with no
     applicants, which buckets to Waiting — but nobody can see it and the one
     move that exists is the poster's. Finding #1. */
  unfunded: { detail: "Finish paying to post it", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  in_review: { detail: "We're checking this post" },
  applicants: { detail: "Applicants are waiting" },
  listing_expired: { detail: "The listing has expired" },
  no_applicants: { detail: "No applicants yet" },
  offer_out: { detail: "Your offer is with them" },
  unconfirmed: { detail: "They haven't confirmed" },
  confirmed: { detail: "Booked and confirmed" },
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
  confirm_working: { detail: "Confirm they're working", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  /* FINDING #2 again, same rule, later step. */
  working: { detail: "Work is underway", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  approve: { detail: "Approve & release pay" },
  /* FINDING #3: `postedActivityBucket` returns Needs You for EVERY
     `revision_requested` job, including the half of it where the poster has
     already asked and the fix is out with the Helpr — which `workIsBackWithHelper`
     (the bucket's own predicate, two functions away) answers correctly and the
     bucket never consults. */
  revision_out: { detail: "They're making the fix", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  revision_fixed: { detail: "Check their fix" },
  stalled: { detail: "Nobody marked it done" },
  overdue: { detail: "The day has passed" },
  /* THE OLD `DisputeOpenBadge`, VERBATIM — the words, the tone and the
     consequence line are unchanged, because this strip IS that badge
     generalised (owner: "similar to how dispute open displays"). The eyebrow
     overrides the bucket's "Needs You" because "Needs you · Payment on hold"
     loses the one word that matters. */
  dispute: { detail: "Payment on hold", eyebrow: "Dispute open", tone: "alarm" },
  dispute_escalated: { detail: "Payment on hold", eyebrow: "Admin reviewing", tone: "alarm" },
  done_paid: { detail: "Paid and closed" },
  cancelled: { detail: "This job didn't happen" },
};

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
): PosterWait {
  switch (job.status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "done_paid";
    case "disputed":
      return (job as { dispute_status?: string | null }).dispute_status === "escalated"
        ? "dispute_escalated"
        : "dispute";
    case "pending_approval":
      return "in_review";
    case "open":
      /* An unfunded job is invisible to every Helpr while this card looks
         entirely normal — so it outranks everything else an open card could
         say, including its own applicant count. Same rule and same predicate as
         the expanded card's UnfundedJobNotice. */
      if (shouldShowUnfundedNotice(job)) return "unfunded";
      if (job.direct_offer_status === "pending") return "offer_out";
      if (jobIsOverdue(job)) return "overdue";
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
      if (rung?.enabled) return rung.action === "working" ? "confirm_working" : "confirm_arrival";
      if (jobIsOverdue(job)) return "overdue";
      if (job.status === "accepted" && !job.helper_confirmed_at) return "unconfirmed";
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      if (job.status === "in_progress") return "working";
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
): JobStatusLine {
  const id = derivePosterWait(job, pendingApplicantCount, now);
  const copy = POSTER_WAIT[id];
  const bucket = postedActivityBucket(job, pendingApplicantCount, now);
  return {
    id,
    eyebrow: copy.eyebrow ?? BUCKET_LABEL[bucket],
    detail: copy.detail,
    tone: copy.tone ?? BUCKET_TONE[bucket],
    owesConfirmation: id === "confirm_arrival" || id === "confirm_working",
  };
}

/* ═══════════════════════════ THE HELPER'S SIDE ═══════════════════════════ */

export type HelperWait =
  | "job_gone"
  | "not_selected"
  | "cancelled"
  | "applied"
  | "offer"
  | "confirm_booking"
  | "confirmed"
  | "today"
  | "on_the_way"
  | "working"
  | "submitted"
  | "revision"
  | "revision_sent"
  | "overdue"
  | "dispute"
  | "dispute_escalated"
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
  cancelled: { detail: "This job didn't happen" },
  applied: { detail: "They haven't replied yet" },
  offer: { detail: "Accept or decline it" },
  confirm_booking: { detail: "Confirm you'll be there" },
  confirmed: { detail: "You're confirmed" },
  today: { detail: "The job is today" },
  /* FINDING #5 on the Helpr's side. `appliedActivityBucket` lifts only TODAY's
     work into Needs You, so a job started a day early reads "Scheduled ·
     You're on the way" / "Scheduled · Finish and mark it done" — a commitment
     word over the two things a Helpr is mid-way through doing. Both are
     unambiguously theirs to finish whatever the calendar says. */
  on_the_way: { detail: "You're on the way", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  working: { detail: "Finish and mark it done", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
  submitted: { detail: "With them for approval" },
  revision: { detail: "They asked for a fix" },
  /* FINDING #4, the helper's half of finding #3: `appliedActivityBucket`
     returns Needs You for `revision_requested` unconditionally, so a Helpr who
     has already resubmitted is told they still owe something. */
  revision_sent: { detail: "Your fix is with them", eyebrow: BUCKET_LABEL.waiting, tone: "them" },
  overdue: { detail: "The day has passed" },
  dispute: { detail: "Payment on hold", eyebrow: "Dispute open", tone: "alarm" },
  dispute_escalated: { detail: "Payment on hold", eyebrow: "Admin reviewing", tone: "alarm" },
  done_paid: { detail: "Paid out" },
};

/**
 * Which sentence a job I APPLIED TO is owed.
 *
 * Same precedence as `appliedActivityBucket`, including its first rule: NO JOB
 * ROW MEANS THE JOB IS GONE, not "still waiting on a decision".
 */
export function deriveHelperWait(app: AppliedApp): HelperWait {
  const job = app.job;
  if (!job) return "job_gone";
  if (app.status === "rejected") return "not_selected";

  switch (job.status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "done_paid";
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
      if (jobIsOverdue(job)) return "overdue";
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      return "working";
    case "open":
    case "accepted": {
      // A pending DIRECT OFFER, or an accepted application the Helpr has not
      // said yes to: the two states where the job is being HELD for them and
      // lapses if they do nothing. `needsHelperResponse` is the bucket's own
      // rule; this splits its two halves because the words differ.
      if (job.direct_offer_status === "pending" && job.offered_to_helper_id === app.helper_id) {
        return "offer";
      }
      if (app.status !== "accepted") return "applied";
      if (!job.helper_confirmed_at) return "confirm_booking";
      if (jobIsOverdue(job)) return "overdue";
      if (job.helper_on_the_way_at && !job.helper_arrived_at) return "on_the_way";
      if (appliedActivityBucket(app) === "needs_you") return "today";
      return "confirmed";
    }
    default:
      return assertNever(job.status);
  }
}

export function helperStatusLine(app: AppliedApp): JobStatusLine {
  const id = deriveHelperWait(app);
  const copy = HELPER_WAIT[id];
  const bucket = appliedActivityBucket(app);
  return {
    id,
    eyebrow: copy.eyebrow ?? BUCKET_LABEL[bucket],
    detail: copy.detail,
    tone: copy.tone ?? BUCKET_TONE[bucket],
    owesConfirmation: id === "confirm_booking",
  };
}

/** Every id both tables define — the inventory the guard measures against. */
export const POSTER_WAIT_IDS = Object.keys(POSTER_WAIT) as PosterWait[];
export const HELPER_WAIT_IDS = Object.keys(HELPER_WAIT) as HelperWait[];
