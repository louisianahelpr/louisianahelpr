/**
 * Continue another day (owner 2026-11-01, Yusef's job): the label every notice and line uses, and the next-step line
 * both sides read while a job continues ("Continuing Thu 11/5 at 9 AM · waiting on Yusef"). The server's own words
 * (continue_day_label, migration 20261101231015) are proven in src/test/pglite/jobContinueDay.pglite.mjs.
 *
 * @mutate src/lib/continueDayWords.ts |       : { who: "them", text: `Continuing ${when}`, by: `waiting on ${other \|\| "your Helpr"} to confirm` }; |       : null;
 * @mutate src/lib/continueDayWords.ts |   const clock = mm ? `${h12}:${String(mm).padStart(2, "0")}` : `${h12}`; |   const clock = `${h12}:${String(mm).padStart(2, "0")}`;
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
  it("reads like the owner's words: Thu 11/5 at 9 AM, with minutes only when they are not :00", () => {
    expect(continueDayLabel("2026-11-05", "09:00:00")).toBe("Thu 11/5 at 9 AM");
    expect(continueDayLabel("2026-11-05", "13:30")).toBe("Thu 11/5 at 1:30 PM");
    expect(continueDayLabel("2026-11-08", "00:00")).toBe("Sun 11/8 at 12 AM");
    expect(continueDayLabel("2026-11-08", "12:15")).toBe("Sun 11/8 at 12:15 PM");
  });
});

describe("continueDayNextStep", () => {
  it("both sides see the set day; the poster waits on the Helpr by name", () => {
    expect(nextStepWords(continueDayNextStep(row(), { side: "poster", otherFirst: "Yusef" })!)).toBe("Continuing Thu 11/5 at 9 AM · waiting on Yusef to confirm");
    // Auditor 11 (11-01): once the Helpr confirms, the poster's line says so.
    expect(nextStepWords(continueDayNextStep(row({ helper_confirmed_at: "2026-11-02T12:00:00Z" }), { side: "poster", otherFirst: "Yusef" })!)).toBe("Yusef confirmed Thu 11/5 at 9 AM");
    expect(nextStepWords(continueDayNextStep(row(), { side: "helpr", otherFirst: "Dana" })!)).toBe("Next: confirm you'll be there · continuing Thu 11/5 at 9 AM");
    expect(nextStepWords(continueDayNextStep(row({ helper_confirmed_at: "2026-11-05T12:00:00Z" }), { side: "helpr", otherFirst: "Dana" })!))
      .toBe("You're set for Thu 11/5 at 9 AM · mark it done when you finish");
  });

  it("a Helpr's ask is the poster's move (one tap), and the Helpr waits on them", () => {
    const asked = row({ status: "proposed" });
    expect(nextStepWords(continueDayNextStep(asked, { side: "poster", otherFirst: "Yusef" })!)).toBe("Next: confirm Yusef's new day · Thu 11/5 at 9 AM");
    expect(nextStepWords(continueDayNextStep(asked, { side: "helpr", otherFirst: "Dana" })!)).toBe("You asked to finish Thu 11/5 at 9 AM · waiting on Dana");
  });

  it("no active day: no line of its own (the tracker's stands)", () => {
    expect(continueDayNextStep(null, { side: "poster" })).toBeNull();
  });
});

describe("continueDayError", () => {
  it("says every server refusal in plain words, never a code", () => {
    expect(continueDayError({ message: "continue_day_too_soon" })).toBe("Pick a time at least an hour from now.");
    expect(continueDayError({ message: "not_authorized" })).toMatch(/two people/);
    expect(continueDayError({ message: "something else" })).toBeNull();
  });
});
