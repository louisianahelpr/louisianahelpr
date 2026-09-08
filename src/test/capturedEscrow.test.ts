import { describe, it, expect } from "vitest";
import { resolveCapturedEscrow } from "../../supabase/functions/_shared/capturedEscrow";

/**
 * The ceiling both payout paths cap their transfer against.
 *
 * This module exists because the first version of that cap read
 * `pi.amount_received` and treated anything non-numeric as ZERO captured. Zero
 * is the one value that must never be inferred: it is indistinguishable from
 * "the poster paid nothing", so an absent field would have refused every
 * payout on the platform under an admin alert blaming the poster's budget.
 *
 * So the contract under test is two-sided, and both sides matter:
 *   - never report a figure that was not established (no silent zero), and
 *   - never refuse a payout that a present, usable figure would allow.
 */
describe("resolveCapturedEscrow", () => {
  it("prefers amount_received — what Stripe actually took", () => {
    const r = resolveCapturedEscrow({ status: "succeeded", amount_received: 11200, amount: 99999 });
    expect(r).toEqual({ kind: "captured", cents: 11200, source: "amount_received" });
  });

  it("falls back to amount when amount_received is absent", () => {
    // Equal on a succeeded intent, and the reason one missing field cannot
    // halt every payout.
    const r = resolveCapturedEscrow({ status: "succeeded", amount: 11200 });
    expect(r).toEqual({ kind: "captured", cents: 11200, source: "amount" });
  });

  it("accepts a genuine zero rather than calling it unverifiable", () => {
    // A fully gift-funded job really did capture nothing. That is a FACT, not
    // a missing field, and the caller adds the gift leg on top of it.
    expect(resolveCapturedEscrow({ status: "succeeded", amount_received: 0, amount: 0 }))
      .toEqual({ kind: "captured", cents: 0, source: "amount_received" });
  });

  it("refuses to infer a figure when the intent carries neither amount", () => {
    const r = resolveCapturedEscrow({ status: "succeeded" });
    expect(r.kind).toBe("unverifiable");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["negative", -100],
    ["a string", "11200" as unknown as number],
  ])("treats %s as unusable rather than as zero captured", (_label, value) => {
    const r = resolveCapturedEscrow({ status: "succeeded", amount_received: value as number });
    // No usable `amount` either, so this must be unverifiable — the failure
    // mode being guarded is precisely "silently becomes 0 and refuses".
    expect(r.kind).toBe("unverifiable");
    // ...but a usable `amount` alongside it still resolves.
    const withAmount = resolveCapturedEscrow({ status: "succeeded", amount_received: value as number, amount: 11200 });
    expect(withAmount).toEqual({ kind: "captured", cents: 11200, source: "amount" });
  });

  it.each(["requires_payment_method", "requires_capture", "canceled", "processing"])(
    "never reads an amount off a %s intent",
    (status) => {
      // `amount` on an uncaptured intent is an INTENTION. Paying it out would
      // move money that was never collected.
      const r = resolveCapturedEscrow({ status, amount: 11200, amount_received: 11200 });
      expect(r.kind).toBe("unverifiable");
    },
  );

  it("is unverifiable for a missing intent object", () => {
    expect(resolveCapturedEscrow(null).kind).toBe("unverifiable");
    expect(resolveCapturedEscrow(undefined).kind).toBe("unverifiable");
  });

  it("always explains itself when it refuses", () => {
    for (const pi of [null, {}, { status: "succeeded" }, { status: "canceled", amount: 1 }]) {
      const r = resolveCapturedEscrow(pi as Parameters<typeof resolveCapturedEscrow>[0]);
      expect(r.kind).toBe("unverifiable");
      if (r.kind === "unverifiable") expect(r.reason.length).toBeGreaterThan(10);
    }
  });
});
