/**
 * A3-32 (audit 11-01): THE POSTER'S CREW LINE NAMES THE NEXT STEP.
 *
 * The poster of a crew read "Your crew is booked. Each Helpr's step is under Your crew" 29 minutes before the start
 * with a member unconfirmed, "Waiting on your crew to finish" while a member's Confirm work sat on them, and "approve
 * your Helpr's work" (singular) at the end. crewPosterStep reads the roster in the order the poster acts; the page
 * passes it as the tracker's step (JobPage.test.tsx "a crew job"), and a crew's approval is plural (jobNextStep).
 *
 * @mutate src/components/tracker/crewPosterStep.ts |   if (arrived) return { who: "you", text: `Confirm ${first(arrived)} arrived` }; |
 * @mutate src/components/tracker/crewPosterStep.ts |   const done = hired.find((r) => r.helper_completed_at && !r.poster_confirmed_completion_at); |   const done = hired.find((r) => r.helper_completed_at);
 * @mutate src/components/tracker/crewPosterStep.ts |   if (unconfirmed && start && now < start.getTime()) { |   if (unconfirmed) {
 * @mutate src/components/tracker/crewPosterStep.ts |   const hired = (roster ?? []).filter((r) => r.status === "accepted"); |   const hired = roster ?? [];
 * @mutate src/components/tracker/jobNextStep.ts | text: o.crew ? t("ns.approveCrew") : other ? | text: other ?
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | approveLeft, crew: job.is_group_job === true }); | approveLeft });
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     crewNames: job.is_group_job ? helperNames : undefined, |     crewNames: undefined,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { crewPosterStep, type CrewRosterRow } from "@/components/tracker/crewPosterStep";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const YUSEF = "11111111-1111-1111-1111-111111111111";
const MARCUS = "22222222-2222-2222-2222-222222222222";
const names = { [YUSEF]: "Yusef H.", [MARCUS]: "Marcus T." };
const m = (id: string, over: Partial<CrewRosterRow> = {}): CrewRosterRow => ({
  helper_id: id, status: "accepted", helper_confirmed_at: "t", helper_arrived_at: null, poster_confirmed_arrival_at: null,
  helper_completed_at: null, poster_confirmed_completion_at: null, ...over,
});
// Thu 2037-10-22 9:00 AM Louisiana (14:00Z); "now" is 29 minutes before it.
const job = { date_needed: "2037-10-22", start_time: "09:00" };
const BEFORE = Date.parse("2037-10-22T13:31:00Z");
const AFTER = Date.parse("2037-10-22T15:00:00Z");

describe("A3-32: the crew's next step, from the roster", () => {
  it("before the start: waiting on the member who hasn't confirmed, by the start", () => {
    expect(crewPosterStep([m(YUSEF), m(MARCUS, { helper_confirmed_at: null })], names, job, BEFORE)).toEqual({
      who: "them", text: "Waiting on Marcus to confirm their spot", by: "by Thu 9:00 AM",
    });
    // Past the start that wait is over: the tracker keeps its own words.
    expect(crewPosterStep([m(YUSEF), m(MARCUS, { helper_confirmed_at: null })], names, job, AFTER)).toBeNull();
  });

  it("under way: a member waiting on the poster's arrival confirm comes first, then a member's work", () => {
    const arrived = m(YUSEF, { helper_arrived_at: "t" });
    const done = m(MARCUS, { helper_arrived_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "t" });
    expect(crewPosterStep([done, arrived], names, job, AFTER)).toEqual({ who: "you", text: "Confirm Yusef arrived" });
    expect(crewPosterStep([done, m(YUSEF)], names, job, AFTER)).toEqual({ who: "you", text: "Confirm Marcus's work" });
    // Work confirmed: nothing of the poster's left on that member.
    expect(crewPosterStep([{ ...done, poster_confirmed_completion_at: "t" }, m(YUSEF)], names, job, AFTER)).toBeNull();
  });

  it("only hired members count, and an empty roster says nothing", () => {
    expect(crewPosterStep([m(MARCUS, { status: "pending", helper_confirmed_at: null })], names, job, BEFORE)).toBeNull();
    expect(crewPosterStep([], names, job, BEFORE)).toBeNull();
    expect(crewPosterStep(undefined, names, job, BEFORE)).toBeNull();
  });

  it("a crew's approval is plural; a one-Helpr job keeps the name", () => {
    const p = { stage: 7, waitingOnYou: true, tone: "progress", word: "Done", next: "x", held: false } as unknown as JobProgressState;
    expect(jobNextStep(p, { side: "poster", crew: true })?.text).toBe("Approve your crew's work");
    expect(jobNextStep(p, { side: "poster", otherFirst: "Yusef" })?.text).toBe("Approve Yusef's work");
  });

  it("the page wires it: the tracker reads the crew flag, and the flows hand the roster's names", () => {
    const parts = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPageParts.tsx"), "utf8");
    expect(parts).toMatch(/approveLeft, crew: job\.is_group_job === true \}\)/);
    const flows = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/usePosterPageFlows.tsx"), "utf8");
    expect(flows).toMatch(/crewNames: job\.is_group_job \? helperNames : undefined,/);
  });
});
