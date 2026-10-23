/**
 * ONE job tracker (owner, 2026-10-21: "we need 1 tracker"). Chat, the job page and both job cards drew three
 * different trackers for the same job (4 bars twice, an 8-icon stepper on the card). Every job-progress render
 * now goes through `jobProgress` (this file) and `<JobProgress>` (src/components/tracker/JobProgress.tsx):
 * EIGHT steps (owner, 2026-10-22): Posted · Offered · Hired · Confirmed · On the way · Arrived · Working · Done,
 * the current one flagged `waitingOnYou` when the next move is the viewer's (accept the offer, confirm the day,
 * set out, confirm arrival, mark it done, check the work), and ONE exact "next step" line from the same rules
 * the card's primary follows (the day-before confirm window and its deadline, on the way, arrived, marked done).
 * Guard: src/test/oneJobTracker.test.ts.
 */
import { confirmDeadlineMs, confirmOpensMs, jobDayStart } from "@/lib/jobDate";
import { jobStartDateTime } from "@/lib/dateUtils";
import { helperStatusLine, posterStatusLine, type HelperWait, type PosterWait } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { cardBar, type CardFace, type Stage, type StepTone } from "@/lib/jobStepFromWait";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";

export type { Stage, StepTone } from "@/lib/jobStepFromWait";

export const JOB_PROGRESS_STEPS = ["Posted", "Offered", "Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"] as const;
/** The same steps in a word that fits eight across a 375px card (phone); the full names show from 640px. */
export const JOB_PROGRESS_SHORT = ["Post", "Offer", "Hired", "Conf.", "Way", "Arr.", "Work", "Done"] as const;

export type ProgressJob = {
  status: string | null;
  helper_id: string | null;
  payment_status?: string | null;
  date_needed?: string | null;
  start_time?: string | null;
  helper_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  has_active_dispute?: boolean | null;
  /** What the Helpr's card line reads past arrival (photo asks): the open card's tracker passes them too. */
  id?: string | null;
  require_photo_proof?: boolean | null;
  proof_before_urls?: string[] | null;
  proof_after_urls?: string[] | null;
};

export type JobProgressState = {
  /** Index into JOB_PROGRESS_STEPS of the CURRENT step (0..7; the ones before it are done), 8 when every step
   *  is done; null = off the path (cancelled, under review, not picked). */
  stage: Stage | null;
  /** The current step waits on the viewer (yellow); false = on the other person or the clock (olive). */
  waitingOnYou: boolean;
  /** "progress" (green / yellow / olive), "problem" (no-show, overdue, dispute: warning colour + alert icon),
   *  "cancelled" (all grey). From the card's own state id (src/lib/jobStepFromWait.ts). */
  tone: StepTone;
  /** The current step's word when it is not the step's own name ("No-show?", "Dispute", "Cancelled"). */
  label?: string;
  /** The bold word for the state ("Hired", "Cancelled", ...). */
  word: string;
  /** What happens next, in the viewer's words; "" when nothing is pending. */
  next: string;
  /** True only while the job's payment is held (payment_status 'escrow'). */
  held: boolean;
  /**
   * When each step happened, by index into JOB_PROGRESS_STEPS, for the full tracker's tap/hover time on a done
   * step (the old rail's tooltips, kept: owner 2026-10-23). The old rail's stamps exactly: Hired = the Helpr's
   * accept, Confirmed = the poster's confirm, On the way, Arrived (claim, else geofence, else the poster's
   * confirm), Done (the Helpr's, else the poster's). Posted, Offered and Working have no single stamp: no time.
   */
  stamps?: readonly (string | null)[];
};

const at = (stage: Stage | null, waitingOnYou: boolean, word: string, next: string, held: boolean): JobProgressState => ({ stage, waitingOnYou, tone: "progress", word, next, held });

/** Statuses the card's rule knows (job_status, minus nothing): anything else keeps the line's own answer. */
const CARD_STATUSES = new Set(["open", "accepted", "in_progress", "revision_requested", "completed", "cancelled", "disputed", "pending_approval"]);

const LIVE = new Set(["accepted", "in_progress", "revision_requested"]);

/** "Wed 9:00 AM" in Louisiana time. */
function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** The job's slot in Louisiana time: "Thu 9:00 AM", or the weekday alone when it has no start time. */
export function slotLabel(dateNeeded: string | null | undefined, startTime: string | null | undefined): string {
  if (!dateNeeded) return "";
  const start = startTime ? jobStartDateTime(dateNeeded, startTime) : null;
  if (start) return when(start.getTime());
  return jobDayStart(dateNeeded).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short" });
}

type ProgressOpts = {
    /** Who is looking: the poster, the Helpr on the job, or (chat) a Helpr in a thread. */
    viewer: "poster" | "helpr";
    /** The other person's first name; a neutral word is used when unknown. */
    otherFirst?: string | null;
    /** Chat only: the Helpr in this thread, so a job filled by someone else says so. */
    threadHelprId?: string | null;
    /** The thread Helpr's application status, when they have applied (chat, an open job). */
    application?: string | null;
    /** The date or time was moved by an accepted change (useJobRescheduled): both sides confirm the NEW slot. */
    rescheduled?: boolean;
    now?: Date;
    /** The open card's own progress (JobTracking: work underway, the tracking row), so its tracker reads the same
     *  Helpr line and button as the collapsed card (helperCardLine / helperFaceNextStep). */
    workUnderway?: boolean;
    tracking?: { status?: string | null } | null;
    /** A job CARD passes its own status line and face button (computed once, the same objects it draws), so
     *  its bar is read from exactly what it shows. Elsewhere (chat, job page, Home) they are derived here with
     *  the same functions. */
    card?: CardFace;
};

/**
 * THE tracker state for a job. The words (`word`, `next`) come from the rules below; the bar's current step, whose
 * move it is and its tone come from the CARD'S OWN state id (posterStatusLine / helperStatusLine, mapped by
 * src/lib/jobStepFromWait.ts), so the bar and the card's sentence and button can never disagree.
 */
/** When each of the eight steps happened (see JobProgressState.stamps). */
function stepStamps(j: ProgressJob): readonly (string | null)[] {
  return [
    null,
    null,
    j.helper_confirmed_at ?? null,
    j.poster_confirmed_at ?? null,
    j.helper_on_the_way_at ?? null,
    j.helper_arrived_at ?? j.helper_arrival_verified_at ?? j.poster_confirmed_arrival_at ?? null,
    null,
    j.helper_completed_at ?? j.poster_completed_at ?? null,
  ];
}

export function jobProgress(job: ProgressJob, o: ProgressOpts): JobProgressState {
  const base = { ...lineRules(job, o), stamps: stepStamps(job) };
  // Chat-only thread states the card never shows: another Helpr was hired, or this one was not picked.
  if (base.word === "Filled" || base.word === "Not picked") return base;
  // A dispute flag the status column does not carry: the warning step, never a progress colour.
  if (base.word === "Under review") return { ...base, stage: 7, waitingOnYou: false, tone: "problem", label: "Dispute" };
  const now = o.now ?? new Date();
  const card = o.card ?? cardFaceFor(job, o, now);
  const bar = card ? cardBar(o.viewer, card, job, now.getTime()) : null;
  if (!card || !bar) return base.word === "Cancelled" ? { ...base, stage: 0, waitingOnYou: false, tone: "cancelled", label: "Cancelled" } : base;
  if (bar.stage === null) return { ...base, stage: null, waitingOnYou: false };
  // The tracker's own sentence is kept only where it describes the step the card is on; otherwise the line under
  // the bar is the card's own sentence, so the job page's bar and line can never disagree either.
  const sameStep = bar.tone === "progress" && base.stage === bar.stage && base.waitingOnYou === bar.waitingOnYou;
  const offPath = bar.tone === "cancelled" || (bar.label === "Dispute" && base.word === "Under review");
  return {
    ...base,
    stage: bar.stage,
    waitingOnYou: bar.waitingOnYou,
    tone: bar.tone,
    ...(bar.label ? { label: bar.label } : {}),
    word: sameStep || offPath ? base.word : bar.label ?? ((JOB_PROGRESS_STEPS as readonly string[])[bar.stage] ?? "Done"),
    next: sameStep || offPath ? base.next : card.line.detail,
  };
}

/** The card's line and face for a surface that is not a card, from the same functions the cards call. */
function cardFaceFor(job: ProgressJob, o: ProgressOpts, now: Date): CardFace | null {
  const row = job as unknown as Job;
  // Only the statuses the card's rule knows (anything else would hit its assertNever): the rest keep the line.
  if (!CARD_STATUSES.has(job.status ?? "")) return null;
  if (o.viewer === "poster") {
    const line = posterStatusLine(row, o.application === "pending" ? 1 : 0, now, undefined, false, o.otherFirst ?? null);
    const noop = () => {};
    const face = posterFaceAction(line.id as PosterWait, row, {
      pendingApplicants: o.application === "pending" ? 1 : 0, helperName: o.otherFirst ?? "", confirmingArrival: false, completing: false,
      openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop, manage: noop,
    });
    return { line, face };
  }
  const line = helperStatusLine({
    // A synthetic application: the card reads only these (a real direct-offer card id is "direct-<job id>").
    id: "progress",
    job: row,
    helper_id: o.threadHelprId ?? job.helper_id,
    status: o.application ?? (job.helper_id ? "accepted" : "pending"),
    closed_reason: null,
    posterName: o.otherFirst ?? null,
  } as unknown as AppliedApp, false, o.workUnderway === undefined ? undefined : { workUnderway: o.workUnderway });
  const step = helperFaceNextStep({ ...row, id: row.id ?? "progress" }, (o.tracking ?? null) as Parameters<typeof helperFaceNextStep>[1], line.id as HelperWait);
  return { line, face: step ? { tone: "primary", step: step.key } : null };
}

function lineRules(job: ProgressJob, o: ProgressOpts): JobProgressState {
  const poster = o.viewer === "poster";
  const other = (o.otherFirst ?? "").trim() || (poster ? "Your Helpr" : "The person who posted it");
  const otherLow = (o.otherFirst ?? "").trim() || (poster ? "your Helpr" : "the person who posted it");
  const held = job.payment_status === "escrow";
  const status = job.status ?? "";
  const now = (o.now ?? new Date()).getTime();

  if (status === "cancelled" || status === "expired") return at(null, false, "Cancelled", "This job was cancelled", held);
  if (job.has_active_dispute || status === "disputed") {
    return at(null, false, "Under review", "A real person at Helpr is looking at the problem. The money stays held", held);
  }

  if (status === "open" && !job.helper_id) {
    // An applicant waiting on the poster's pick is the poster's move.
    if (o.application === "pending") return at(0, poster, "Posted", poster ? `${other} applied` : `You applied. Waiting on ${otherLow}`, held);
    if (o.application === "rejected") return at(null, false, "Not picked", poster ? "You passed on this one" : "Not picked this time", false);
    return at(0, false, "Posted", poster ? "Pick your Helpr" : "Open for Helprs", held);
  }

  if (job.helper_id && o.threadHelprId && job.helper_id !== o.threadHelprId) {
    return at(0, false, "Filled", poster ? "You hired someone else" : `${other} hired someone else`, false);
  }

  if (status === "completed" || job.poster_completed_at) return at(8, false, "Done", "", held);
  if (!LIVE.has(status) || !job.helper_id) return at(null, false, "", "", held);

  // An offer is not a booking: until the Helpr accepts, nobody is hired.
  if (!job.helper_confirmed_at) {
    return at(1, !poster, "Offered", poster ? `Waiting on ${otherLow} to accept the offer` : `${other} offered you this job`, held);
  }

  // Marked done: the last step waits on the poster to check the work.
  if (job.helper_completed_at) {
    return at(7, poster, "Done", poster ? `${other} marked it done. Check the work and approve` : `You marked it done. Waiting on ${otherLow}`, held);
  }
  const working =
    status === "in_progress" &&
    !!(job.poster_confirmed_working_at || job.poster_confirmed_arrival_at || job.helper_arrival_verified_at);
  // "is working" only once the poster has vouched for it; arrival evidence alone says where they are, not what
  // they are doing (the Helpr's Start working is not on the job row; the card's line says when it comes).
  if (working) return at(6, !poster, "Working", poster ? (job.poster_confirmed_working_at ? `${other} is working` : `${other} is at the job`) : "Mark it done when you finish", held);
  if (job.helper_arrived_at) {
    return at(5, poster, "Arrived", poster ? `${other} arrived. Confirm they've arrived` : `You've arrived. Waiting on ${otherLow} to confirm`, held);
  }
  if (job.helper_on_the_way_at) return at(4, !poster, "On the way", poster ? `${other} is on the way` : "You're on the way", held);

  // Booked, before setting out: the day-before confirm (the server's rule, _shared/confirmDeadline.ts:
  // opens at midnight the day before, owed until 2 hours before the start).
  if (job.date_needed) {
    const opens = confirmOpensMs(job.date_needed);
    const due = confirmDeadlineMs(job.date_needed, job.start_time ?? null);
    // Moved by an accepted change (owner, 2026-10-21): the line names the NEW slot.
    const slot = o.rescheduled ? slotLabel(job.date_needed, job.start_time) : "";
    if (!Number.isNaN(opens) && now < opens) {
      const wait = poster ? `${other} confirms the day before. Opens ${when(opens)}` : `Confirm the day before. Opens ${when(opens)}`;
      return at(2, false, "Hired", slot ? `New time ${slot}. ${wait}` : wait, held);
    }
    const helprIn = !!job.helper_dayof_confirmed_at;
    const posterIn = !!job.poster_confirmed_at;
    // Confirmed is done only when BOTH have confirmed: the old rail's job_confirmed step lit on the mutual stamp
    // (deriveCurrentStatusIdx), kept (owner 2026-10-23: "all the steps i built ... back"). The Helpr may still set
    // out on their own tap (helper_mark_on_the_way never reads the poster's), so their card offers On my way.
    if (!helprIn || !posterIn) {
      const mine = poster ? !posterIn : !helprIn;
      if (slot) {
        return at(3, mine, "Confirmed", mine ? (poster ? `Confirm the new time, ${slot}` : `Confirm you'll be there ${slot}`) : `Waiting for ${otherLow} to confirm ${slot}`, held);
      }
      if (poster) {
        return at(3, mine, "Confirmed", !posterIn ? "Tap I'm still on to confirm" : `Waiting on ${otherLow} to confirm by ${when(due)}`, held);
      }
      return at(3, mine, "Confirmed", !helprIn ? `Confirm you'll be at the job by ${when(due)}` : `Waiting on ${otherLow} to confirm`, held);
    }
  }
  // Both confirmed: setting out is the Helpr's move.
  return at(4, !poster, "On the way", poster ? `You're both confirmed. ${other} taps On my way when they leave` : "Tap I'm on my way when you leave", held);
}
