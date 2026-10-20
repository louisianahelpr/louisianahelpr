// Pins the held-payment headline's wording: board 56 "Your job is live" (owner
// 2026-10-20, superseding Q1536's "Payment Authorized."). The payment-held
// sentence stays below it on the page. The page reads it from paymentHeading.
// @mutate src/pages/post-job/paymentReturnCopy.ts | "Your job is live" | "Payment Authorized."
import { describe, expect, it } from "vitest";
import { paymentHeading, type ConfirmState } from "./paymentReturnCopy";

const STATES: ConfirmState[] = ["checking", "held", "not_held", "unknown", "not_yours"];

describe("payment return headline (board 56)", () => {
  it("a held payment reads exactly 'Your job is live'", () => {
    expect(paymentHeading("held")).toBe("Your job is live");
  });

  it("every state has its own non-empty headline (cannot pass vacuously)", () => {
    const headings = STATES.map(paymentHeading);
    expect(headings.length).toBeGreaterThan(4);
    expect(headings.every((h) => h.trim().length > 0)).toBe(true);
    expect(new Set(headings).size).toBe(STATES.length);
  });
});
