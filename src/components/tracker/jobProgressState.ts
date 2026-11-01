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
import { confirmDeadlineMs, confirmOpensMs, jobDayStart, posterConfirmClosesMs } from "@/lib/jobDate";
import { EXPIRED_WORD, jobStartDateTime } from "@/lib/dateUtils";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import { JOB_STATUS_LABELS } from "@/lib/statusLabels";
import { EXPIRED_LISTING_DETAIL, autoCompleteAt, helperStatusLine, sanitizeCancellationReason, posterStatusLine, type HelperWait, type PosterWait } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { cardBar, type CardFace, type Stage, type StepTone } from "@/components/tracker/jobStepFromWait";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { HELPR_NOT_STARTED, workHasBegun } from "@/components/tracker/workHasBegun";
import { isExpiredListing } from "@/lib/expiredListing";

export type { Stage, StepTone } from "@/components/tracker/jobStepFromWait";

export const JOB_PROGRESS_STEPS = ["Posted", "Offered", "Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"] as const;
/** The same steps in a word that fits eight across a 375px card (phone); the full names show from a 368px tracker. */
export const JOB_PROGRESS_SHORT = ["Post", "Offer", "Hired", "Conf.", "Way", "Arr.", "Work", "Done"] as const;
/**
 * The full names as the tracker DRAWS them: each long word carries a soft hyphen (U+00AD, invisible unless the word
 * breaks there), so in a 368-639px tracker (/payment-success and the job page's side panel at 1440: 382 and ~420px) a
 * name too wide for its column breaks onto a second line ("Con-" / "firmed") instead of showing "Conf." (audit
 * 2026-10-29 A2-L15). Measured in Montserrat 11px: the widest piece is "On the" at 38.1px; a 368px tracker's narrowest
 * column is (368 - 7 x 4) / 8.5 = 40px. The accessible names keep JOB_PROGRESS_STEPS. Guard: src/test/trackerFullWordsFromMidWidth.test.tsx.
 */
export const JOB_PROGRESS_DRAWN = ["Post\u00ADed", "Of\u00ADfered", "Hired", "Con\u00ADfirmed", "On the way", "Ar\u00ADrived", "Work\u00ADing", "Done"] as const;

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
  /** When the job was done (the server's stamp); the finished line's time (JA-11). */
  completed_at?: string | null;
  has_active_dispute?: boolean | null;
  /** isExpiredListing reads these: an auto-expired listing is never shown as cancelled (JA-23). */
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
  /** Who posted it and when it was cancelled: the cancelled line says who and when (JA-26). */
  customer_id?: string | null;
  cancelled_at?: string | null;
  /** A crew job: its helper_id is null (the members are on group_job_helpers), so "hired" is read from the status. */
  is_group_job?: boolean | null;
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
   *  "cancelled" (all grey). From the card's own state id (src/components/tracker/jobStepFromWait.ts). */
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
  /**
   * HAS THE CURRENT STEP BEGUN (owner, 2026-10-31: "it should be white right now while we wait"; yellow "until he
   * is actually on the way" while it happens). Set only on On the way, Arrived and Working while the job is on its
   * path: false = the step has not started yet (both confirmed, not set out; arrived, not started working), drawn
   * WHITE like a later step but still marked (the hand / hourglass and the bold word); true = the step is happening
   * (helper_on_the_way_at, an arrival on the row, work underway), drawn the app's bright yellow. Undefined (every
   * other step) keeps the amber "you are here". Read from the job row and the card's own line, never the base rules.
   * Guard: src/test/trackerStepWhiteUntilBegun.test.tsx.
   */
  begun?: boolean;
};

const at = (stage: Stage | null, waitingOnYou: boolean, word: string, next: string, held: boolean): JobProgressState => ({ stage, waitingOnYou, tone: "progress", word, next, held });

/** Statuses the card's rule knows (every job_status, derived from the exhaustive label record): anything else keeps the line's own answer. */
const CARD_STATUSES = new Set<string>(Object.keys(JOB_STATUS_LABELS));

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
    /** Poster, an open job: how many applicants wait on their pick, when the surface knows (the job page). 0 = nobody
     *  has applied yet, so the line says it is waiting for applicants, not "Pick your Helpr" (audit 2026-10-28 A2-C30). */
    pendingApplicants?: number;
    /** The viewer is on this crew job's roster (the job page's own read): their spot confirmed or not (JA-33). */
    crewMember?: { confirmed: boolean };
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
 * src/components/tracker/jobStepFromWait.ts), so the bar and the card's sentence and button can never disagree.
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
  // An expired listing is greyed like a cancel but named for what it is (JA-23).
  if (isExpiredListing(job)) return { ...base, stage: 0, waitingOnYou: false, tone: "cancelled", label: base.word };
  // JA-33 (audit 11-01): a crew member's own spot, never "<Name> offered you this job" once they confirmed it.
  if (o.viewer === "helpr" && o.crewMember && job.is_group_job === true && job.status === "accepted" && !job.helper_confirmed_at) {
    return o.crewMember.confirmed
      ? { ...base, stage: 2, waitingOnYou: false, tone: "progress", word: "Hired", next: "You're on the crew. Your spot is confirmed" }
      : { ...base, stage: 1, waitingOnYou: true, tone: "progress", word: "Offered", next: "Confirm your spot on the crew" };
  }
  // JA-32: the crew's own line (the card's single-Helpr rule would read "accept the offer").
  if (o.viewer === "poster" && crewBookedOnRow(job) && base.word === "Hired") return base;
  if (base.word === "Under review") return { ...base, stage: 7, waitingOnYou: false, tone: "problem", label: "Dispute" };
  const now = o.now ?? new Date();
  const card = o.card ?? cardFaceFor(job, o, now);
  const bar = card ? cardBar(o.viewer, card, job, now.getTime()) : null;
  if (!card || !bar) return base.word === "Cancelled" ? { ...base, stage: 0, waitingOnYou: false, tone: "cancelled", label: "Cancelled" } : withBegun(base, job, null, o.workUnderway);
  if (bar.stage === null) return { ...base, stage: null, waitingOnYou: false };
  // The tracker's own sentence is kept only where it describes the step the card is on; otherwise the line under
  // the bar is the card's own sentence, so the job page's bar and line can never disagree either.
  const sameStep = bar.tone === "progress" && base.stage === bar.stage && base.waitingOnYou === bar.waitingOnYou;
  // JA-2 (audit 11-01): with nobody applied, the page's own "No applicants yet" block says so; the tracker line is
  // "Waiting for Helprs to apply", never the card's "No applicants yet" a second time right above it.
  const noApplicantsYet = o.viewer === "poster" && o.pendingApplicants === 0 && base.stage === 0 && bar.stage === 0 && bar.tone === "progress";
  const posterLate = o.viewer === "poster" && bar.tone === "progress" && bar.stage === 4 && base.stage === 4 && !!minutesLate(job, now.getTime());
  const offPath = bar.tone === "cancelled" || (bar.label === "Dispute" && base.word === "Under review");
  return withBegun({
    ...base,
    stage: bar.stage,
    waitingOnYou: bar.waitingOnYou,
    tone: bar.tone,
    ...(bar.label ? { label: bar.label } : {}),
    word: sameStep || offPath ? base.word : bar.label ?? ((JOB_PROGRESS_STEPS as readonly string[])[bar.stage] ?? "Done"),
    // JOBS3-48: arrived and not started, the Helpr's bar is on Working, but the line is the card's ("Tap Start working"), never "Mark it done".
    // JA-12 / JA-13: the poster's late line wins over the card's calm one while the bar is on On the way.
    // Owner 11-01 (job 7b1da54b): after photos in, not marked done: the base's line says so, unless the card owes the
    // poster a step first (confirm the arrival) or the Helpr is waiting on one.
    next: (/after photos/.test(base.next) && bar.stage === 6 && bar.waitingOnYou === (o.viewer !== "poster")) || posterLate || noApplicantsYet || ((sameStep || offPath) && !HELPR_NOT_STARTED.has(card.line.id)) ? base.next : card.line.detail,
  }, job, card.line.id, o.workUnderway);
}

/**
 * JobProgressState.begun for the FINAL stage (owner 2026-10-31: white while waiting, yellow while it happens).
 * On the way begins when the Helpr taps On my way; Arrived when an arrival is on the row (their tap, the geofence,
 * or the poster's confirm); Working once the job is in progress past arrival, except while the Helpr's own card
 * still says Start working / take the before photo (JOBS3-48: the bar sits on Working before work starts), or while
 * the surface's tracking row says work has not started (`workUnderway` false: the job page and the open card pass
 * helperProgress, where the Helpr's own tracking row wins over the poster's arrival confirm).
 */
function withBegun(p: JobProgressState, job: ProgressJob, lineId: string | null, workUnderway?: boolean): JobProgressState {
  if (p.tone !== "progress" || p.stage === null || p.stage < 4 || p.stage > 6) return p;
  const begun =
    p.stage === 4 ? !!job.helper_on_the_way_at
    : p.stage === 5 ? !!(job.helper_arrived_at || job.helper_arrival_verified_at || job.poster_confirmed_arrival_at)
    : workHasBegun(job, { workUnderway, lineId });
  return { ...p, begun };
}

/**
 * Someone is hired on this job. A one-Helpr job says so in helper_id; a crew job never does (helper_id stays null,
 * the roster is group_job_helpers), and leaves `open` only once its crew is hired, so its status says it (audit
 * 2026-10-28 A2-B8: a booked crew read "Posted · They haven't replied yet"). Guard: src/test/crewTrackerCountsTheRoster.test.ts.
 */
function someoneHired(job: ProgressJob): boolean {
  return !!job.helper_id || (job.is_group_job === true && !!job.status && job.status !== "open");
}

/** A crew job whose roster is hired (status 'accepted') and whose job row has no single Helpr's accept (JA-32). */
function crewBookedOnRow(job: ProgressJob): boolean {
  return job.is_group_job === true && job.status === "accepted" && !job.helper_id && !job.helper_confirmed_at;
}

/** Grace after the start before a Helpr not yet there reads as late (JA-12). */
const LATE_GRACE_MIN = 10;

/** "75 min" / "1 h 20 min" past the job's start when that is more than the grace, else null (no start time: null). */
function minutesLate(job: ProgressJob, nowMs: number): string | null {
  const start = jobStartDateTime(job.date_needed ?? null, job.start_time ?? null);
  if (!start || job.helper_arrived_at) return null;
  const mins = Math.floor((nowMs - start.getTime()) / 60_000);
  if (mins <= LATE_GRACE_MIN) return null;
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}

/** The card's line and face for a surface that is not a card, from the same functions the cards call. */
function cardFaceFor(job: ProgressJob, o: ProgressOpts, now: Date): CardFace | null {
  const row = job as unknown as Job;
  // Only the statuses the card's rule knows (anything else would hit its assertNever): the rest keep the line.
  if (!CARD_STATUSES.has(job.status ?? "")) return null;
  if (o.viewer === "poster") {
    // JA-1 (audit 11-01): the job page knows how many applicants wait (pendingApplicants); chat knows only its thread's
    // one application. Reading only the thread's made the page say "No applicants yet" above "Review 2 applicants".
    const pending = o.pendingApplicants ?? (o.application === "pending" ? 1 : 0);
    const line = posterStatusLine(row, pending, now, undefined, false, o.otherFirst ?? null, o.workUnderway === undefined ? undefined : { workUnderway: o.workUnderway });
    const noop = () => {};
    const face = posterFaceAction(line.id as PosterWait, row, {
      pendingApplicants: pending, helperName: o.otherFirst ?? "", confirmingArrival: false, completing: false,
      openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop, manage: noop,
      confirm: noop, noShow: noop, cancel: noop, viewDispute: noop,
    });
    return { line, face };
  }
  const line = helperStatusLine({
    // A synthetic application: the card reads only these (a real direct-offer card id is "direct-<job id>").
    id: "progress",
    job: row,
    helper_id: o.threadHelprId ?? job.helper_id,
    status: o.application ?? (someoneHired(job) ? "accepted" : "pending"),
    closed_reason: null,
    posterName: o.otherFirst ?? null,
  } as unknown as AppliedApp, false, o.workUnderway === undefined ? undefined : { workUnderway: o.workUnderway });
  const step = helperFaceNextStep({ ...row, id: row.id ?? "progress" }, (o.tracking ?? null) as Parameters<typeof helperFaceNextStep>[1], line.id as HelperWait);
  return { line, face: step ? { tone: "primary", step: step.key } : null };
}

/**
 * JA-26 (audit 11-01): a cancelled job says who cancelled, when, why, and (to the poster) that the money came back:
 * "You cancelled Sat 9:00 AM · Plans changed · Your payment was refunded". Who is read from cancelled_by against the
 * job's two parties; anyone else (an admin, the system) is not named. The reason is the card's own sanitized one.
 */
function cancelledLine(job: ProgressJob, poster: boolean, other: string): string {
  const by = job.cancelled_by ?? null;
  const posterDid = !!by && by === job.customer_id;
  const helprDid = !!by && !!job.helper_id && by === job.helper_id;
  const atMs = Date.parse(job.cancelled_at ?? "");
  const stamp = Number.isNaN(atMs) ? "" : ` ${when(atMs)}`;
  const who = posterDid ? (poster ? `You cancelled${stamp}` : `${other} cancelled${stamp}`)
    : helprDid ? (poster ? `${other} cancelled${stamp}` : `You cancelled${stamp}`)
    : "This job was cancelled";
  const reason = sanitizeCancellationReason(job.cancellation_reason);
  const refund = poster && job.payment_status === "refunded" ? "Your payment was refunded" : null;
  return [who, reason, refund].filter(Boolean).join(" · ");
}

function lineRules(job: ProgressJob, o: ProgressOpts): JobProgressState {
  const poster = o.viewer === "poster";
  const other = (o.otherFirst ?? "").trim() || (poster ? "Your Helpr" : "The person who posted it");
  const otherLow = (o.otherFirst ?? "").trim() || (poster ? "your Helpr" : "the person who posted it");
  const held = job.payment_status === "escrow";
  const status = job.status ?? "";
  const now = (o.now ?? new Date()).getTime();

  // JA-23: expired is not cancelled (owner 10-31, src/lib/expiredListing.ts). The poster reads "Expired · No Helpr was
  // hired in time" (the card's own line); anyone else "Closed · No longer open". Never "Cancelled".
  if (isExpiredListing(job)) return at(null, false, poster ? EXPIRED_WORD : "Closed", poster ? EXPIRED_LISTING_DETAIL : "No longer open", held);
  if (status === "cancelled" || status === "expired") return at(null, false, "Cancelled", cancelledLine(job, poster, other), held);
  if (job.has_active_dispute || status === "disputed") {
    return at(null, false, "Under review", "A real person at Helpr is looking at the problem. The money stays held", held);
  }

  if (status === "open" && !job.helper_id) {
    // An applicant waiting on the poster's pick is the poster's move.
    if (o.application === "pending") return at(0, poster, "Posted", poster ? `${other} applied` : `You applied. Waiting on ${otherLow}`, held);
    if (o.application === "rejected") return at(null, false, "Not picked", poster ? "You passed on this one" : "Not picked this time", false);
    // JOBS-9: nobody can see a job that never got paid for, so it is not waiting for anyone.
    if (poster && jobIsUnfundedDraft(job)) return at(0, false, "Posted", "Waiting on your payment", false);
    // JA-1: applicants waiting are the poster's move (the card's bar says so too, from the same count).
    const picking = poster && (o.pendingApplicants ?? 0) > 0;
    return at(0, picking, "Posted", poster ? (o.pendingApplicants === 0 ? "Waiting for Helprs to apply" : "Pick your Helpr") : "Open for Helprs", held);
  }

  if (job.helper_id && o.threadHelprId && job.helper_id !== o.threadHelprId) {
    return at(0, false, "Filled", poster ? "You hired someone else" : `${other} hired someone else`, false);
  }

  // JA-11 (audit 11-01): a finished job's tracker says when it finished, never a blank line under eight full steps.
  if (status === "completed" || job.poster_completed_at) {
    const doneMs = Date.parse(job.poster_completed_at ?? job.completed_at ?? job.helper_completed_at ?? "");
    return at(8, false, "Done", Number.isNaN(doneMs) ? "Finished" : `Finished ${when(doneMs)}`, held);
  }
  if (!LIVE.has(status) || !someoneHired(job)) return at(null, false, "", "", held);

  // JA-32: a booked crew's job row carries no one Helpr's stamps (each member's are on their roster row), so it is
  // never "Waiting on your Helpr to accept the offer": the poster follows each member on the page's crew roster.
  if (poster && crewBookedOnRow(job)) return at(2, false, "Hired", "Your crew is booked. Each Helpr's step is under Your crew", held);
  // An offer is not a booking: until the Helpr accepts, nobody is hired.
  if (!job.helper_confirmed_at) {
    return at(1, !poster, "Offered", poster ? `Waiting on ${otherLow} to accept the offer` : `${other} offered you this job`, held);
  }

  // Marked done: the last step waits on the poster to check the work.
  if (job.helper_completed_at) {
    // JA-21 (audit 11-01): the Helpr is told until when the poster has to check (the card's own auto_complete clock).
    const checkBy = autoCompleteAt({ helper_completed_at: job.helper_completed_at });
    const helprLine = checkBy ? `You marked it done. ${other} has until ${when(Date.parse(checkBy))} to check it` : `You marked it done. Waiting on ${otherLow}`;
    return at(7, poster, "Done", poster ? `${other} marked it done. Check the work and approve` : helprLine, held);
  }
  // Owner 11-01 11:55 AM (job 7b1da54b): after photos are in but the Helpr has not marked it done. The page said
  // "Yusef is working"; it now says what it waits on, and the Helpr is told the one step left.
  // Guard: src/components/ui/NextStep.test.tsx ("after photos").
  if (status === "in_progress" && !job.is_group_job && (job.proof_after_urls ?? []).some(Boolean)) {
    return at(6, !poster, "Working", poster ? `${other} added after photos · waiting for them to mark it done` : "Your after photos are in. Mark it done", held);
  }
  const working =
    status === "in_progress" &&
    !!(job.poster_confirmed_working_at || job.poster_confirmed_arrival_at || job.helper_arrival_verified_at);
  // "is working" only once the poster has vouched for it; arrival evidence alone says where they are, not what
  // they are doing (the Helpr's Start working is not on the job row; the card's line says when it comes).
  // "is working" exactly when the bar's Working step has begun (workHasBegun, the same rule as JobProgressState.begun
  // and the poster's card line), so the line and the step colour can never disagree.
  if (working) return at(6, !poster, "Working", poster ? (workHasBegun(job, { workUnderway: o.workUnderway }) ? `${other} is working` : `${other} is at the job`) : "Mark it done when you finish", held);
  if (job.helper_arrived_at) {
    return at(5, poster, "Arrived", poster ? `${other} arrived. Confirm they've arrived` : `You've arrived. Waiting on ${otherLow} to confirm`, held);
  }
  // JA-12 / JA-13 (audit 11-01): past the start time the poster is told the Helpr is late, never only the calm line.
  const lateBy = minutesLate(job, now);
  if (job.helper_on_the_way_at) return at(4, !poster, "On the way", poster ? (lateBy ? `${other} is on the way, ${lateBy} late` : `${other} is on the way`) : "You're on the way", held);

  // Booked, before setting out: the day-before confirm (the server's rule, _shared/confirmDeadline.ts:
  // opens at midnight the day before, owed until 2 hours before the start).
  if (job.date_needed) {
    const opens = confirmOpensMs(job.date_needed);
    const due = confirmDeadlineMs(job.date_needed, job.start_time ?? null);
    // Moved by an accepted change (owner, 2026-10-21): the line names the NEW slot.
    const slot = o.rescheduled ? slotLabel(job.date_needed, job.start_time) : "";
    if (!Number.isNaN(opens) && now < opens) {
      // JA-5 (audit 11-01): the day, never "Opens Mon 12:00 AM" (a midnight time reads like a system stamp).
      const day = new Date(opens).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short" });
      const wait = poster ? `${other} confirms on ${day}, the day before` : `Confirm on ${day}, the day before`;
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
      // A2-C40: past the start the poster's "I'm still on" is gone (JobConfirmation, posterConfirmClosesMs), and
      // the auto-start sweep can take up to 15 minutes: say where things stand, never "tap" a button that isn't there.
      if (poster && !posterIn && now >= posterConfirmClosesMs(job.date_needed, job.start_time)) {
        return at(3, false, "Confirmed", helprIn ? `It's start time. ${other} confirmed they'll be there` : `It's start time. ${other} hasn't confirmed`, held);
      }
      if (poster) {
        return at(3, mine, "Confirmed", !posterIn ? "Confirm the job is still on" : `Waiting on ${otherLow} to confirm by ${when(due)}`, held);
      }
      return at(3, mine, "Confirmed", !helprIn ? `Confirm you'll be at the job by ${when(due)}` : `Waiting on ${otherLow} to confirm`, held);
    }
  }
  // Both confirmed: setting out is the Helpr's move. AUD31-76: once the start has passed (or auto_start_due_jobs has
  // moved the job to in_progress), the Helpr's line is the card's "today" line, not "when you leave".
  const startAt = jobStartDateTime(job.date_needed, job.start_time ?? null);
  const started = status === "in_progress" || (!!startAt && now >= startAt.getTime());
  return at(4, !poster, "On the way", poster ? (lateBy ? `${other} is ${lateBy} late and hasn't set out` : `You're both confirmed. ${other} taps On my way when they leave`) : started ? "It's time — tap I'm on my way" : "Tap I'm on my way when you leave", held);
}
