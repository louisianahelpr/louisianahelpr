/**
 * Q2673 (audit 1102e row 5): the Helpr's own job page after they cancelled showed their pay in the header, then "You
 * cancelled this job · The street address is shared once you're offered the job.": no time, no word about the strike,
 * and an address line that makes no sense for a job they gave up (helper_cancel_booking reopens it, so the page took
 * it for a plain open listing). Now it says when, and that a cancel under 24 hours before the start is a strike
 * (is_late_cancellation, helper_cancel_booking), with no pay and no address line.
 *
 * @mutate src/pages/jobs/jobPage/viewerState.ts |   const late = !!start && start.getTime() - atMs < 24 * 3_600_000; |   const late = false;
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | .select("status, closed_reason, updated_at").eq("job_id", jobId).eq("helper_id", userId) | .select("status, closed_reason").eq("job_id", jobId).eq("helper_id", userId)
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | ((!party && !open) \|\| cancelledByMe); | (!party && !open);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobPageViewerState } from "@/pages/jobs/jobPage/viewerState";
import { blankComments } from "@/test/helpers/blankNonCode";

const job = { status: "open", helper_id: null, date_needed: "2037-10-20", start_time: "09:00" };
const view = (updated_at: string | null) =>
  jobPageViewerState({ isPoster: false, userId: "me", posterFirst: "Lexi", job, myApplication: { status: "rejected", closed_reason: "helper_cancelled", updated_at } });

describe("the Helpr's own page after they cancelled (Q2673)", () => {
  it("under 24 hours before the start: the time and the strike", () => {
    // Start Tue 9:00 AM (Louisiana). Tue 6:00 AM is 3 h before (a strike); Mon 6:00 AM is 27 h before (none).
    expect(view("2037-10-20T11:00:00Z").status).toBe("You cancelled Tue 6:00 AM, under 24 hours before the start, so it counts as a strike");
    expect(view("2037-10-19T11:00:00Z").status).toBe("You cancelled Mon 6:00 AM");
    expect(view(null).status).toBe("You cancelled this job");
    expect(view("2037-10-20T11:00:00Z").action.kind).toBe("none");
  });

  it("the page reads the close time and treats the job as closed to them: no pay, no address line", () => {
    const hook = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    expect(hook).toContain('.select("status, closed_reason, updated_at").eq("job_id", jobId).eq("helper_id", userId)');
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(page).toMatch(/const cancelledByMe = myApplication\.data\?\.status === "rejected" && myApplication\.data\.closed_reason === "helper_cancelled";/);
    expect(page).toContain("((!party && !open) || cancelledByMe);");
    // closedToMe already hides the price, the money notes and the address line (Q2595).
    expect(page).toContain("const helprPrice = isPoster || closedToMe ? null :");
    expect(page).toMatch(/!isPoster && !isHired && !closedToMe && !instantUntil && viewer\.action\.kind !== "see_offer" && <p[^>]*>The street address is shared/);
  });
});
