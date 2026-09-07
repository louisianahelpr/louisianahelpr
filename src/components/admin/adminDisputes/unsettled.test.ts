// The one predicate that decides whether a dispute is still costing someone
// money. Both the dispute queue and the Exception Queue read it, so a change
// here changes what an admin is shown in two places at once.
import { describe, it, expect } from "vitest";
import { isUnsettled, unsettledReason } from "./unsettled";

const rec = (over: Record<string, unknown> = {}) =>
  ({ status: "decided", execution_status: "pending", ...over }) as any;

describe("isUnsettled", () => {
  it("flags the c7a12050 shape — decided, execution never attempted", () => {
    // The exact prod row this whole change exists for: dispute 'decided',
    // job 'completed', jobs.payment_status still 'escrow', every execution_*
    // column NULL, $180 unmoved.
    expect(isUnsettled(rec({ execution_status: null }))).toBe(true);
    expect(isUnsettled(rec({ execution_status: "pending" }))).toBe(true);
  });

  it("flags an attempt that failed or died mid-run", () => {
    expect(isUnsettled(rec({ execution_status: "failed" }))).toBe(true);
    expect(isUnsettled(rec({ execution_status: "executing" }))).toBe(true);
  });

  it("does NOT flag a settled dispute", () => {
    expect(isUnsettled(rec({ execution_status: "executed" }))).toBe(false);
  });

  it("does NOT flag an open or withdrawn dispute", () => {
    expect(isUnsettled(rec({ status: "open", execution_status: null }))).toBe(false);
    expect(isUnsettled(rec({ status: "withdrawn", execution_status: null }))).toBe(false);
  });

  it("does NOT flag a row read without the execution columns", () => {
    // The queue drops those columns on a 42703 during a deploy window. That is
    // UNKNOWN, not unsettled — flooding the queue with false alarms every
    // deploy would train an admin to ignore the badge that matters.
    expect(isUnsettled(rec({ execution_status: undefined }))).toBe(false);
  });

  it("is false for a job with no dispute record at all", () => {
    expect(isUnsettled(undefined)).toBe(false);
    expect(isUnsettled(null)).toBe(false);
  });
});

describe("unsettledReason", () => {
  it("says plainly that nobody has been paid", () => {
    expect(unsettledReason({ execution_status: "pending", execution_error: null })).toMatch(
      /has NOT moved/,
    );
  });

  it("surfaces the executor's own recorded reason", () => {
    expect(
      unsettledReason({
        execution_status: "failed",
        execution_error: "no payment intent on file — cannot verify or split the escrow",
      }),
    ).toContain("no payment intent on file");
  });

  it("tells the admin a retry is safe on a half-finished run", () => {
    expect(unsettledReason({ execution_status: "executing", execution_error: null })).toMatch(
      /Retry is safe/,
    );
  });
});
