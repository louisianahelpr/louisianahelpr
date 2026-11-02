/**
 * A3-51 (audit 11-01): ON THE WORKING TAB A CREW MEMBER WAS TOLD "Confirm you'll be at the job · Confirm window passed".
 *
 * A crew owes no day-of confirm: crewMemberStep (src/lib/crewLifecycle.ts) has none, the roster slot carries no
 * helper_dayof_confirmed_at, and the start sweep sets owes_dayof false for every crew member (20261030035326). But
 * CrewStatusStrip feeds helperStatusLine the job with the member's slot stamps, and agreedJobStage read the missing
 * day-of stamp as owed, so from the day before until the start the card sat in Needs you asking for a step with no
 * button behind it. A confirmed crew member in that window is scheduled; a one-Helpr job still owes the confirm.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |       if (stage === "confirm_owed") return job.is_group_job ? "confirmed" : "confirm_day"; |       if (stage === "confirm_owed") return "confirm_day";
 * @mutate src/components/job-card/activityFilters.ts |     return stage === "scheduled" \|\| (stage === "confirm_owed" && app.job?.is_group_job === true) ? "scheduled" : "needs_you"; |     return stage === "scheduled" ? "scheduled" : "needs_you";
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import { appliedActivityBucket } from "@/components/job-card/activityFilters";
import { withCrewSlotStamps, crewMemberStep, type CrewSlot } from "@/lib/crewLifecycle";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

// Wed 2037-10-21 10:00 AM Louisiana; the job is Thu 9:00 AM, so the day-before confirm window is open.
const NOW = new Date("2037-10-21T15:00:00Z");
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

const base = { id: "j", status: "accepted", customer_id: "p", date_needed: "2037-10-22", start_time: "09:00:00", payment_status: "escrow" };
const slot: CrewSlot = {
  id: "s", job_id: "j", helper_id: "me", status: "accepted", helper_confirmed_at: "2037-10-20T12:00:00Z", helper_on_the_way_at: null,
  helper_arrived_at: null, helper_arrival_verified_at: null, poster_confirmed_arrival_at: null, poster_confirmed_working_at: null,
  helper_completed_at: null, proof_before_urls: null, proof_after_urls: null,
};
const app = (job: Record<string, unknown>): AppliedApp => ({ id: "a", job_id: "j", helper_id: "me", status: "accepted", closed_reason: null, job: job as unknown as Job }) as unknown as AppliedApp;

describe("A3-51: a confirmed crew member owes no day-of confirm", () => {
  it("the crew card is scheduled in the day-before window: no confirm line, no confirm clock, not Needs you", () => {
    const crewJob = withCrewSlotStamps({ ...base, is_group_job: true, helper_id: null } as unknown as Job, slot);
    const line = helperStatusLine(app(crewJob as unknown as Record<string, unknown>));
    expect(line.id).toBe("confirmed");
    expect(line.detail).not.toMatch(/Confirm you'll be at the job/);
    expect(line.deadline).toBeNull();
    expect(appliedActivityBucket(app(crewJob as unknown as Record<string, unknown>))).toBe("scheduled");
    // The member's real step, from their own slot: set out.
    expect(crewMemberStep(slot, "accepted")).toBe("set_out");
  });

  it("a one-Helpr job in the same window still owes the confirm (the floor)", () => {
    const solo = { ...base, is_group_job: false, helper_id: "me", helper_confirmed_at: "2037-10-20T12:00:00Z", helper_dayof_confirmed_at: null };
    const line = helperStatusLine(app(solo));
    expect(line.id).toBe("confirm_day");
    expect(line.deadline).toMatchObject({ source: "confirm_deadline" });
    expect(appliedActivityBucket(app(solo))).toBe("needs_you");
  });
});
