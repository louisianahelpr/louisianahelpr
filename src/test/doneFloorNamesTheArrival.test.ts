/**
 * The 30-minute "Mark done" floor counts from the Helpr's own arrival, and every
 * line that explains it says so (audit 2026-10-28, Part 4 half 2, F12). The
 * server's floor was COALESCE(poster_confirmed_working_at, helper_arrived_at), so
 * a poster's late "Confirm they're working" restarted it while the card said
 * "30 minutes after arrival"; migration 20261029042735_done_floor_from_arrival
 * makes it LEAST (the earlier stamp; in practice the arrival). The client rule is
 * one function, doneFloorStart, and the copy names the arrival.
 *
 * @mutate src/lib/doneFloor.ts |   return stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)); |   return stamps[0];
 * @mutate src/pages/jobs/appliedJobCard/ActiveJobSection.tsx |     const workingStart = doneFloorStart(job.poster_confirmed_working_at, job.helper_arrived_at); |     const workingStart = job.poster_confirmed_working_at ?? job.helper_arrived_at;
 * @mutate src/lib/doneFloor.ts | 30 minutes after you arrived, to ensure quality. | 30 minutes after work started, to ensure quality.
 * @mutate src/pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx | {doneFloorNote(minutesLeft)} | Available in {minutesLeft} min, 30 minutes after work started, to ensure quality.
 * @mutate src/lib/lifecycleErrors.ts |     completion_min_work_time: "You can mark it done 30 minutes after you arrived.", |     completion_min_work_time: "A job can't be marked done within 30 minutes of starting.",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doneFloorStart } from "@/lib/doneFloor";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("the done floor counts from the arrival (F12)", () => {
  const ARRIVED = "2026-10-28T15:00:00.000Z";
  const POSTER_LATE = "2026-10-28T15:40:00.000Z";

  it("doneFloorStart takes the earlier stamp, so a late poster tap never moves it", () => {
    expect(doneFloorStart(POSTER_LATE, ARRIVED)).toBe(ARRIVED);
    expect(doneFloorStart(ARRIVED, POSTER_LATE)).toBe(ARRIVED);
    expect(doneFloorStart(null, ARRIVED)).toBe(ARRIVED);
    expect(doneFloorStart(POSTER_LATE, null)).toBe(POSTER_LATE);
    expect(doneFloorStart(null, undefined)).toBeNull();
  });

  it("every client copy of the floor reads doneFloorStart, none the old `??` rule", () => {
    const users = [
      "src/components/JobTracking.tsx",
      "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx",
      "src/lib/crewLifecycle.ts",
    ];
    for (const f of users) {
      const src = code(f);
      expect(src, f).toMatch(/doneFloorStart\(/);
      expect(src, f).not.toMatch(/(poster_confirmed_working_at|posterConfirmedWorkingAt) \?\? (\w+\.)?(helper_arrived_at|arrivedAt)/);
    }
    expect(users.length).toBeGreaterThan(2);
  });

  it("the unlock lines and the refusal copy name the arrival", () => {
    expect(code("src/lib/doneFloor.ts")).toContain("30 minutes after you arrived, to ensure quality.");
    expect(code("src/pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx")).toContain("{doneFloorNote(minutesLeft)}");
    expect(code("src/pages/jobs/appliedJobCard/CrewMemberSection.tsx")).toContain("30 minutes after you arrived, to ensure quality.");
    expect(rpcErrorMessage("rpc_helper_mark_done", { message: "completion_min_work_time" })).toBe("You can mark it done 30 minutes after you arrived.");
    expect(code("src/lib/crewLifecycle.ts")).toContain("You can mark your part done 30 minutes after you arrived.");
  });

  it("the server's newest floor is LEAST in all three functions", () => {
    const sql = readFileSync(resolve(ROOT, "supabase/migrations/20261029042735_done_floor_from_arrival.sql"), "utf8");
    expect(sql.match(/LEAST\((OLD|NEW|v_job)\.poster_confirmed_working_at, \1\.helper_arrived_at\) IS NOT NULL/g)?.length).toBe(3);
    expect(sql).not.toMatch(/COALESCE\((OLD|NEW|v_job)\.poster_confirmed_working_at/);
  });
});
