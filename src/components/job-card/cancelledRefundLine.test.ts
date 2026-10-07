/**
 * The poster's cancelled line says their money came back, only when it did
 * (owner, 2026-10-06).
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   if (job.payment_status !== "refunded") return reason; |   if (false) return reason;
 * @mutate src/components/job-card/jobStatusLine.ts |     suffix: id === "cancelled" ? cancelledSuffix(job) : null, |     suffix: id === "cancelled" ? sanitizeCancellationReason(job.cancellation_reason) : null,
 */
import { describe, expect, it } from "vitest";
import { cancelledSuffix, posterStatusLine } from "./jobStatusLine";
import type { Job } from "./activityConstants";

const base = { status: "cancelled", cancellation_reason: "Job listing expired — scheduled time passed with no Helpr assigned" } as unknown as Job;

describe("cancelled line and refunds", () => {
  it("adds 'Your payment was refunded' only for a refunded job", () => {
    expect(cancelledSuffix({ ...base, payment_status: "refunded" } as Job)).toMatch(/· Your payment was refunded$/);
    expect(cancelledSuffix({ ...base, payment_status: "unpaid" } as Job)).not.toMatch(/refunded/);
  });
  it("the poster's status line carries it", () => {
    const line = posterStatusLine({ ...base, payment_status: "refunded" } as Job, 0);
    expect(line.suffix).toMatch(/Your payment was refunded/);
  });
});
