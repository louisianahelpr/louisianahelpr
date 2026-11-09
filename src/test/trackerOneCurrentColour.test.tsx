/**
 * ONE CURRENT-STEP COLOUR (owner pick 11-08, design audit A JP3: "a 6-step tracker with one 'current' colour").
 * It replaces the 10-31 rule (On the way / Arrived / Working WHITE until they begin, bright YELLOW while they happen),
 * which put two different "current" colours on one tracker (yellow on Way / Arr. / Work, amber everywhere else).
 * What that rule protected is KEPT: whether the step has begun is still known (JobProgressState.begun, read below
 * from real job rows) and still SAID, by the line ("Eli is on the way · since 8:51 AM"), not by a second colour.
 * Read through jobProgress from real job rows (the same path the job page, chat, Home and the cards take).
 *
 * @mutate src/components/tracker/jobProgressState.ts |     p.stage === 4 ? !!job.helper_on_the_way_at |     p.stage === 4 ? true
 * @mutate src/components/tracker/jobProgressState.ts |     : p.stage === 5 ? !!(job.helper_arrived_at \|\| job.helper_arrival_verified_at \|\| job.poster_confirmed_arrival_at) |     : p.stage === 5 ? false
 * @mutate src/components/tracker/jobProgressState.ts |     : workHasBegun(job, { workUnderway, lineId }); |     : true;
 * @mutate src/components/tracker/workHasBegun.ts |   return o.workUnderway !== false; |   return true;
 * @mutate src/components/tracker/JobProgress.tsx |   them: "bg-[hsl(var(--amber-solid))]", |   them: "bg-[hsl(var(--live-pill-tint))]",
 * @mutate src/components/tracker/JobProgress.tsx |   const pulses = detailed && tone === "progress" && stage < JOB_PROGRESS_STEPS.length; |   const pulses = false;
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { JOB_TRACKER_FIRST } from "@/components/tracker/jobProgressSteps";

afterEach(cleanup);

const NOW = new Date("2037-10-21T15:00:00Z");
const BOOKED: ProgressJob = {
  status: "accepted", helper_id: "h", payment_status: "escrow", date_needed: "2037-10-22", start_time: "09:00",
  helper_confirmed_at: "2037-10-19T15:00:00Z", helper_dayof_confirmed_at: "2037-10-21T13:00:00Z", poster_confirmed_at: "2037-10-21T14:00:00Z",
};
const ON_THE_WAY: ProgressJob = { ...BOOKED, helper_on_the_way_at: "2037-10-21T14:30:00Z" };
const ARRIVED: ProgressJob = { ...ON_THE_WAY, status: "in_progress", helper_arrived_at: "2037-10-21T14:50:00Z" };
const WORKING: ProgressJob = { ...ARRIVED, poster_confirmed_arrival_at: "2037-10-21T14:55:00Z" };
const DONE: ProgressJob = { ...WORKING, status: "completed", helper_completed_at: "2037-10-21T16:00:00Z", poster_completed_at: "2037-10-21T16:30:00Z" };

function drawn(job: ProgressJob, viewer: "poster" | "helpr", extra: Parameters<typeof jobProgress>[1] = { viewer }) {
  const p = jobProgress(job, { otherFirst: "Hallie", threadHelprId: "h", now: NOW, ...extra, viewer });
  const { container } = render(<JobProgress progress={p} />);
  const steps = [...container.querySelectorAll("[data-step-state]")];
  // By STAGE index (0..7): the drawn bar starts at Hired.
  const step = (i: number) => steps[i - JOB_TRACKER_FIRST];
  const seg = (i: number) => step(i)?.querySelector("[data-step-seg]")?.className ?? "";
  return { p, steps, step, seg, container };
}

const AMBER = "bg-[hsl(var(--amber-solid))]";
const YELLOW = "live-pill-tint";

describe("one current-step colour on every step (owner pick 11-08)", () => {
  it("both confirmed, not set out: On the way is the current step, amber, and not begun", () => {
    let n = 0;
    for (const viewer of ["poster", "helpr"] as const) {
      const { p, step, seg, container } = drawn(BOOKED, viewer);
      expect(p.stage).toBe(4);
      expect(p.begun).toBe(false);
      expect(seg(4)).toContain(AMBER);
      expect(container.innerHTML).not.toContain(YELLOW);
      expect(step(4).querySelector(".job-step-cur-icon")).toBeTruthy();
      expect(step(4).querySelector(".font-semibold")).toBeTruthy();
      cleanup();
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });

  it("on the way, arrived, working: the same amber, the step begun, never yellow", () => {
    const cases: [ProgressJob, number][] = [[ON_THE_WAY, 4], [ARRIVED, 5], [WORKING, 6]];
    for (const [job, stage] of cases) {
      const { p, step, seg, container } = drawn(job, "poster");
      expect(p.stage).toBe(stage);
      expect(p.begun).toBe(true);
      expect(seg(stage)).toContain(AMBER);
      expect(seg(stage)).toContain("step-current-pulse");
      expect(step(stage - 1).getAttribute("data-step-state")).toBe("done");
      expect(container.innerHTML).not.toContain(YELLOW);
      cleanup();
    }
  });

  it("JOBS3-48: a Helpr arrived but not started sits on Working, not begun, amber", () => {
    const { p, seg } = drawn({ ...ARRIVED, helper_arrival_verified_at: "2037-10-21T14:51:00Z" }, "helpr", {
      viewer: "helpr", card: { line: { id: "start_working", tone: "you", detail: "Tap Start when you begin" }, face: { tone: "primary", step: "working" } },
    });
    expect(p.stage).toBe(6);
    expect(p.begun).toBe(false);
    expect(seg(6)).toContain(AMBER);
  });

  it("the poster's job page: the Helpr's tracking row decides begun; the colour is amber either way", () => {
    const waiting = drawn(WORKING, "poster", { viewer: "poster", workUnderway: false, tracking: { status: "arrived" } });
    expect(waiting.p.stage).toBe(6);
    expect(waiting.p.begun).toBe(false);
    expect(waiting.seg(6)).toContain(AMBER);
    cleanup();
    const going = drawn(WORKING, "poster", { viewer: "poster", workUnderway: true, tracking: { status: "working" } });
    expect(going.p.begun).toBe(true);
    expect(going.seg(6)).toContain(AMBER);
  });

  it("done: every drawn step filled", () => {
    const { p, steps } = drawn(DONE, "poster");
    expect(p.stage).toBe(8);
    expect(steps.length).toBe(6);
    expect(steps.every((s) => s.getAttribute("data-step-state") === "done")).toBe(true);
  });

  it("other current steps are the same amber (Confirmed, one side in)", () => {
    const { p, seg } = drawn({ ...BOOKED, poster_confirmed_at: null }, "poster");
    expect(p.stage).toBe(3);
    expect(p.begun).toBeUndefined();
    expect(seg(3)).toContain(AMBER);
  });
});
