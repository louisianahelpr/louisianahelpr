/**
 * Continue another day (owner 2026-11-01, Yusef's job): the label every notice and line uses, and the next-step line
 * both sides read while a job continues ("Continuing Thu, Nov 5 at 9:00 AM · waiting on Yusef"). The server's own words
 * (continue_day_label, migration 20261101231015) are proven in src/test/pglite/jobContinueDay.pglite.mjs.
 *
 * @mutate src/lib/continueDayWords.ts | { who: "them", text: `${other \|\| "Your Helpr"} comes back ${when}`, by: `nothing for you to do; ${other \|\| "your Helpr"} confirms next` }; | null;
 * @mutate src/lib/continueDayWords.ts | ${h12}:${String(mm \|\| 0).padStart(2, "0")} ${hh < 12 | ${h12} ${hh < 12
 * @mutate src/lib/continueDayWords.ts |       ? { who: "you", text: `Confirm ${other ? `${other}'s` : "your Helpr's"} new day`, by: when } |       ? null
 * @mutate src/lib/continueDayWords.ts |       ? { who: "info", text: `${other \|\| "Your Helpr"} confirmed ${when}` } |       ? { who: "them", text: `Continuing ${when}`, by: `waiting on ${other \|\| "your Helpr"} to confirm` }
 */
import { describe, it, expect } from "vitest";
import { continueDayError, continueDayLabel, continueDayNextStep, type ContinueDay } from "./continueDay";
import { nextStepWords } from "@/components/ui/NextStep";

const row = (over: Partial<ContinueDay> = {}): ContinueDay => ({
  id: "c1", job_id: "j1", proposed_by: "h1", new_date: "2026-11-05", new_start_time: "09:00:00", note: null,
  status: "set", helper_confirmed_at: null, ...over,
});

describe("continueDayLabel", () => {
  it("reads in the house date style: Thu, Nov 5 at 9:00 AM (F175), minutes always shown", () => {
    expect(continueDayLabel("2026-11-05", "09:00:00")).toBe("Thu, Nov 5 at 9:00 AM");
    expect(continueDayLabel("2026-11-05", "13:30")).toBe("Thu, Nov 5 at 1:30 PM");
    expect(continueDayLabel("2026-11-08", "00:00")).toBe("Sun, Nov 8 at 12:00 AM");
    expect(continueDayLabel("2026-11-08", "12:15")).toBe("Sun, Nov 8 at 12:15 PM");
  });
});

describe("continueDayNextStep", () => {
  it("both sides see the set day; the poster waits on the Helpr by name", () => {
    expect(nextStepWords(continueDayNextStep(row(), { side: "poster", otherFirst: "Yusef" })!)).toBe("Yusef comes back Thu, Nov 5 at 9:00 AM · nothing for you to do; Yusef confirms next"); // F289a
    // Auditor 11 (11-01): once the Helpr confirms, the poster's line says so.
    expect(nextStepWords(continueDayNextStep(row({ helper_confirmed_at: "2026-11-02T12:00:00Z" }), { side: "poster", otherFirst: "Yusef" })!)).toBe("Yusef confirmed Thu, Nov 5 at 9:00 AM");
    expect(nextStepWords(continueDayNextStep(row(), { side: "helpr", otherFirst: "Dana" })!)).toBe("Next: confirm you'll be there · continuing Thu, Nov 5 at 9:00 AM");
    expect(nextStepWords(continueDayNextStep(row({ helper_confirmed_at: "2026-11-05T12:00:00Z" }), { side: "helpr", otherFirst: "Dana" })!))
      .toBe("You're set for Thu, Nov 5 at 9:00 AM · mark it done when you finish");
  });

  it("a Helpr's ask is the poster's move (one tap), and the Helpr waits on them", () => {
    const asked = row({ status: "proposed" });
    expect(nextStepWords(continueDayNextStep(asked, { side: "poster", otherFirst: "Yusef" })!)).toBe("Next: confirm Yusef's new day · Thu, Nov 5 at 9:00 AM");
    expect(nextStepWords(continueDayNextStep(asked, { side: "helpr", otherFirst: "Dana" })!)).toBe("You asked to finish Thu, Nov 5 at 9:00 AM · waiting on Dana");
  });

  it("no active day: no line of its own (the tracker's stands)", () => {
    expect(continueDayNextStep(null, { side: "poster" })).toBeNull();
  });
});

describe("continueDayError", () => {
  it("says every server refusal in plain words, never a code", () => {
    expect(continueDayError({ message: "continue_day_too_soon" })).toBe("Pick a time at least an hour from now.");
    expect(continueDayError({ message: "not_authorized" })).toMatch(/posted this job or its Helpr/);
    expect(continueDayError({ message: "something else" })).toBeNull();
  });
});

/**
 * A3-115 (Auditor 11, 11-01): "done" before the day set to finish came back as "Couldn't mark the job complete — try
 * again?" and was reported to Sentry. It now has its sentence and is an expected refusal.
 * @mutate src/lib/lifecycleErrorCopy.ts |   continue_day_ahead: "You can mark it done on the day you set to finish.", |   continue_day_ahead_x: "",
 * @mutate src/lib/lifecycleErrors.ts | const EXPECTED_REFUSALS = ["dispute_settlement_in_progress", "continue_day_ahead", | const EXPECTED_REFUSALS = ["dispute_settlement_in_progress",
 */
describe("continue_day_ahead (A3-115)", () => {
  it("says when it can be done, and is not reported as a defect", async () => {
    const { lifecycleErrorMessage, isExpectedLifecycleRefusal } = await import("@/lib/lifecycleErrors");
    const err = { message: "continue_day_ahead", hint: "This job continues on Thu 11/5." };
    expect(lifecycleErrorMessage(err)).toBe("You can mark it done on the day you set to finish.");
    expect(isExpectedLifecycleRefusal(err)).toBe(true);
  });
});
