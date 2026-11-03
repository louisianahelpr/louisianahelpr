/**
 * Q1916: the Helpr's cancelled-job line says "You received" only when their OWN fee row
 * (cancellation_fee_transfers, readable to them since 20261103021753) says paid. jobs.cancellation_fee_status is the
 * poster's charge: 'charged' there while the Helpr's transfer is pending or failed (a payout hold, no payout
 * account) used to read "You received $X". One case per state of the Helpr's row, plus the read itself.
 * Who may read the row: src/test/pglite/helprReadsOwnCancelFeeRow.pglite.mjs.
 *
 * @mutate src/pages/jobs/appliedJobCard/CancellationFeePill.tsx |   if (row?.status === "paid") { |   if (row?.status === "paid" \|\| jobStatus === "charged") {
 * @mutate src/pages/jobs/appliedJobCard/CancellationFeePill.tsx | if (jobStatus === "waived" \|\| row?.status === "waived" \|\| row?.status === "reversed") { | if (jobStatus === "waived" \|\| row?.status === "waived") {
 * @mutate src/pages/jobs/appliedJobCard/CancellationFeePill.tsx |   const { label, sent: isCharged } = cancellationFeeLine(status, feeRow, netAmt); |   const { label, sent: isCharged } = cancellationFeeLine(status, null, netAmt);
 * @mutate src/pages/jobs/appliedJobCard/CancellationFeePill.tsx |         .from("cancellation_fee_transfers") |         .from("jobs")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cancellationFeeLine } from "./CancellationFeePill";
import { blankComments } from "@/test/helpers/blankNonCode";

const EST = "$66";

describe("Q1916: the Helpr's cancellation line follows their own fee row", () => {
  it("paid: 'You received' with the amount actually sent", () => {
    expect(cancellationFeeLine("charged", { status: "paid", helper_amount: 132 }, EST)).toEqual({
      label: "You received $132 for the cancelled job",
      sent: true,
    });
  });

  it("pending, while the poster's charge reads 'charged': on its way, not received", () => {
    const line = cancellationFeeLine("charged", { status: "pending", helper_amount: 132 }, EST);
    expect(line.sent).toBe(false);
    expect(line.label).toBe(`You'll receive about ${EST} for the cancelled job — on its way`);
  });

  it("failed (no payout account, transfer refused): not received", () => {
    const line = cancellationFeeLine("charged", { status: "failed", helper_amount: 132 }, EST);
    expect(line.sent).toBe(false);
    expect(line.label).not.toMatch(/received/i);
  });

  it("no row yet, or the read failed: never 'You received'", () => {
    const line = cancellationFeeLine("charged", null, EST);
    expect(line.sent).toBe(false);
    expect(line.label).not.toMatch(/You received/);
  });

  it("waived (row or job) and reversed: no payment", () => {
    const cases = [
      ["waived", null],
      ["charged", { status: "waived", helper_amount: 0 }],
      ["charged", { status: "reversed", helper_amount: 132 }],
    ] as const;
    expect(cases.length).toBeGreaterThan(2);
    for (const [job, row] of cases) {
      expect(cancellationFeeLine(job, row, EST)).toEqual({ label: "No payment for the cancelled job", sent: false });
    }
  });

  it("the pill reads the Helpr's own row and passes it in", () => {
    const src = blankComments(readFileSync("src/pages/jobs/appliedJobCard/CancellationFeePill.tsx", "utf8"));
    expect(src).toContain('.from("cancellation_fee_transfers")');
    expect(src).toContain('.select("status, helper_amount")');
    expect(src).toContain('.eq("helper_id", helperId as string)');
    expect(src).toContain("cancellationFeeLine(status, feeRow, netAmt)");
    // The old map from the poster's charge to "You received" is gone.
    expect(src).not.toMatch(/charged:\s*`You received/);
  });
});
