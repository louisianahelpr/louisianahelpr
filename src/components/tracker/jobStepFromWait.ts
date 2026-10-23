/**
 * The tracker's current step, read from the CARD'S OWN RULE (lead review 2026-10-22: the bar said Working while
 * the card said "Hallie arrived — confirm it", and past-due no-shows drew a yellow "Confirmed"). Every job card
 * derives ONE state id per side (derivePosterWait / deriveHelperWait in src/components/job-card/jobStatusLine.ts);
 * its sentence, its whose-move tone and its one face button come from that id. The 8-step bar reads the same id
 * through these two tables (`cardBar`), so the bar, the sentence and the button can never disagree. Both tables
 * are exhaustive Records: a new state id is a build error until it is placed on the bar.
 *
 * tone: "progress" (green done / yellow yours / olive theirs), "problem" (a no-show, an overdue job, a dispute:
 * the step it got stuck on in the warning colour, with an alert icon and its own word), "cancelled" (all grey).
 * Guard: src/test/trackerAgreesWithCard.test.ts.
 */
import type { HelperWait, JobStatusTone, PosterWait } from "@/components/job-card/jobStatusLine";
import { confirmOpensMs } from "@/lib/jobDate";

export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StepTone = "progress" | "problem" | "cancelled";
interface WaitStep {
  /** Index of the current step in JOB_PROGRESS_STEPS (8 = all done); null = no bar (the line alone). */
  stage: Stage | null;
  tone: StepTone;
  /** The current step's word when it is not the step's own name ("No-show?", "Dispute", "Cancelled"). */
  label?: string;
}
type StampJob = {
  date_needed?: string | null;
  helper_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
};
type Entry = WaitStep | ((job: StampJob, nowMs: number) => WaitStep);

const at = (stage: Stage | null, tone: StepTone = "progress", label?: string): WaitStep => ({ stage, tone, ...(label ? { label } : {}) });
const DISPUTE = at(7, "problem", "Dispute");
const CANCELLED = at(0, "cancelled", "Cancelled");

/** The first step a past-due job never got past, from its own stamps: the problem marker sits THERE, so a step
 *  that never happened is never drawn green (an unconfirmed no-show is stuck on Confirmed, not past it). */
function stuck(job: StampJob): Stage {
  if (!job.helper_confirmed_at) return 1;
  if (job.date_needed && !(job.helper_dayof_confirmed_at && job.poster_confirmed_at)) return 3;
  if (!job.helper_on_the_way_at) return 4;
  if (!job.helper_arrived_at) return 5;
  return 6;
}
const NO_SHOW: Entry = (job) => at(stuck(job), "problem", "No-show?");
const OVERDUE: Entry = (job) => at(stuck(job), "problem", "Overdue");
const OVERDUE_AT = (stage: Stage): WaitStep => at(stage, "problem", "Overdue");

/** Booked and accepted: Hired until the day-before window opens, then Confirmed until BOTH are in (the old rail's
 *  job_confirmed step lit on the mutual stamp, kept), then On the way. */
function booked(job: StampJob, nowMs: number): WaitStep {
  const opens = job.date_needed ? confirmOpensMs(job.date_needed) : NaN;
  if (!Number.isNaN(opens) && nowMs < opens) return at(2);
  if (job.date_needed && !(job.helper_dayof_confirmed_at && job.poster_confirmed_at)) return at(3);
  return at(4);
}

/** The bar steps a Helpr's tracker button moves (helperFaceNextStep's keys). "I'm on my way" is offered on the
 *  Helpr's own confirm, before the poster's (helper_mark_on_the_way never reads it): on Confirmed it is an early
 *  step, not the current one, so Confirmed stays the poster's (olive). */
const FACE_STEP_STAGES: Record<string, readonly number[]> = { on_the_way: [4], arrived: [4, 5], working: [5, 6], done: [6], before_photo: [5], after_photo: [6] };

export const POSTER_STEP: Record<PosterWait, Entry> = {
  in_review: at(0),
  applicants: at(0),
  listing_expired: at(0, "problem", "Expired"),
  no_applicants: at(0),
  offer_out: at(1),
  unconfirmed: at(1),
  confirmed: booked,
  confirm_still_on: at(3),
  on_the_way: at(4),
  confirm_arrival: at(5),
  working: at(6),
  approve: at(7),
  revision_out: at(6),
  revision_fixed: at(7),
  stalled: OVERDUE_AT(6),
  overdue_unhired: OVERDUE_AT(0),
  overdue_unconfirmed: OVERDUE,
  overdue_not_started: NO_SHOW,
  overdue_not_arrived: NO_SHOW,
  overdue_no_show: NO_SHOW,
  overdue_unfinished: OVERDUE_AT(6),
  dispute: DISPUTE,
  dispute_escalated: DISPUTE,
  dispute_settling: DISPUTE,
  bank_dispute: at(null),
  payment_failed: at(null),
  done_payout_pending: at(8),
  done_refunded: at(0, "cancelled", "Refunded"),
  done_paid: at(8),
  done_tip_open: at(8),
  done_review_open: at(8),
  done_both_open: at(8),
  cancelled: CANCELLED,
};

export const HELPER_STEP: Record<HelperWait, Entry> = {
  job_gone: at(null),
  not_selected: at(null),
  cancelled: CANCELLED,
  applied: at(0),
  offer: at(1),
  offer_expired: at(1, "problem", "Expired"),
  confirm_booking: at(1),
  confirm_spot: at(1),
  confirmed: booked,
  confirm_day: at(3),
  today: at(4),
  on_the_way: at(4),
  before_photo: at(5),
  arrival_unconfirmed: at(5),
  start_working: at(6),
  after_photo: at(6),
  working: at(6),
  submitted: at(7),
  revision: at(6),
  revision_sent: at(7),
  overdue_not_started: OVERDUE,
  overdue_unconfirmed_day: OVERDUE,
  overdue_not_arrived: OVERDUE,
  overdue_unfinished: OVERDUE,
  overdue_before_photo: OVERDUE_AT(5),
  overdue_start_working: OVERDUE_AT(6),
  overdue_arrival_unconfirmed: OVERDUE_AT(5),
  overdue_after_photo: OVERDUE_AT(6),
  dispute: DISPUTE,
  dispute_escalated: DISPUTE,
  dispute_settling: DISPUTE,
  bank_dispute: at(null),
  payment_failed: at(null),
  done_payout_pending: at(8),
  done_refunded: at(0, "cancelled", "Refunded"),
  done_paid: at(8),
};

function stepForWait(entry: Entry, job: StampJob, nowMs: number): WaitStep {
  return typeof entry === "function" ? entry(job, nowMs) : entry;
}

/** What the card itself shows: its status line (id + whose-move tone) and its one face button. */
export interface CardFace {
  line: { id: string; tone: JobStatusTone; detail: string };
  /** The face's one button; "primary" = a real next step the viewer can take now. Null = no button. */
  face?: { tone: "primary" | "secondary"; step?: string } | null;
}

interface CardBar extends WaitStep {
  /** The current step is the viewer's move: the card's line says "you", or its one button takes THIS step. */
  waitingOnYou: boolean;
}

/** The card's button is a real step on the bar's current step (a Helpr's early On my way is not). */
function faceTakesStep(face: CardFace["face"], stage: number): boolean {
  if (face?.tone !== "primary") return false;
  return face.step ? (FACE_STEP_STAGES[face.step] ?? []).includes(stage) : true;
}

/**
 * THE bar for a card, from the card's own line and button. Null when the id is not one this side knows
 * (the caller keeps its own answer).
 */
export function cardBar(side: "poster" | "helpr", card: CardFace, job: StampJob, nowMs: number): CardBar | null {
  const entry = side === "poster" ? POSTER_STEP[card.line.id as PosterWait] : HELPER_STEP[card.line.id as HelperWait];
  if (!entry) return null;
  const step = stepForWait(entry, job, nowMs);
  const live = step.tone === "progress" && step.stage !== null && step.stage < 8;
  return { ...step, waitingOnYou: live && (card.line.tone === "you" || faceTakesStep(card.face, step.stage ?? -1)) };
}
