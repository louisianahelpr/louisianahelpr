/**
 * NOTHING THE OWNER BUILT ON THE OLD TRACKER IS DROPPED (owner, 2026-10-23: "all the steps i built on our previous
 * tracker were removed. we need all those back and working and the steps to be correct").
 *
 * The previous tracker is the 8-icon step rail inside the open job card (JobTracking.tsx before f657c09997,
 * 2026-10-21 "ONE job tracker everywhere"), plus the step buttons under it. Its inventory, read from that commit's
 * parent, and where each item lives now (the table is also in ~/.lh-wt/card-polish-critique.md):
 *   steps   Posted · Offered · Accepted · Confirmed · On the way · Arrived · Working · Done
 *           -> the same eight in JOB_PROGRESS_STEPS; Accepted is named "Hired" (owner's 8-step list, 2026-10-22)
 *   icons   FileText · Clock · CheckCircle2 · CalendarCheck · Truck · MapPin · Wrench · PartyPopper
 *           -> JOB_STEP_ICONS, drawn over each step on the full tracker
 *   time    tap/hover on a done step showed when it happened (useStepTooltip; a click never hides what a hover
 *           showed) -> the full tracker's done steps, the same stamps
 *   colour  one AMBER "you are here" step; red ONLY on the step a dispute stopped the job at; all green at Done
 *           -> the current step amber (owner 2026-10-23: the old rule wins), a hand / an hourglass for whose move;
 *           EXCEPT On the way / Arrived / Working (owner 2026-10-31: white until that step begins, bright yellow
 *           while it happens; JobProgressState.begun, guard src/test/trackerStepWhiteUntilBegun.test.tsx);
 *           Dispute red (bg-destructive); stage 8 all done
 *   pulse   the current step pulsed until Done (never on a dispute or a finished job) -> step-current-pulse on the
 *           current step's bar (a span, never a control: finishedJobDoesNotPulse)
 *   rule    Confirmed lit only on BOTH confirms (job_confirmed = the mutual stamp) -> jobStepFromWait `booked`
 *   actions the step buttons: I've accepted · Confirm this job · I'm on my way · I've arrived · Start working ·
 *           Mark job complete -> unchanged in JobTracking STATUSES, the open card's one primary button
 *
 * @mutate src/components/tracker/JobProgress.tsx | export const JOB_STEP_ICONS: readonly LucideIcon[] = [FileText, Clock, CheckCircle2, CalendarCheck, Truck, MapPin, Wrench, PartyPopper]; | export const JOB_STEP_ICONS: readonly LucideIcon[] = [FileText, Clock, CheckCircle2, CheckCircle2, Truck, MapPin, Wrench, PartyPopper];
 * @mutate src/components/tracker/JobProgress.tsx |             {detailed && ( |             {false && (
 * @mutate src/components/tracker/JobProgress.tsx |         const tipText = !detailed ? null : ts ? stampText(ts) : i === stage && why ? why : null; |         const tipText = null;
 * @mutate src/components/tracker/JobProgress.tsx |   them: "bg-[hsl(var(--amber-solid))]", |   them: "bg-primary",
 * @mutate src/hooks/useStepTooltip.ts |       if (hoverOpened.current === key) { |       if (false) {
 * @mutate src/components/tracker/JobProgress.tsx |   const pulses = detailed && tone === "progress" && stage < JOB_PROGRESS_STEPS.length && phase !== "waiting"; |   const pulses = false;
 * @mutate src/components/tracker/JobProgress.tsx |   const current: StepState = tone === "problem" ? (label === "Dispute" ? "alarm" : "problem") : waitingOnYou ? "you" : "them"; |   const current: StepState = tone === "problem" ? "problem" : waitingOnYou ? "you" : "them";
 * @mutate src/components/tracker/jobStepFromWait.ts |   if (job.date_needed && !(job.helper_dayof_confirmed_at && job.poster_confirmed_at)) return at(3); |   if (job.date_needed && !job.helper_dayof_confirmed_at) return at(3);
 * @mutate src/components/JobTracking.tsx |   { key: "arrived", label: "Arrived", action: "I've arrived", icon: MapPin, color: "text-primary" }, |   { key: "arrived", label: "Arrived", action: null, icon: MapPin, color: "text-primary" },
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { CalendarCheck, CheckCircle2, Clock, FileText, MapPin, PartyPopper, Truck, Wrench } from "lucide-react";
import { JobProgress, JOB_STEP_ICONS } from "@/components/tracker/JobProgress";
import { JOB_PROGRESS_STEPS, jobProgress, type JobProgressState, type ProgressJob } from "@/components/tracker/jobProgressState";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** The old rail, as JobTracking still defines its steps (PRE_STATUSES + STATUSES). */
function oldRail() {
  const src = code("src/components/JobTracking.tsx");
  const rows = [...src.matchAll(/\{ key: "([a-z_]+)", label: "([^"]+)", action: (null|"[^"]+"), icon: (\w+),/g)];
  const byKey = new Map(rows.map((m) => [m[1], { label: m[2], action: m[3] === "null" ? null : m[3].slice(1, -1), icon: m[4] }]));
  const order = ["posted", "assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"];
  return order.map((k) => ({ key: k, ...byKey.get(k)! }));
}

const live = (p: Partial<JobProgressState>): JobProgressState => ({ stage: 5, waitingOnYou: false, tone: "progress", word: "", next: "Hallie arrived. Confirm they've arrived", held: true, ...p });
const STAMPS = [null, null, "2026-10-20T15:00:00Z", "2026-10-21T15:00:00Z", "2026-10-22T14:00:00Z", "2026-10-22T15:00:00Z", null, null] as const;

afterEach(cleanup);

describe("the old tracker's steps and actions are all still here (owner 2026-10-23)", () => {
  it("the same eight steps, in order; Accepted is the step the owner named Hired", () => {
    const rail = oldRail();
    expect(rail.length).toBeGreaterThan(7);
    const RENAMED: Record<string, string> = { Accepted: "Hired" };
    expect(rail.map((s) => RENAMED[s.label] ?? s.label)).toEqual([...JOB_PROGRESS_STEPS]);
  });

  it("each step keeps its old icon, and the full tracker draws it", () => {
    const BY_NAME: Record<string, unknown> = { FileText, Clock, CheckCircle2, CalendarCheck, Truck, MapPin, Wrench, PartyPopper };
    expect(oldRail().map((s) => BY_NAME[s.icon])).toEqual([...JOB_STEP_ICONS]);
    const { container } = render(<JobProgress progress={live({})} />);
    expect(container.querySelectorAll("[data-step-icon] svg").length).toBe(8);
    // The collapsed card's bar stays compact: no icons there.
    cleanup();
    const card = render(<JobProgress barOnly progress={live({})} />);
    expect(card.container.querySelectorAll("[data-step-icon]").length).toBe(0);
  });

  it("every step action the old rail's button offered is still a step action", () => {
    expect(oldRail().map((s) => s.action).filter(Boolean)).toEqual(["I've accepted", "Confirm this job", "I'm on my way", "I've arrived", "Start working", "Mark job complete"]);
    expect(code("src/components/JobTracking.tsx")).toContain('label={arrivalRefusedHere ? "Try my location again" : (nextStatus.action ?? nextStatus.label)}');
  });

  it("a done step shows when it happened on tap or hover; a click never hides what the hover showed", () => {
    const { container } = render(<JobProgress progress={live({ stamps: STAMPS })} />);
    const hired = container.querySelector('[data-step-tip="2"]') as HTMLElement;
    expect(hired).toBeTruthy();
    expect(hired.getAttribute("aria-label")).toMatch(/^Hired — Oct 20/);
    fireEvent.mouseEnter(hired);
    expect(container.querySelector("[role='tooltip']")?.textContent).toMatch(/^Oct 20/);
    fireEvent.click(hired);
    expect(container.querySelector("[role='tooltip']")).toBeTruthy();
    fireEvent.click(hired);
    expect(container.querySelector("[role='tooltip']")).toBeNull();
    // A step with no stamp (Offered) is not a control.
    expect(container.querySelector('[data-step-tip="1"]')).toBeNull();
  });

  it("a tap on the current step says why it is that colour (the line)", () => {
    const { container } = render(<JobProgress progress={live({ stamps: STAMPS })} />);
    const arrived = container.querySelector('[data-step-tip="5"]') as HTMLElement;
    fireEvent.click(arrived);
    expect(container.querySelector("[role='tooltip']")?.textContent).toBe("Hallie arrived. Confirm they've arrived");
  });

  it("the current step pulses while the job is live; never at Done or on a problem", () => {
    const pulsing = (p: JobProgressState) => {
      const { container } = render(<JobProgress progress={p} />);
      const n = container.querySelectorAll("[data-step-seg].step-current-pulse").length;
      cleanup();
      return n;
    };
    expect(pulsing(live({}))).toBe(1);
    expect(pulsing(live({ stage: 8 }))).toBe(0);
    expect(pulsing(live({ stage: 7, tone: "problem", label: "Dispute" }))).toBe(0);
  });

  // Way / Arr. / Work with a known `begun` are white or yellow instead (owner 2026-10-31): trackerStepWhiteUntilBegun.
  it("the current step is AMBER, whoever's move it is (the old rail's rule; owner 2026-10-23)", () => {
    for (const waitingOnYou of [true, false]) {
      const { container } = render(<JobProgress progress={live({ waitingOnYou })} />);
      expect(container.querySelectorAll("[data-step-state]")[5].querySelector("[data-step-seg]")?.className).toContain("bg-[hsl(var(--amber-solid))]");
      cleanup();
    }
  });

  it("red only on the step a dispute stopped the job at; all green at Done", () => {
    const { container } = render(<JobProgress progress={live({ stage: 6, tone: "problem", label: "Dispute" })} />);
    const steps = [...container.querySelectorAll("[data-step-state]")];
    expect(steps.map((s) => s.getAttribute("data-step-state"))).toEqual(["done", "done", "done", "done", "done", "done", "alarm", "todo"]);
    expect(steps[6].querySelector("[data-step-seg]")?.className).toContain("bg-destructive");
    expect(container.querySelectorAll(".bg-destructive").length).toBe(1);
    cleanup();
    const done = render(<JobProgress progress={live({ stage: 8 })} />);
    expect([...done.container.querySelectorAll("[data-step-state]")].every((s) => s.getAttribute("data-step-state") === "done")).toBe(true);
  });

  it("Confirmed lights only on BOTH confirms (the old rail's job_confirmed rule)", () => {
    const NOW = new Date("2037-10-21T15:00:00Z");
    const j = { status: "accepted", helper_id: "h", date_needed: "2037-10-22", start_time: "09:00", helper_confirmed_at: "t" } as ProgressJob;
    for (const viewer of ["poster", "helpr"] as const) {
      expect(jobProgress({ ...j, helper_dayof_confirmed_at: "t" }, { viewer, now: NOW, threadHelprId: "h" }).stage).toBe(3);
      expect(jobProgress({ ...j, poster_confirmed_at: "t" }, { viewer, now: NOW, threadHelprId: "h" }).stage).toBe(3);
      expect(jobProgress({ ...j, poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" }, { viewer, now: NOW, threadHelprId: "h" }).stage).toBe(4);
    }
  });

  it("the open card's tracker reads the card's own inputs (photo rule, tracking row), not a thinner copy", () => {
    const src = code("src/components/JobTracking.tsx");
    expect(src).toMatch(/require_photo_proof: requirePhotoProof,\s*proof_before_urls: proofBeforeUrls,\s*proof_after_urls: proofAfterUrls,/);
    expect(src).toMatch(/workUnderway: currentStatusIdx >= STATUS_IDX\.working, tracking, card: progressCard \}/);
  });
});
