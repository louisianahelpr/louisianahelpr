// Pins the held-payment headline's wording (Q1536, owner 2026-10-08: "Payment
// Authorized." with a capital A). The page reads it from paymentHeading.
// @mutate src/pages/post-job/paymentReturnCopy.ts | "Payment Authorized." | "Payment authorized."
import { describe, expect, it } from "vitest";
import { paymentHeading, type ConfirmState } from "./paymentReturnCopy";

const STATES: ConfirmState[] = ["checking", "held", "not_held", "unknown", "not_yours"];

describe("payment return headline (Q1536)", () => {
  it("a held payment reads exactly 'Payment Authorized.'", () => {
    expect(paymentHeading("held")).toBe("Payment Authorized.");
  });

  it("every state has its own non-empty headline (cannot pass vacuously)", () => {
    const headings = STATES.map(paymentHeading);
    expect(headings.length).toBeGreaterThan(4);
    expect(headings.every((h) => h.trim().length > 0)).toBe(true);
    expect(new Set(headings).size).toBe(STATES.length);
  });
});
