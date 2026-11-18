/**
 * Admin Jobs → Active (owner, 2026-10-09: "I only want to see the real jobs
 * that were paid and be able to click to see how many applicants"; test jobs in
 * their own Test tab). Prod 2026-10-09: 4 active of 36 job rows.
 */
// @mutate src/components/admin/adminJobs/adminJobsHelpers.ts |     job.is_seed !== true && |     true &&
// @mutate src/components/admin/adminJobs/adminJobsHelpers.ts | ["escrow", "payout_pending", "held"] | ["escrow", "payout_pending"]
import { describe, expect, it } from "vitest";
import { isActivePaidJob } from "./adminJobsHelpers";

const j = (status: string, payment_status: string, is_seed = false) => ({ status, payment_status, is_seed });

describe("isActivePaidJob", () => {
  it("counts real, paid, unfinished jobs", () => {
    expect(isActivePaidJob(j("open", "escrow"))).toBe(true);
    expect(isActivePaidJob(j("in_progress", "escrow"))).toBe(true);
    expect(isActivePaidJob(j("accepted", "escrow"))).toBe(true);
  });
  it("counts an open job whose card is on hold (design audit area 10 #1)", () => {
    expect(isActivePaidJob(j("open", "held"))).toBe(true);
    expect(isActivePaidJob(j("cancelled", "held"))).toBe(false);
    expect(isActivePaidJob(j("open", "held", true))).toBe(false);
  });
  it("leaves out unpaid, abandoned, refunded, finished and test jobs", () => {
    expect(isActivePaidJob(j("open", "unpaid"))).toBe(false);
    expect(isActivePaidJob(j("open", "abandoned"))).toBe(false);
    expect(isActivePaidJob(j("cancelled", "refunded"))).toBe(false);
    expect(isActivePaidJob(j("completed", "payout_pending"))).toBe(false);
    expect(isActivePaidJob(j("open", "escrow", true))).toBe(false);
  });
});
