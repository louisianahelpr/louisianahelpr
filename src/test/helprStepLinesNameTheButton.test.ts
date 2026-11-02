/**
 * A3-10 and A3-11 (audit 2026-11-01, the Helpr's job page): the "Next:" line named a status or other words than the
 * button under it.
 *   - On the way: "Next: you're on the way" over "I've arrived". Now "Tap I've arrived when you get there".
 *   - Arrived, not started: "Next: tap Start working" over the pair's "Start". Now "Tap Start when you begin".
 *   - Working: "Next: mark it done when you finish" over the pair's "Complete job". A3-10 made it "Complete the job";
 *     JA-56 (later, 11-01) then named the button "Mark it done" on every surface, so the line is "Mark it done when you
 *     finish" again and button and line agree (merge of the A3 stack, builder 166).
 * The button words are read from the real step list (job-card/trackerSteps.ts) and pairLabel, not retyped.
 *
 * @mutate src/components/tracker/jobProgressState.ts | : "Tap I've arrived when you get there", held); | : "You're on the way", held);
 * @mutate src/components/job-card/jobStatusLine.ts | start_working: { detail: "Tap Start when you begin", | start_working: { detail: "Tap Start working",
 * @mutate src/components/tracker/jobProgressState.ts | : "Mark it done when you finish", held); | : "Complete the job when you finish", held);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { STATUSES } from "@/components/JobTracking";
import { pairLabel } from "@/components/ui/pairLabel";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";

const ME = "11111111-1111-1111-1111-111111111111";
// 2024-10-30 is a CDT day. The job starts at 2:00 PM Central (19:00Z).
const row = (over: Partial<ProgressJob> = {}): ProgressJob => ({
  id: "j1", status: "in_progress", helper_id: ME, payment_status: "escrow", date_needed: "2024-10-30", start_time: "14:00:00",
  helper_confirmed_at: "2024-10-25T12:00:00Z", helper_dayof_confirmed_at: "2024-10-29T12:00:00Z", poster_confirmed_at: "2024-10-29T13:00:00Z",
  require_photo_proof: false,
  ...over,
});
const page = (j: ProgressJob, tracking: string | null = null) =>
  jobProgress(j, {
    viewer: "helpr",
    workUnderway: helperProgress(j as unknown as Job, tracking).workUnderway,
    tracking: tracking ? ({ status: tracking } as never) : null,
  });
const action = (key: string) => {
  const a = STATUSES.find((s) => s.key === key)?.action;
  expect(a, `step ${key} has an action`).toBeTruthy();
  return a as string;
};

describe("A3-10 / A3-11: the Helpr's next-step line names the button under it", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the real step list", () => {
    expect(STATUSES.length).toBeGreaterThan(6);
    expect(pairLabel(action("arrived"))).toBe("I've arrived");
    expect(pairLabel(action("working"))).toBe("Start");
  });

  it("on the way: the line says to tap I've arrived, never the status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:20:00Z"));
    const p = page(row({ helper_on_the_way_at: "2024-10-30T19:10:00Z" }));
    expect(p.stage).toBe(4);
    expect(p.next).toContain(`Tap ${pairLabel(action("arrived"))}`);
    expect(p.next).not.toMatch(/you're on the way/i);
  });

  it("arrived, not started: the line says to tap Start, the pair's word", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:20:00Z"));
    const p = page(row({ helper_on_the_way_at: "2024-10-30T19:00:00Z", helper_arrived_at: "2024-10-30T19:10:00Z", helper_arrival_verified_at: "2024-10-30T19:10:00Z" }), "arrived");
    expect(p.next).toBe(`Tap ${pairLabel(action("working"))} when you begin`);
  });

  it("working: the line says Mark it done, the button's one label (JA-56)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T20:00:00Z"));
    const p = page(row({ helper_on_the_way_at: "2024-10-30T19:00:00Z", helper_arrived_at: "2024-10-30T19:10:00Z", helper_arrival_verified_at: "2024-10-30T19:10:00Z", poster_confirmed_working_at: "2024-10-30T19:20:00Z" }), "working");
    const done = action("done");
    expect(done).toBe("Mark it done");
    expect(pairLabel(done)).toBe("Mark it done");
    expect(p.next).toBe("Mark it done when you finish");
    expect(p.next).not.toMatch(/complete/i);
  });
});
