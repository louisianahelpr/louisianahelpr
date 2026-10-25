// The 8-step tracker's colours and words (owner, 2026-10-22): done GREEN, the current step YELLOW when it waits
// on the viewer and OLIVE when it waits on the other person, later steps grey; colour is never the only signal
// (an icon on the current step, the bold word, an outline for later steps, one sentence for a screen reader).
// @mutate src/components/tracker/JobProgress.tsx |   you: "bg-[hsl(var(--amber-solid))]", |   you: "bg-primary",
// @mutate src/components/tracker/JobProgress.tsx |   them: "bg-[hsl(var(--amber-solid))]", |   them: "bg-primary",
// @mutate src/components/tracker/JobProgress.tsx |   problem: "bg-[hsl(var(--burnt-sienna))]", |   problem: "bg-primary",
// @mutate src/components/tracker/JobProgress.tsx |   if (tone === "cancelled") { |   if (false) {
// @mutate src/components/tracker/JobProgress.tsx |   done: "bg-[hsl(var(--bark))]", |   done: "bg-[hsl(var(--success-ink))]",
// @mutate src/components/tracker/JobProgress.tsx |               {s === "you" && <Hand className="h-3 w-3 shrink-0" />} |
// @mutate src/components/tracker/JobProgress.tsx |     `Job progress, step ${stage + 1} of ${n}: ${(JOB_PROGRESS_STEPS as readonly string[])[stage]}, | `Job progress, step ${stage + 1} of ${n}:
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { JobProgress, jobStepsLabel } from "@/components/tracker/JobProgress";
import { JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressState";

const states = (c: HTMLElement) => [...c.querySelectorAll("[data-step-state]")].map((e) => e.getAttribute("data-step-state"));
const bar = (c: HTMLElement, i: number) => c.querySelectorAll("[data-step-state]")[i].querySelector("[data-step-seg]") as HTMLElement;

describe("JobProgress: the 8-step bar", () => {
  it("done green, current amber with a hand when it waits on you, later grey outline", () => {
    const { container } = render(<JobProgress progress={{ stage: 3, waitingOnYou: true, tone: "progress", word: "Confirmed", next: "Tap I'm still on to confirm", held: false }} />);
    expect(states(container)).toEqual(["done", "done", "done", "you", "todo", "todo", "todo", "todo"]);
    expect(bar(container, 0).className).toContain("bg-[hsl(var(--bark))]");
    expect(bar(container, 3).className).toContain("bg-[hsl(var(--amber-solid))]");
    expect(bar(container, 4).className).toContain("border");
    // An icon on the current step, none on later ones (besides the step's own icon, src/test/trackerKeepsTheOldSteps).
    expect(container.querySelectorAll("[data-step-state='you'] svg:not([data-step-icon] svg)").length).toBe(1);
    expect(container.querySelectorAll("[data-step-state='todo'] svg:not([data-step-icon] svg)").length).toBe(0);
    expect(container.querySelector("[data-job-progress-next]")?.textContent).toBe("Tap I'm still on to confirm");
  });

  it("amber with an hourglass when the current step waits on the other person", () => {
    const { container } = render(<JobProgress progress={{ stage: 5, waitingOnYou: false, tone: "progress", word: "Arrived", next: "x", held: false }} />);
    expect(states(container)[5]).toBe("them");
    // The current step is amber either way (owner 2026-10-23); the hourglass says it is theirs.
    expect(bar(container, 5).className).toContain("bg-[hsl(var(--amber-solid))]");
    expect(container.querySelectorAll("[data-step-state='them'] svg:not([data-step-icon] svg)").length).toBe(1);
    expect(container.querySelector("[data-job-steps]")?.getAttribute("data-waiting-on")).toBe("them");
  });

  it("every step done when the job is complete", () => {
    const { container } = render(<JobProgress progress={{ stage: 8, waitingOnYou: false, tone: "progress", word: "Done", next: "", held: false }} />);
    expect(states(container)).toEqual(Array(8).fill("done"));
  });

  it("the bar reads as one sentence with every full step name and the state", () => {
    const l = jobStepsLabel(3, true);
    for (const s of JOB_PROGRESS_STEPS) expect(l).toContain(s);
    expect(l).toContain("step 4 of 8: Confirmed, waiting on you");
    expect(jobStepsLabel(5, false)).toContain("Arrived, waiting on the other person");
    expect(jobStepsLabel(8, false)).toContain("all 8 steps done");
    const { container } = render(<JobProgress progress={{ stage: 3, waitingOnYou: true, tone: "progress", word: "", next: "", held: false }} />);
    expect(container.querySelector("[data-job-steps]")?.getAttribute("aria-label")).toBe(l);
  });

  it("barOnly drops the line (the card's status line says it); off the path draws the line alone", () => {
    const { container } = render(<JobProgress barOnly progress={{ stage: 1, waitingOnYou: true, tone: "progress", word: "Offered", next: "Accept", held: false }} />);
    expect(container.querySelector("[data-job-progress-next]")).toBeNull();
    const off = render(<JobProgress progress={{ stage: null, waitingOnYou: false, tone: "progress", word: "Cancelled", next: "This job was cancelled", held: false }} />);
    expect(off.container.querySelector("[data-job-steps]")).toBeNull();
    expect(off.container.textContent).toContain("Cancelled");
  });

  it("a problem step (no-show, overdue, dispute) is the warning colour with an alert icon and its own word", () => {
    const { container } = render(<JobProgress barOnly progress={{ stage: 5, waitingOnYou: false, tone: "problem", label: "No-show?", word: "", next: "", held: false }} />);
    expect(states(container)[5]).toBe("problem");
    expect(bar(container, 5).className).toContain("bg-[hsl(var(--burnt-sienna))]");
    expect(container.querySelectorAll("[data-step-state='problem'] svg").length).toBe(1);
    expect(container.querySelector("[data-step-state='problem']")?.textContent).toContain("No-show?");
    expect(container.querySelector("[role='img']")?.getAttribute("aria-label")).toContain("No-show?, needs attention");
  });

  it("cancelled is all grey with Cancelled under it", () => {
    const { container } = render(<JobProgress barOnly progress={{ stage: 0, waitingOnYou: false, tone: "cancelled", label: "Cancelled", word: "Cancelled", next: "", held: false }} />);
    expect(states(container)).toEqual(Array(8).fill("todo"));
    expect(container.textContent).toContain("Cancelled");
    expect(container.querySelector("[role='img']")?.getAttribute("aria-label")).toBe("Job progress: Cancelled. No steps ahead.");
  });
});
