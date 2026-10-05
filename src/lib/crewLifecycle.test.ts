// Proof these can fail: a crew member whose crew is still filling is told to
// set out, and a live crew job falls back to the single-Helpr offer card.
// @mutate src/lib/crewLifecycle.ts | if (jobStatus === "open") return "waiting_for_crew"; | if (jobStatus === "open") return "set_out";
// @mutate src/pages/jobs/appliedJobCard/appliedJobCardHelpers.ts | const isOffered = isDirectOffer \|\| (!isCrewLive && isAssigned && !job.helper_confirmed_at); | const isOffered = isDirectOffer \|\| (isAssigned && !job.helper_confirmed_at);
import { describe, it, expect } from "vitest";
import { crewMemberStatusLabel, crewMemberStep, crewMinutesUntilDone, withCrewSlotStamps } from "./crewLifecycle";
import { deriveAppliedJobCardState } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const blank = {
  helper_confirmed_at: null,
  helper_on_the_way_at: null,
  helper_arrived_at: null,
  poster_confirmed_arrival_at: null,
  helper_completed_at: null,
};
const T = "2026-10-05T18:00:00Z";

describe("a crew member's step is read off their own roster row (Q1382)", () => {
  it("walks confirm -> set out -> arrive -> awaiting poster -> finish -> done", () => {
    expect(crewMemberStep(blank, "accepted")).toBe("confirm");
    expect(crewMemberStep({ ...blank, helper_confirmed_at: T }, "open")).toBe("waiting_for_crew");
    expect(crewMemberStep({ ...blank, helper_confirmed_at: T }, "accepted")).toBe("set_out");
    expect(crewMemberStep({ ...blank, helper_confirmed_at: T, helper_on_the_way_at: T }, "in_progress")).toBe("arrive");
    const arrived = { ...blank, helper_confirmed_at: T, helper_on_the_way_at: T, helper_arrived_at: T };
    expect(crewMemberStep(arrived, "in_progress")).toBe("awaiting_poster");
    expect(crewMemberStep({ ...arrived, poster_confirmed_arrival_at: T }, "in_progress")).toBe("finish");
    expect(crewMemberStep({ ...arrived, poster_confirmed_arrival_at: T, helper_completed_at: T }, "in_progress")).toBe("done");
  });

  it("labels each member for the poster's roster", () => {
    expect(crewMemberStatusLabel(blank)).toBe("Not confirmed yet");
    expect(crewMemberStatusLabel({ ...blank, helper_confirmed_at: T, helper_arrived_at: T })).toBe("Arrived");
    expect(crewMemberStatusLabel({ ...blank, poster_confirmed_arrival_at: T })).toBe("Working");
  });

  it("the 30-minute floor counts from the poster's working confirm, else the arrival", () => {
    const now = Date.parse(T);
    expect(crewMinutesUntilDone({ poster_confirmed_working_at: T, helper_arrived_at: null }, now)).toBe(30);
    expect(crewMinutesUntilDone({ poster_confirmed_working_at: null, helper_arrived_at: T }, now + 31 * 60_000)).toBe(0);
  });

  it("the member's view of the job carries their stamps, not the job's", () => {
    const job = { helper_confirmed_at: null, helper_arrived_at: "x" } as unknown as Job;
    const slot = { ...blank, helper_confirmed_at: T, helper_arrival_verified_at: null, poster_confirmed_working_at: null } as never;
    const v = withCrewSlotStamps(job, slot) as Job;
    expect(v.helper_confirmed_at).toBe(T);
    expect(v.helper_arrived_at).toBeNull();
  });

  it("a live crew job routes to the crew section, never the single-Helpr offer card", () => {
    const job = { status: "accepted", is_group_job: true, helper_confirmed_at: null, budget: 200 } as unknown as Job;
    const app = { job_id: "j", helper_id: "h", status: "accepted", job } as unknown as AppliedApp;
    const s = deriveAppliedJobCardState(app, job, new Set(), new Set());
    expect(s.isCrewLive).toBe(true);
    expect(s.isOffered).toBe(false);
    expect(s.isConfirmed).toBe(false);
    expect(s.isActive).toBe(false);
    expect(s.hasActionSection).toBe(true);
    const single = deriveAppliedJobCardState({ ...app, job: { ...job, is_group_job: false } } as AppliedApp, { ...job, is_group_job: false }, new Set(), new Set());
    expect(single.isCrewLive).toBe(false);
    expect(single.isOffered).toBe(true);
  });
});
