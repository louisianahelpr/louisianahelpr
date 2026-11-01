/**
 * ON THE WAY, ARRIVED AND WORKING ARE WHITE UNTIL THEY BEGIN, YELLOW WHILE THEY HAPPEN (owner, 2026-10-31: "On the
 * way should show yellow until he is actually on the way", corrected: "It shouldn't only be yellow when he is on the
 * way it should be white right now while we wait"). Both confirmed and not set out used to draw On the way in the
 * dark amber with an hourglass; it is now the later-step outline (still marked by its hourglass / hand and the bold
 * word, and it does not pulse). Once helper_on_the_way_at is set it is the app's bright yellow (--live-pill-tint);
 * Arrived and Working follow the same rule; a done step keeps the normal fill. Other current steps stay amber.
 * Read through jobProgress from real job rows (the same path the job page, chat, Home and the cards take).
 *
 * @mutate src/components/tracker/jobProgressState.ts |     p.stage === 4 ? !!job.helper_on_the_way_at |     p.stage === 4 ? true
 * @mutate src/components/tracker/jobProgressState.ts |     : p.stage === 5 ? !!(job.helper_arrived_at \|\| job.helper_arrival_verified_at \|\| job.poster_confirmed_arrival_at) |     : p.stage === 5 ? false
 * @mutate src/components/tracker/jobProgressState.ts |     : workHasBegun(job, { workUnderway, lineId }); |     : true;
 * @mutate src/components/tracker/workHasBegun.ts |   return o.workUnderway !== false; |   return true;
 * @mutate src/components/tracker/JobProgress.tsx |   waiting: BAR.todo, |   waiting: BAR.them,
 * @mutate src/components/tracker/JobProgress.tsx |   happening: "bg-[hsl(var(--live-pill-tint))]", |   happening: "bg-[hsl(var(--amber-solid))]",
 * @mutate src/components/tracker/JobProgress.tsx |           begun={progress.begun} |           begun={undefined}
 * @mutate src/components/tracker/JobProgress.tsx |   const pulses = detailed && tone === "progress" && stage < JOB_PROGRESS_STEPS.length && phase !== "waiting"; |   const pulses = detailed && tone === "progress" && stage < JOB_PROGRESS_STEPS.length;
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";

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
  const seg = (i: number) => steps[i]?.querySelector("[data-step-seg]")?.className ?? "";
  return { p, steps, seg, container };
}

describe("Way / Arr. / Work: white while waiting, yellow while happening, filled when done (owner 2026-10-31)", () => {
  it("both confirmed, not set out: On the way is WHITE (no amber, no pulse) but still marked", () => {
    let n = 0;
    for (const viewer of ["poster", "helpr"] as const) {
      const { p, steps, seg, container } = drawn(BOOKED, viewer);
      expect(p.stage).toBe(4);
      expect(p.begun).toBe(false);
      expect(steps[4].getAttribute("data-step-phase")).toBe("waiting");
      expect(seg(4)).toContain("border border-border bg-transparent");
      expect(seg(4)).not.toContain("amber");
      expect(seg(4)).not.toContain("step-current-pulse");
      // Still marked: the hourglass (poster: theirs) or hand (Helpr: yours) and the bold word.
      expect(steps[4].querySelector(".job-step-cur-icon")).toBeTruthy();
      expect(steps[4].querySelector(".font-semibold")).toBeTruthy();
      expect(container.querySelectorAll(".bg-\\[hsl\\(var\\(--amber-solid\\)\\)\\]").length).toBe(0);
      cleanup();
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });

  it("on the way: On the way is the bright YELLOW", () => {
    for (const viewer of ["poster", "helpr"] as const) {
      const { p, steps, seg } = drawn(ON_THE_WAY, viewer);
      expect(p.stage).toBe(4);
      expect(p.begun).toBe(true);
      expect(steps[4].getAttribute("data-step-phase")).toBe("happening");
      expect(seg(4)).toContain("bg-[hsl(var(--live-pill-tint))]");
      expect(seg(4)).toContain("step-current-pulse");
      cleanup();
    }
  });

  it("arrived (poster to confirm): On the way done, Arrived YELLOW", () => {
    const { p, steps, seg } = drawn(ARRIVED, "poster");
    expect(p.stage).toBe(5);
    expect(p.begun).toBe(true);
    expect(steps[4].getAttribute("data-step-state")).toBe("done");
    expect(seg(5)).toContain("bg-[hsl(var(--live-pill-tint))]");
  });

  it("working: Arrived done, Working YELLOW", () => {
    const { p, steps, seg } = drawn(WORKING, "poster");
    expect(p.stage).toBe(6);
    expect(p.begun).toBe(true);
    expect(steps[5].getAttribute("data-step-state")).toBe("done");
    expect(seg(6)).toContain("bg-[hsl(var(--live-pill-tint))]");
  });

  it("JOBS3-48: a Helpr arrived but not started sits on Working, and it is WHITE", () => {
    const { p, steps, seg } = drawn({ ...ARRIVED, helper_arrival_verified_at: "2037-10-21T14:51:00Z" }, "helpr", {
      viewer: "helpr", card: { line: { id: "start_working", tone: "you", detail: "Tap Start working" }, face: { tone: "primary", step: "working" } },
    });
    expect(p.stage).toBe(6);
    expect(p.begun).toBe(false);
    expect(steps[6].getAttribute("data-step-phase")).toBe("waiting");
    expect(seg(6)).toContain("border border-border bg-transparent");
  });

  it("the poster's job page: the Helpr's tracking row says not started yet, so Working stays WHITE; started, YELLOW", () => {
    // JobTracker passes helperProgress(job, trackingStatus).workUnderway: the Helpr's own row wins over the arrival confirm.
    const waiting = drawn(WORKING, "poster", { viewer: "poster", workUnderway: false, tracking: { status: "arrived" } });
    expect(waiting.p.stage).toBe(6);
    expect(waiting.p.begun).toBe(false);
    expect(waiting.seg(6)).toContain("border border-border bg-transparent");
    cleanup();
    const going = drawn(WORKING, "poster", { viewer: "poster", workUnderway: true, tracking: { status: "working" } });
    expect(going.p.begun).toBe(true);
    expect(going.seg(6)).toContain("bg-[hsl(var(--live-pill-tint))]");
  });

  it("done: every step filled, no yellow, no white current step", () => {
    const { p, steps, container } = drawn(DONE, "poster");
    expect(p.stage).toBe(8);
    expect(steps.every((s) => s.getAttribute("data-step-state") === "done")).toBe(true);
    expect(container.querySelector("[data-step-phase]")).toBeNull();
  });

  it("other current steps keep the amber 'you are here' (Confirmed, one side in)", () => {
    const { p, seg } = drawn({ ...BOOKED, poster_confirmed_at: null }, "poster");
    expect(p.stage).toBe(3);
    expect(p.begun).toBeUndefined();
    expect(seg(3)).toContain("bg-[hsl(var(--amber-solid))]");
  });
});
