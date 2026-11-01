/**
 * THE BAR AND THE CARD NEVER DISAGREE (lead review 2026-10-22, ready/job-tracker-8 sent back twice over):
 *  (a) after-5-arrived-poster-1024: "SEED Repaint a porch railing" said "Hallie arrived — confirm it" with a
 *      Confirm arrival button while the 8-step bar said Working (jobProgress counted helper_arrival_verified_at
 *      alone as working; the card's ladder still owed the poster's arrival confirm);
 *  (b) past-due no-shows and never-confirmed jobs drew a yellow "Confirmed" under "Hallie never arrived — No-Show?".
 *
 * Now each card computes its status line ONCE (posterStatusLine / helperCardLine) and hands that line and its one
 * face button to the bar (jobProgress `card`), which places it through src/components/tracker/jobStepFromWait.ts. This walks
 * every journey state, both sides, through the REAL card functions (line, button, bar) and fails when:
 *  - the bar's step or look differs from the expected matrix below (the independent statement of truth);
 *  - the bar says "your move" while neither the line nor the button does, or the other way round;
 *  - a problem line (overdue, no-show, dispute, expired) gets a progress colour, or a calm line a problem look;
 *  - a primary button names a step other than the bar's current one;
 *  - the job page's bar (no card handed in) differs from the card's;
 *  - either card stops handing the bar its own line and button.
 *
 * @mutate src/components/tracker/jobStepFromWait.ts |   return { ...step, waitingOnYou: live && (card.line.tone === "you" \|\| faceTakesStep(card.face, step.stage ?? -1)) }; |   return { ...step, waitingOnYou: live };
 * @mutate src/components/tracker/jobStepFromWait.ts |   confirm_arrival: at(5), |   confirm_arrival: at(6),
 * @mutate src/components/tracker/jobStepFromWait.ts |   overdue_no_show: NO_SHOW, |   overdue_no_show: at(3),
 * @mutate src/components/tracker/jobStepFromWait.ts |   overdue_not_started: NO_SHOW, |   overdue_not_started: at(4),
 * @mutate src/components/tracker/jobStepFromWait.ts |   if (job.date_needed && !(job.helper_dayof_confirmed_at && job.poster_confirmed_at)) return 3; |
 * @mutate src/components/tracker/jobStepFromWait.ts |   return face.step ? (FACE_STEP_STAGES[face.step] ?? []).includes(stage) : true; |   return true;
 * @mutate src/components/tracker/jobProgressState.ts |   const card = o.card ?? cardFaceFor(job, o, now); |   const card = cardFaceFor(job, o, now);
 * @mutate src/components/tracker/jobProgressState.ts | \|\| posterLate \|\| noApplicantsYet \|\| ((sameStep \|\| offPath) && !HELPR_NOT_STARTED.has(card.line.id)) ? base.next : card.line.detail, | \|\| true ? base.next : card.line.detail,
 * @mutate src/pages/posts/PostedJobCard.tsx | rescheduled, card: { line: cardLine, face: faceAction }, pendingApplicants: | rescheduled, pendingApplicants:
 * @mutate src/pages/jobs/AppliedJobCard.tsx | otherFirst: posterFirst, card: { line: cardLine, face: faceAction } }) : null; | otherFirst: posterFirst }) : null;
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |   const started = wait ? WORK_UNDERWAY.has(wait) : tracking?.status === "working"; |   const started = tracking?.status === "working";
 * @mutate src/pages/jobs/appliedJobCard/HelperCollapsedStrip.tsx | line={withReviewed(helperCardLine(app, job, unsettledDisputeJobIds, tracking), reviewed)} | line={withReviewed(helperStatusLine(app), reviewed)}
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobProgress, type JobProgressState, type ProgressJob } from "@/components/tracker/jobProgressState";
import { HELPER_STEP, POSTER_STEP } from "@/components/tracker/jobStepFromWait";
import { HELPER_WAIT_IDS, POSTER_WAIT_IDS, posterStatusLine, type HelperWait, type PosterWait } from "@/components/job-card/jobStatusLine";
import { helperCardLine } from "@/pages/jobs/appliedJobCard/HelperCollapsedStrip";
import { helperFaceAction, helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import type { TrackingData } from "@/components/JobTracking";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { blankComments } from "@/test/helpers/blankNonCode";

const NOW = new Date("2037-10-21T15:00:00Z"); // Wed 10:00 AM in Louisiana; a Thu job's confirm window is open
const T = "2037-10-20T15:00:00Z";
const LATER = "2037-10-21T14:00:00Z";
const ME = "me";
const PAST = { date_needed: "2037-10-12", start_time: "10:00:00" };

const base = { id: "j", title: "Mow", status: "accepted", payment_status: "escrow", helper_id: ME, customer_id: "p", date_needed: "2037-10-22", start_time: "15:00:00", require_photo_proof: false };
const conf = { helper_confirmed_at: T };
const both = { ...conf, helper_dayof_confirmed_at: T, poster_confirmed_at: T };
const tr = (status: string): TrackingData => ({ id: "t", status, latitude: null, longitude: null, eta_minutes: null, updated_at: T }) as unknown as TrackingData;

type Mark = "you" | "them" | "problem" | "cancelled" | "done";
type Want = [stage: number | null, mark: Mark];
interface State {
  job: Record<string, unknown>;
  applicants?: number;
  tracking?: TrackingData | null;
  poster: Want;
  /** Absent: the Helpr is not on the job, their card draws no bar. */
  helpr?: Want;
}

/** EVERY JOURNEY STATE the cards show, with the bar each side must draw: the independent statement of truth. */
const STATES: Record<string, State> = {
  posted: { job: { status: "open", helper_id: null }, poster: [0, "them"] },
  posted_with_applicants: { job: { status: "open", helper_id: null }, applicants: 1, poster: [0, "you"] },
  offered: { job: {}, poster: [1, "them"], helpr: [1, "you"] },
  hired_before_window: { job: { ...conf, date_needed: "2037-11-12" }, poster: [2, "them"], helpr: [2, "them"] },
  confirm_window: { job: { ...conf }, poster: [3, "you"], helpr: [3, "you"] },
  poster_confirmed_only: { job: { ...conf, poster_confirmed_at: T }, poster: [3, "them"], helpr: [3, "you"] },
  // Confirmed lights on BOTH confirms (the old rail's rule, kept): the Helpr may already set out (their button is
  // "I'm on my way", helper_mark_on_the_way), but the Confirmed step itself waits on the poster.
  helpr_confirmed_only: { job: { ...conf, helper_dayof_confirmed_at: T }, poster: [3, "you"], helpr: [3, "them"] },
  // A day out the Helpr's face offers no "I'm on my way" yet (3 hours before the start, owner 2026-10-23).
  both_confirmed: { job: { ...both }, poster: [4, "them"], helpr: [4, "them"] },
  both_confirmed_soon: { job: { ...both, date_needed: "2037-10-21", start_time: "12:00:00" }, poster: [4, "them"], helpr: [4, "you"] },
  on_the_way: { job: { ...both, status: "in_progress", helper_on_the_way_at: T }, poster: [4, "them"], helpr: [4, "you"] },
  arrived_claimed: { job: { ...both, status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T }, tracking: tr("arrived"), poster: [5, "you"], helpr: [5, "them"] },
  // (a) the reported card: the geofence stamp alone is NOT working; the poster still owes the arrival confirm.
  arrived_verified_only: {
    job: { ...both, status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T, helper_arrival_verified_at: T },
    tracking: tr("arrived"), poster: [5, "you"], helpr: [6, "you"],
  },
  arrived_before_photo_owed: {
    job: { ...both, status: "in_progress", require_photo_proof: true, helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T },
    tracking: tr("arrived"), poster: [6, "them"], helpr: [5, "you"],
  },
  working: {
    job: { ...both, status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T, poster_confirmed_working_at: T },
    tracking: tr("working"), poster: [6, "them"], helpr: [6, "you"],
  },
  // The list holds no tracking row: the line still reads the stamps (helperProgress); the button must follow it.
  working_no_tracking_row: {
    job: { ...both, status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T, poster_confirmed_working_at: T },
    tracking: null, poster: [6, "them"], helpr: [6, "you"],
  },
  marked_done: {
    job: { ...both, status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T, helper_completed_at: T },
    tracking: tr("working"), poster: [7, "you"], helpr: [7, "them"],
  },
  fix_asked: {
    job: { ...both, status: "revision_requested", helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T, helper_completed_at: T, revision_requested_at: LATER },
    tracking: tr("working"), poster: [6, "them"], helpr: [6, "you"],
  },
  completed: { job: { ...both, status: "completed", payment_status: "released", poster_completed_at: T }, poster: [8, "done"], helpr: [8, "done"] },
  // (b) past the day: the problem marker sits on the step the job never got past, never a yellow Confirmed.
  no_show_unconfirmed: { job: { ...conf, status: "in_progress", ...PAST }, poster: [3, "problem"], helpr: [3, "problem"] },
  never_confirmed_past_day: { job: { ...conf, ...PAST }, poster: [3, "problem"], helpr: [3, "problem"] },
  never_set_out: { job: { ...both, ...PAST }, poster: [4, "problem"], helpr: [4, "problem"] },
  never_arrived: { job: { ...both, status: "in_progress", helper_on_the_way_at: T, ...PAST }, poster: [5, "problem"], helpr: [5, "problem"] },
  disputed: { job: { ...both, status: "disputed", helper_completed_at: T }, poster: [7, "problem"], helpr: [7, "problem"] },
  cancelled: { job: { status: "cancelled" }, poster: [0, "cancelled"], helpr: [0, "cancelled"] },
};

const PROBLEM_ID = /^(overdue_|stalled$|dispute$|dispute_escalated$|dispute_settling$|listing_expired$|offer_expired$)/;
/** Which bar step each primary face button TAKES (its label names it), and the earlier step it may already show
 *  on: a Helpr's "I'm on my way" is offered on their own confirm, while Confirmed still waits on the poster
 *  (Confirmed lights on BOTH confirms, the old rail's rule). */
const BUTTON_STEP: Array<[RegExp, number[], number[]]> = [
  [/^Review \d+ applicants?$/, [0], []],
  // The day-before confirm, on the face (owner, 2026-10-23, card critique item 1).
  [/^(I'm still on|Confirm you'll be at the job)$/, [3], []],
  [/^Confirm(ing…| they've arrived)$/, [5], []],
  [/^Approve and release$/, [7], []],
  [/^I'm on my way$/, [4], [3]],
  // En route (step in play: On the way) or past the day stuck before Arrived: the tap completes Arrived.
  [/^I've arrived$/, [4, 5], []],
  [/^Start working$/, [5, 6], []],
  [/^Mark job complete$/, [6], []],
  // An owed photo is the face's button (owner 2026-10-23; trackerKeepsThePhotos): before on Arrived, after on Working.
  [/^Take the before photo$/, [5], []],
  [/^Take the after photo$/, [6], []],
  [/^(Leave a review|Tip \w+)$/, [8], []],
];
const takes = (label: string, stage: number | null) => !!BUTTON_STEP.find(([re]) => re.test(label))?.[1].includes(stage ?? -1);

const noop = () => {};
const posterHandlers = (applicants: number) => ({
  pendingApplicants: applicants, helperName: "Hallie", confirmingArrival: false, completing: false,
  openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop, manage: noop,
  confirm: noop, noShow: noop, cancel: noop, viewDispute: noop,
});
const mark = (p: JobProgressState): Mark =>
  p.tone === "cancelled" ? "cancelled" : p.tone === "problem" ? "problem" : p.stage === 8 ? "done" : p.waitingOnYou ? "you" : "them";

/** The poster's card, exactly as PostedJobCard builds it. */
function posterCard(s: State) {
  const job = { ...base, ...s.job } as unknown as Job;
  const line = posterStatusLine(job, s.applicants ?? 0, undefined, undefined);
  const face = posterFaceAction(line.id as PosterWait, job, posterHandlers(s.applicants ?? 0));
  const bar = jobProgress(job as unknown as ProgressJob, { viewer: "poster", otherFirst: "Hallie", card: { line, face } });
  const page = jobProgress(job as unknown as ProgressJob, { viewer: "poster", otherFirst: "Hallie", application: s.applicants ? "pending" : null });
  return { line, face, bar, page };
}
/** The Helpr's card, exactly as AppliedJobCard builds it. */
function helprCard(s: State) {
  const job = { ...base, ...s.job } as unknown as Job;
  const app = { id: "a", job_id: "j", job, helper_id: ME, status: "accepted", closed_reason: null, posterName: "Pat" } as unknown as AppliedApp;
  const line = helperCardLine(app, job, undefined, s.tracking ?? null);
  const live = ["accepted", "in_progress", "revision_requested", "disputed"].includes(String(job.status)) && !!job.helper_confirmed_at;
  const face = helperFaceAction({
    isMinimalCard: job.status === "cancelled", isOffered: false, owesReview: false, review: noop, manage: noop, open: noop,
    step: live ? helperFaceNextStep(job, s.tracking ?? null, line.id as HelperWait) : null, wait: line.id, jobId: "j", viewDispute: noop,
    message: live ? { name: "Pat", onClick: noop } : undefined,
  });
  const bar = jobProgress(job as unknown as ProgressJob, { viewer: "helpr", otherFirst: "Pat", card: { line, face } });
  return { line, face, bar };
}

/** The Helpr's tracker button must name the step its own line names (card shots 2026-10-23: "Start working"
 *  under "Finish and mark it done"). */
const HELPR_BUTTON_LINES: Record<string, RegExp> = {
  "Start working": /^(overdue_)?(start_working|before_photo)$/,
  "Mark job complete": /^(working|after_photo|overdue_unfinished|overdue_after_photo)$/,
};

function agree(side: string, name: string, c: { line: { id: string; tone: string }; face: { label: string; tone: string } | null; bar: JobProgressState }) {
  const tag = `${side}:${name} (${c.line.id})`;
  const live = c.bar.tone === "progress" && c.bar.stage !== null && c.bar.stage < 8;
  const cardSaysYou = c.line.tone === "you" || (c.face?.tone === "primary" && takes(c.face.label, c.bar.stage));
  if (live) expect({ tag, you: c.bar.waitingOnYou }).toEqual({ tag, you: cardSaysYou });
  expect({ tag, problem: c.bar.tone === "problem" }).toEqual({ tag, problem: PROBLEM_ID.test(c.line.id) || c.line.tone === "alarm" });
  const lineFor = c.face ? HELPR_BUTTON_LINES[c.face.label] : undefined;
  if (side === "helpr" && lineFor) expect({ tag, label: c.face!.label, lineOk: lineFor.test(c.line.id) }).toEqual({ tag, label: c.face!.label, lineOk: true });
  if (c.face?.tone === "primary") {
    const hit = BUTTON_STEP.find(([re]) => re.test(c.face!.label));
    expect({ tag, label: c.face.label, known: !!hit }).toEqual({ tag, label: c.face.label, known: true });
    const stageOk = [...hit![1], ...hit![2]].includes(c.bar.stage ?? -1);
    expect({ tag, label: c.face.label, stageOk }).toEqual({ tag, label: c.face.label, stageOk: true });
  }
}

describe("the 8-step bar reads the card's own line and button (lead review 2026-10-22)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("both tables place every card state, exactly (two-way)", () => {
    expect(Object.keys(POSTER_STEP).sort()).toEqual([...POSTER_WAIT_IDS].sort());
    expect(Object.keys(HELPER_STEP).sort()).toEqual([...HELPER_WAIT_IDS].sort());
    expect(POSTER_WAIT_IDS.length).toBeGreaterThan(25);
    expect(HELPER_WAIT_IDS.length).toBeGreaterThan(25);
  });

  it("every journey state, the poster's card: line, button and bar agree, and match the matrix", () => {
    const seen = new Set<string>();
    for (const [name, s] of Object.entries(STATES)) {
      const c = posterCard(s);
      seen.add(c.line.id);
      expect({ name, id: c.line.id, stage: c.bar.stage, mark: mark(c.bar) }).toEqual({ name, id: c.line.id, stage: s.poster[0], mark: s.poster[1] });
      agree("poster", name, c);
      // The job page (no card handed in) draws the same bar.
      expect({ name, stage: c.page.stage, mark: mark(c.page) }).toEqual({ name, stage: c.bar.stage, mark: mark(c.bar) });
    }
    expect(seen.size).toBeGreaterThan(12);
  });

  it("every journey state, the Helpr's card: line, button and bar agree, and match the matrix", () => {
    const seen = new Set<string>();
    for (const [name, s] of Object.entries(STATES)) {
      if (!s.helpr) continue;
      const c = helprCard(s);
      seen.add(c.line.id);
      expect({ name, id: c.line.id, stage: c.bar.stage, mark: mark(c.bar) }).toEqual({ name, id: c.line.id, stage: s.helpr[0], mark: s.helpr[1] });
      agree("helpr", name, c);
    }
    expect(seen.size).toBeGreaterThan(12);
  });

  it("(a) arrived with only the geofence stamp: Arrived, the poster's move, and the job page's line asks for the confirm", () => {
    const c = posterCard(STATES.arrived_verified_only);
    expect(c.line.id).toBe("confirm_arrival");
    expect(c.face.label).toBe("Confirm they've arrived");
    expect(c.bar).toMatchObject({ stage: 5, waitingOnYou: true, tone: "progress" });
    expect(c.page.next).toBe("Hallie arrived — confirm it");
  });

  it("(b) past the day and never confirmed: a No-show? problem on Confirmed, never a yellow progress step", () => {
    for (const name of ["no_show_unconfirmed", "never_confirmed_past_day"]) {
      const c = posterCard(STATES[name]);
      expect({ name, bar: c.bar }).toMatchObject({ name, bar: { stage: 3, tone: "problem", label: "No-show?", waitingOnYou: false } });
      // The job page's line is the card's own sentence, not the tracker's "Tap I'm still on to confirm".
      expect(c.page.next).toMatch(/^Hallie never (arrived — No-Show\?|started — cancel\?)$/);
    }
  });

  it("both cards hand the bar the line and button they draw, and the strip prints the same line", () => {
    const posted = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/posts/PostedJobCard.tsx"), "utf8"));
    // A2-B15: the one cardLine also carries the closed-applicants swap, so bar and strip both read it.
    expect(posted).toMatch(/const cardLine = withClosedApplicants\(posterStatusLine\(withDisputeSettling\(job, unsettledDisputeJobIds\), pendingApplicantCounts\?\.\[job\.id\] \?\? 0, undefined, completedJobMeta\[job\.id\]\), closedApplicantSummaries\?\.\[job\.id\] \?\? null\);/);
    expect(posted).toMatch(/wait: cardLine\.id as PosterWait,/);
    expect(posted).toMatch(/card: \{ line: cardLine, face: faceAction \}/);
    const applied = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/jobs/AppliedJobCard.tsx"), "utf8"));
    expect(applied).toMatch(/const cardLine = helperCardLine\(app, job, unsettledDisputeJobIds, initialTracking\);/);
    expect(applied).toMatch(/card: \{ line: cardLine, face: faceAction \}/);
    const strip = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/jobs/appliedJobCard/HelperCollapsedStrip.tsx"), "utf8"));
    expect(strip).toMatch(/line=\{withReviewed\(helperCardLine\(app, job, unsettledDisputeJobIds, tracking\), reviewed\)\}/);
  });
});
