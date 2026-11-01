/**
 * The shared next-step line (owner 2026-11-01 12:05 PM) and the job's mapping onto it (jobNextStep).
 * @mutate src/components/ui/NextStep.tsx |   const lead = value.who === "you" ? `Next: ${lowerFirst(value.text)}` : value.text; |   const lead = value.text;
 * @mutate src/components/tracker/jobNextStep.ts |   return m ? { who, text: m[1], by: m[2] } : { who, text: line }; |   return { who, text: line };
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NextStep, nextStepWords } from "./NextStep";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const p = (over: Partial<JobProgressState>): JobProgressState => ({ stage: 3, waitingOnYou: false, tone: "progress", word: "", next: "", held: true, ...over });

describe("NextStep", () => {
  it("the viewer's move reads 'Next: …' with its deadline; someone else's reads as the wait", () => {
    const { container } = render(<NextStep value={{ who: "you", text: "Confirm the job is still on", by: "by Sat 9:00 AM" }} />);
    expect(container.textContent).toBe("Next: confirm the job is still on · by Sat 9:00 AM");
    expect(nextStepWords({ who: "them", text: "Waiting on Yusef to mark it done" })).toBe("Waiting on Yusef to mark it done");
    expect(nextStepWords({ who: "you", text: "I'm on my way" })).toBe("Next: I'm on my way");
  });
  it("nothing to say draws nothing", () => {
    const { container } = render(<NextStep value={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("jobNextStep", () => {
  it("splits the deadline out of the tracker's line", () => {
    expect(jobNextStep(p({ waitingOnYou: true, next: "Confirm you'll be at the job by Wed 9:00 AM" }), { side: "helpr" }))
      .toEqual({ who: "you", text: "Confirm you'll be at the job", by: "by Wed 9:00 AM" });
  });
  it("applicants waiting: 'Next: choose a Helpr · 2 applied'", () => {
    const v = jobNextStep(p({ stage: 0, waitingOnYou: true, next: "Pick your Helpr" }), { side: "poster", pendingApplicants: 2 });
    expect(nextStepWords(v!)).toBe("Next: choose a Helpr · 2 applied");
  });
  it("working: the poster waits on the Helpr to mark it done; the review window is in the approve line", () => {
    expect(nextStepWords(jobNextStep(p({ stage: 6, next: "Yusef is working" }), { side: "poster", otherFirst: "Yusef" })!)).toBe("Waiting on Yusef to mark it done");
    expect(nextStepWords(jobNextStep(p({ stage: 7, waitingOnYou: true, next: "Yusef marked it done. Check the work and approve" }), { side: "poster", otherFirst: "Yusef", approveLeft: "23h 52m left, then Helpr support steps in" })!))
      .toBe("Next: approve Yusef's work · 23h 52m left, then Helpr support steps in");
  });
  it("off the path keeps the tracker's word and line", () => {
    expect(nextStepWords(jobNextStep(p({ stage: null, word: "Cancelled", next: "You cancelled Sat 9:00 AM" }), { side: "poster" })!)).toBe("Cancelled · You cancelled Sat 9:00 AM");
  });
});
