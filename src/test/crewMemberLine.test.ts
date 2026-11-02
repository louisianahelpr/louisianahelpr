/**
 * A3-33 (audit 11-01): A CREW MEMBER'S JOB PAGE SAYS THEIR OWN STEP.
 *
 * The member's page read only "confirmed" off the job row: checked in and waiting on the poster it said "You're on
 * the crew. Your spot is confirmed · Job time has arrived", and with the work already confirmed "With Dana for
 * approval", since the slot read never selected poster_confirmed_completion_at. crewMemberLine reads the member's
 * own row through crewMemberStep; the page passes it as the tracker's step (JobPage.test.tsx "A3-33").
 *
 * @mutate src/components/tracker/crewMemberLine.ts |       return { who: "them", text: `Waiting on ${poster} to confirm you arrived` }; |       return null;
 * @mutate src/components/tracker/crewMemberLine.ts |       return slot.poster_confirmed_completion_at |       return false
 * @mutate src/components/tracker/crewMemberLine.ts |       return { who: "you", text: "Mark your part done when you finish" }; |       return null;
 * @mutate src/pages/jobs/appliedJobCard/CrewMemberSection.tsx |         : "Your part is done. The person who posted this job confirms your work next.", |         : "Your part is done. The job is finished once every crew member marks theirs.",
 * @mutate src/lib/crewLifecycle.ts | proof_before_urls, proof_after_urls, poster_confirmed_completion_at"; | proof_before_urls, proof_after_urls";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { crewMemberLine } from "@/components/tracker/crewMemberLine";
import { CREW_SLOT_COLUMNS } from "@/lib/crewLifecycle";

const s = (over: Record<string, string | null> = {}) => ({
  helper_confirmed_at: "t", helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_arrival_at: null,
  helper_completed_at: null, poster_confirmed_completion_at: null, ...over,
});

describe("A3-33: the member's own step", () => {
  it("each step of their own row, in the page's words", () => {
    expect(crewMemberLine(s({ helper_confirmed_at: null }), "accepted", "Dana")).toBeNull();
    expect(crewMemberLine(s(), "open", "Dana")?.text).toBe("You're on the crew. Waiting for the rest of the crew to be hired");
    expect(crewMemberLine(s(), "accepted", "Dana")).toEqual({ who: "you", text: "Tap I'm on my way when you leave" });
    expect(crewMemberLine(s({ helper_on_the_way_at: "t" }), "accepted", "Dana")).toEqual({ who: "you", text: "Tap I've arrived when you get there" });
    expect(crewMemberLine(s({ helper_on_the_way_at: "t", helper_arrived_at: "t" }), "in_progress", "Dana")).toEqual({ who: "them", text: "Waiting on Dana to confirm you arrived" });
    expect(crewMemberLine(s({ helper_arrived_at: "t", poster_confirmed_arrival_at: "t" }), "in_progress", "Dana")).toEqual({ who: "you", text: "Mark your part done when you finish" });
    expect(crewMemberLine(s({ helper_arrived_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "t" }), "in_progress", "Dana"))
      .toEqual({ who: "them", text: "You marked your part done. Waiting on Dana to confirm your work" });
    expect(crewMemberLine(s({ helper_arrived_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "t", poster_confirmed_completion_at: "t" }), "in_progress", "Dana"))
      .toEqual({ who: "info", text: "Dana confirmed your work" });
    expect(crewMemberLine(null, "in_progress", "Dana")).toBeNull();
  });

  it("the slot read selects the poster's work confirm, so the member can see it", () => {
    expect(CREW_SLOT_COLUMNS.split(",").map((c) => c.trim())).toContain("poster_confirmed_completion_at");
  });

  it("the member's card no longer says the job finishes when every member marks theirs (per-member pay, JOBS-3)", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/appliedJobCard/CrewMemberSection.tsx"), "utf8"));
    expect(src).not.toContain("once every crew member marks theirs");
    expect(src).toContain("The person who posted this job confirms your work next.");
    expect(src).toContain("Your work is confirmed. Your pay goes out on its own.");
  });
});
