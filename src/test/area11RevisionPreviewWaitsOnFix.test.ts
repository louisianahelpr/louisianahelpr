// Area 11 M2 (11-18): the "Fix asked for" stage preview read "Next: approve Eli's work" with Approve primary while the
// fix was still owed. The real request (create-payment request_revision) stamps revision_requested_at; the sample did
// not, so the page timed the first "done". With the stamp, the tracker waits on the fix with its due time.
//
// @mutate src/pages/admin/preview/jobPreviewSamples.ts |         revision_requested_at: ago(60), |
import { describe, expect, it } from "vitest";
import { previewSample } from "@/pages/admin/preview/jobPreviewSamples";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { approveDeadlineMs } from "@/pages/jobs/jobPage/reviewTimeLeft";

describe("the Fix asked for preview waits on the fix (area 11 M2)", () => {
  it("poster: 'Waiting on Eli's fix' with its due time, and no approve clock", () => {
    const s = previewSample("revision", "poster", Date.parse("2026-11-18T12:00:00Z"));
    const job = s.job as never;
    const p = jobProgress(job, { viewer: "poster", otherFirst: "Eli", trackingStatus: s.trackingStatus } as never);
    expect(p.next).toMatch(/^Waiting on Eli's fix by /);
    expect(p.waitingOnYou).toBe(false);
    expect(approveDeadlineMs(job)).toBeNull();
    expect(Object.keys(s.job).length).toBeGreaterThan(10);
  });
});
