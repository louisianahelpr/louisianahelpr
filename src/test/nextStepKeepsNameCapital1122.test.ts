/**
 * #42 (deep audit 11-22): the poster's job page read "Next: hallie didn't show up". The page built its no-show "you"
 * step by hand with no keepCase, so NextStep lowercased the name; jobNextStep's own check also matched only the whole
 * name string, so a caller holding "Hallie H." lost the capital the same way. Both now go through one helper.
 *
 * The class: a "you" step whose line starts with the other person's first name keeps its capital, whichever form of
 * the name the caller holds (first name, "First L.", "First Last"), and with a possessive ("Hallie's").
 *
 * @mutate src/lib/nextStepWords.ts |   return !!otherWord && lineWord === otherWord; |   return !!otherWord && line === otherFirst;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | isPoster && noShowLead ? youStep(posterStatusLine(job as unknown as Job, pending, undefined, undefined, false, helperFirst).detail, helperFirst) | isPoster && noShowLead ? { who: "you", text: posterStatusLine(job as unknown as Job, pending, undefined, undefined, false, helperFirst).detail }
 */
import { describe, expect, it } from "vitest";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { readFileSync } from "node:fs";
import { nextStepWords, youStep } from "@/lib/nextStepWords";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const p = (next: string) => ({ stage: 4, waitingOnYou: true, tone: "progress", word: "On the way", next, held: false }) as unknown as JobProgressState;

const NAMES = ["Hallie", "Hallie H.", "Hallie Hart", " Hallie H. "];
const LINES = ["Hallie didn't show up", "Hallie's work is ready to approve", "Hallie is 20 min late and hasn't set out"];

describe("a step line that starts with the other person's name keeps its capital", () => {
  let checked = 0;
  for (const otherFirst of NAMES) {
    for (const line of LINES) {
      it(`${JSON.stringify(otherFirst)}: ${line}`, () => {
        const step = jobNextStep(p(line), { side: "poster", otherFirst });
        expect(step).not.toBeNull();
        const words = nextStepWords(step!);
        expect(words, `"${words}" lowercased the name`).toMatch(/\bHallie/);
        expect(words).not.toMatch(/\bhallie/);
        checked++;
      });
    }
  }
  it("covers every name form", () => expect(checked).toBeGreaterThan(10));

  it("the job page's no-show line goes through youStep, never a hand-built 'you' step", () => {
    const code = readFileSync("src/pages/jobs/jobPage/JobPage.tsx", "utf8");
    expect(code).toMatch(/noShowLead \? youStep\(posterStatusLine\(/);
    for (const otherFirst of NAMES) expect(nextStepWords(youStep("Hallie didn't show up", otherFirst))).toBe("Next: Hallie didn't show up");
  });

  it("a line that does not start with the name is still one sentence ('Next: confirm …')", () => {
    const step = jobNextStep(p("Confirm it's still on"), { side: "poster", otherFirst: "Hallie H." });
    expect(nextStepWords(step!)).toMatch(/confirm it's still on/);
  });
});
