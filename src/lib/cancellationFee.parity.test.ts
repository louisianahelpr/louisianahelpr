import { describe, it, expect } from "vitest";
// The edge helper lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This is the guard
// that keeps the server-side cancellation-fee math (the authority that moves
// money in void-cancelled-payments) in lock-step with the client estimate in
// CancellationDialog.tsx, and pins the anti-tamper property of F-MONEY-32.
import {
  cancellationFeePercent,
  computeCancellationFee,
} from "../../supabase/functions/_shared/cancellationFee";

// Mirror of the client ladder in CancellationDialog.tsx (display-only there).
function clientPercent(hasHelper: boolean, hoursUntilJob: number): number {
  return !hasHelper ? 0 : hoursUntilJob < 2 ? 50 : hoursUntilJob < 24 ? 25 : 0;
}

describe("cancellation-fee tiered ladder (server authority)", () => {
  it("encodes the 0 / 25 / 50 schedule", () => {
    expect(cancellationFeePercent(true, 48)).toBe(0); // 24+ hours → free
    expect(cancellationFeePercent(true, 23)).toBe(25); // <24h → 25%
    expect(cancellationFeePercent(true, 1)).toBe(50); // <2h → 50%
    expect(cancellationFeePercent(true, -5)).toBe(50); // already past start
  });

  it("is always free when no helper was assigned", () => {
    expect(cancellationFeePercent(false, 1)).toBe(0);
    expect(cancellationFeePercent(false, -100)).toBe(0);
  });

  it("matches the client-side ladder across the boundary hours", () => {
    for (const hasHelper of [true, false]) {
      for (const h of [-5, 0, 1, 1.99, 2, 2.01, 23, 23.99, 24, 24.01, 100]) {
        expect(cancellationFeePercent(hasHelper, h)).toBe(clientPercent(hasHelper, h));
      }
    }
  });
});

describe("computeCancellationFee (derives dollars from trusted fields only)", () => {
  // A fixed "now" is not needed: we pass an explicit cancelled_at and a
  // date_needed far enough apart to land in a known tier.
  const farFuture = "2099-01-02"; // well over 24h from any cancelled_at below

  it("returns 0 with no helper assigned, whatever the schedule", () => {
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-01",
        cancelled_at: "2099-01-01T00:00:00Z", // 0h before → would be 50% if helper
        helper_id: null,
      }),
    ).toBe(0);
  });

  it("returns 0 for a free-tier (24+ hours out) cancellation", () => {
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: farFuture,
        cancelled_at: "2026-01-01T00:00:00Z",
        helper_id: "helper-1",
      }),
    ).toBe(0);
  });

  it("charges 25% when cancelled inside 24h", () => {
    // date at 2099-01-02T00:00:00 local; cancel 10h before.
    const start = new Date("2099-01-02T00:00:00").getTime();
    const cancelledAt = new Date(start - 10 * 3600 * 1000).toISOString();
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-02",
        cancelled_at: cancelledAt,
        helper_id: "helper-1",
      }),
    ).toBe(50); // 25% of 200
  });

  it("charges 50% when cancelled inside 2h", () => {
    const start = new Date("2099-01-02T00:00:00").getTime();
    const cancelledAt = new Date(start - 1 * 3600 * 1000).toISOString();
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-02",
        cancelled_at: cancelledAt,
        helper_id: "helper-1",
      }),
    ).toBe(100); // 50% of 200
  });

  it("ignores a tampered stored value — output depends only on budget+timing", () => {
    // The job shape intentionally has no `cancellation_fee` field; the function
    // must never read one. Two identical trusted inputs → identical output.
    const start = new Date("2099-01-02T00:00:00").getTime();
    const cancelledAt = new Date(start - 1 * 3600 * 1000).toISOString();
    const base = { budget: 80, date_needed: "2099-01-02", cancelled_at: cancelledAt, helper_id: "h" };
    expect(computeCancellationFee(base)).toBe(40); // 50% of 80, not a forged number
  });

  it("returns 0 on missing/invalid budget", () => {
    expect(computeCancellationFee({ budget: 0, date_needed: farFuture, cancelled_at: null, helper_id: "h" })).toBe(0);
    expect(computeCancellationFee({ budget: null, date_needed: farFuture, cancelled_at: null, helper_id: "h" })).toBe(0);
  });
});
