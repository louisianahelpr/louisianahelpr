/**
 * F089 (owner UI audit 2026-11-09, data): a part-refunded job's receipt showed a bare rust "$12.00". The figure stays
 * (job 5d43debf: $112.00 charged, $100.00 refunded, $12.00 kept, read on prod); it now opens to Charged / Refunded /
 * You paid, and those lines must add up to the figure shown.
 *
 * @mutate src/lib/posterSpend.ts | { label: "Charged", cents: jobKept + r.refundedCents }, | { label: "Charged", cents: jobKept },
 * @mutate src/lib/posterSpend.ts |   if (r.refundedCents <= 0 \|\| r.cents <= 0) return undefined; |   if (r.cents <= 0) return undefined;
 */
import { describe, expect, it } from "vitest";
import { jobRefundLines } from "@/lib/posterSpend";

const sum = (lines: { cents: number }[]) => lines.reduce((t, l) => t + l.cents, 0);

describe("a part-refunded job's receipt adds up (F089)", () => {
  it("the measured job: $112 charged, $100 back, $12 paid", () => {
    const lines = jobRefundLines({ cents: 1200, refundedCents: 10000, tipCents: 0 });
    expect(lines).toEqual([
      { label: "Charged", cents: 11200 },
      { label: "Refunded", cents: -10000 },
    ]);
    expect(sum(lines!)).toBe(1200);
  });

  it("a tip on the job is its own line and the lines still add up", () => {
    const lines = jobRefundLines({ cents: 1700, refundedCents: 10000, tipCents: 500 })!;
    expect(lines.map((l) => l.label)).toEqual(["Charged", "Refunded", "Tip"]);
    expect(sum(lines)).toBe(1700);
  });

  it("no refund, or nothing kept: no breakdown (the row says Refunded in full or is a plain charge)", () => {
    expect(jobRefundLines({ cents: 5000, refundedCents: 0, tipCents: 0 })).toBeUndefined();
    expect(jobRefundLines({ cents: 0, refundedCents: 5000, tipCents: 0 })).toBeUndefined();
  });
});
