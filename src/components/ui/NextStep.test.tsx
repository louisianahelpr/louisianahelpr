/**
 * The shared next-step line (owner 2026-11-01 12:05 PM) and the job's mapping onto it (jobNextStep).
 * @mutate src/components/ui/NextStep.tsx |   const lead = value.who === "you" ? t("next.lead", { step: value.keepCase ? value.text : lowerFirst(value.text) }) : value.text; |   const lead = value.text;
 * @mutate src/components/tracker/jobNextStep.ts |   const v: NextStepValue = split ? { who, text: split.text, by: split.by } : { who, text: line }; |   const v: NextStepValue = { who, text: line };
 * @mutate src/components/tracker/jobNextStep.ts |   return keepCase ? { ...v, keepCase } : v; |   return v;
 * @mutate src/components/ui/NextStep.tsx | { step: value.keepCase ? value.text : lowerFirst(value.text) } | { step: lowerFirst(value.text) }
 * @mutate src/lib/nextStepWords.ts | { step: v.keepCase ? v.text : lowerFirst(v.text) } | { step: lowerFirst(v.text) }
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
    const next = "Confirm you'll be at the job by Wed 9:00 AM";
    expect(jobNextStep(p({ waitingOnYou: true, next, nextBy: { line: next, text: "Confirm you'll be at the job", by: "by Wed 9:00 AM" } }), { side: "helpr" }))
      .toEqual({ who: "you", text: "Confirm you'll be at the job", by: "by Wed 9:00 AM" });
    // F260q: the deadline is handed back where the line is made, never read out of the words (any language).
    expect(jobNextStep(p({ waitingOnYou: true, next: "Confirme antes del mié 9:00 a. m.", nextBy: { line: "Confirme antes del mié 9:00 a. m.", text: "Confirme", by: "antes del mié 9:00 a. m." } }), { side: "helpr" }))
      .toEqual({ who: "you", text: "Confirme", by: "antes del mié 9:00 a. m." });
    // A line replaced after it was made keeps no stale deadline.
    expect(jobNextStep(p({ waitingOnYou: true, next: "Something else by Wed 9:00 AM", nextBy: { line: next, text: "Confirm you'll be at the job", by: "by Wed 9:00 AM" } }), { side: "helpr" }))
      .toEqual({ who: "you", text: "Something else by Wed 9:00 AM" });
  });
  it("applicants waiting: 'Next: choose a Helpr · 2 applied'", () => {
    const v = jobNextStep(p({ stage: 0, waitingOnYou: true, next: "Pick your Helpr" }), { side: "poster", pendingApplicants: 2 });
    expect(nextStepWords(v!)).toBe("Next: choose a Helpr · 2 applied");
  });
  it("working: the poster waits on the Helpr to mark it done; the review window is in the approve line", () => {
    expect(nextStepWords(jobNextStep(p({ stage: 6, next: "Yusef is working", nextCode: { id: "working", line: "Yusef is working" } }), { side: "poster", otherFirst: "Yusef" })!)).toBe("Waiting on Yusef to mark it done");
    expect(nextStepWords(jobNextStep(p({ stage: 7, waitingOnYou: true, next: "Yusef marked it done. Check the work and approve" }), { side: "poster", otherFirst: "Yusef", approveLeft: "23h 52m left, then Helpr support steps in" })!))
      .toBe("Next: approve Yusef's work · 23h 52m left, then Helpr support steps in");
  });
  // Jobs audit 1102b row 4 (Q2590): "Next: lexi offered you this job" under "Lexi L.".
  it("a 'you' line that starts with the other person's name keeps its capital", () => {
    const v = jobNextStep(p({ stage: 3, waitingOnYou: true, next: "Lexi wants a new time. Confirm it" }), { side: "helpr", otherFirst: "Lexi" })!;
    expect(nextStepWords(v)).toBe("Next: Lexi wants a new time. Confirm it");
    const { container } = render(<NextStep value={v} />);
    expect(container.textContent).toBe("Next: Lexi wants a new time. Confirm it");
    // A verb first still reads as one sentence.
    expect(nextStepWords(jobNextStep(p({ waitingOnYou: true, next: "Confirm the job is still on" }), { side: "poster", otherFirst: "Lexi" })!)).toBe("Next: confirm the job is still on");
  });
  // Q2601 (Jobs audit 1102b row 15): the offered Helpr's line is the step, accept or decline, with the offer's clock.
  // @mutate src/components/tracker/jobNextStep.ts |   if (o.side === "helpr" && progress.waitingOnYou && nextLineCode(progress) === "offered_you") { |   if (false) {
  it("an offer to this Helpr reads 'Next: accept or decline Lexi's offer · by <time>', not the news", () => {
    const until = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const v = jobNextStep(p({ stage: 1, waitingOnYou: true, next: "Lexi offered you this job", nextCode: { id: "offered_you", line: "Lexi offered you this job" } }), { side: "helpr", otherFirst: "Lexi", offerUntil: until })!;
    expect(nextStepWords(v)).toMatch(/^Next: accept or decline Lexi's offer · by \w{3} \d{1,2}:\d{2} [AP]M$/);
    expect(nextStepWords(jobNextStep(p({ stage: 1, waitingOnYou: true, next: "Lexi offered you this job", nextCode: { id: "offered_you", line: "Lexi offered you this job" } }), { side: "helpr" })!)).toBe("Next: accept or decline the offer");
  });
  it("off the path keeps the tracker's word and line", () => {
    expect(nextStepWords(jobNextStep(p({ stage: null, word: "Cancelled", next: "You cancelled Sat 9:00 AM" }), { side: "poster" })!)).toBe("Cancelled · You cancelled Sat 9:00 AM");
  });
});
