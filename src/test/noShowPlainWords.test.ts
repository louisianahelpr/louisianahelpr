/**
 * F272 (whole-app audit 11-10, Job page, confirmed for today): past the start with no on-the-way and no arrival, the
 * header said "Hallie hasn't checked in" (jargon) and the card's control read "No-Show" (title case). The line now says
 * what did not happen, "Hallie hasn't said they're on the way", and the control reads "No-show".
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   started_no_checkin: (n) => inLang("cl.pn.started_no_checkin", `${firstName(n)} hasn't said they're on the way`, { name: firstName(n) }), |   started_no_checkin: (n) => inLang("cl.pn.started_no_checkin", `${firstName(n)} hasn't checked in`, { name: firstName(n) }),
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx |             label="No-show" |             label="No-Show"
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { Job } from "@/components/job-card/activityConstants";

// A fixed past afternoon (2 PM in Louisiana) under fake time, so the job's day and start never drift.
const NOW = new Date("2024-06-10T19:00:00Z");

describe("F272: the late-start line and the no-show control use plain words", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("started, not on the way, not arrived: '<name> hasn't said they're on the way'", () => {
    const job = {
      id: "j272", status: "in_progress", helper_id: "h", customer_id: "p", payment_status: "escrow",
      date_needed: "2024-06-10", start_time: "11:00:00", helper_confirmed_at: "2024-06-09T15:00:00Z",
      helper_dayof_confirmed_at: "2024-06-09T16:00:00Z", poster_confirmed_at: "2024-06-09T16:00:00Z",
      helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_arrival_at: null, poster_confirmed_working_at: null,
    } as unknown as Job;
    const line = posterStatusLine(job, 0, NOW, undefined, false, "Hallie H.");
    expect(line.detail).toBe("Hallie hasn't said they're on the way");
  });

  it("the card's control reads No-show, in sentence case", () => {
    const src = blankComments(readFileSync("src/pages/posts/postedJobCard/steps/InProgressStep.tsx", "utf8"));
    expect(src).toContain('label="No-show"');
    expect(src).not.toMatch(/label="No-Show"/);
  });
});
