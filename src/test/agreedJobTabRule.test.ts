/**
 * Owner, 2026-10-08 (Q1574): "move it to scheduled once accepted but then back
 * to needs you when the 24 hour countdown opens. once confirmed, back to
 * scheduled. once it starts move to needs you." Per side: each side's tab
 * follows THAT side's own confirmation.
 *
 * @mutate src/components/job-card/activityFilters.ts |   if (!confirmed && now.getTime() >= confirmOpensMs(j.date_needed)) return "confirm_owed"; |
 * @mutate src/components/job-card/activityFilters.ts |   if (start ? now.getTime() >= start.getTime() : jobIsLive(j)) return "started"; |
 */
import { describe, expect, it } from "vitest";
import { agreedJobStage } from "@/components/job-card/activityFilters";

// Job: Thu 2026-10-15 2:00 PM Central (19:00Z). The confirm window opens at
// midnight Central the day before: Wed 2026-10-14 05:00Z.
const job = { status: "accepted", date_needed: "2026-10-15", start_time: "14:00:00" };
const at = (iso: string) => new Date(iso);

describe("an agreed job's tab, per side", () => {
  it("accepted, window not open yet -> Scheduled for both", () => {
    expect(agreedJobStage(job, "poster", at("2026-10-13T12:00:00Z"))).toBe("scheduled");
    expect(agreedJobStage(job, "helper", at("2026-10-13T12:00:00Z"))).toBe("scheduled");
  });
  it("window open, not confirmed -> Needs You (that side)", () => {
    expect(agreedJobStage(job, "poster", at("2026-10-14T06:00:00Z"))).toBe("confirm_owed");
    expect(agreedJobStage(job, "helper", at("2026-10-14T06:00:00Z"))).toBe("confirm_owed");
  });
  it("one side confirmed -> back to Scheduled for that side only", () => {
    const helperDone = { ...job, helper_dayof_confirmed_at: "2026-10-14T07:00:00Z" };
    expect(agreedJobStage(helperDone, "helper", at("2026-10-14T08:00:00Z"))).toBe("scheduled");
    expect(agreedJobStage(helperDone, "poster", at("2026-10-14T08:00:00Z"))).toBe("confirm_owed");
  });
  it("accepting does not count as confirming", () => {
    const accepted = { ...job, helper_confirmed_at: "2026-10-14T18:00:00Z" };
    expect(agreedJobStage(accepted, "helper", at("2026-10-14T19:00:00Z"))).toBe("confirm_owed");
  });
  it("the job starts (start time, or the Helpr heads out) -> Needs You", () => {
    const both = { ...job, poster_confirmed_at: "x", helper_dayof_confirmed_at: "y" };
    expect(agreedJobStage(both, "poster", at("2026-10-15T18:59:00Z"))).toBe("scheduled");
    expect(agreedJobStage(both, "poster", at("2026-10-15T19:00:00Z"))).toBe("started");
    expect(agreedJobStage({ ...both, helper_on_the_way_at: "z" }, "helper", at("2026-10-15T17:30:00Z"))).toBe("started");
  });
});
