import { describe, it, expect } from "vitest";
// Plain TS, no Deno imports at module scope — vitest can import it directly,
// same as stripeFees.parity.test.ts does for the rest of this module.
import { actualOrEstimatedFeeCents } from "../../supabase/functions/_shared/stripeFees";

describe("actualOrEstimatedFeeCents", () => {
  it("reads the real fee off an expanded PaymentIntent's balance transaction", () => {
    // A Klarna charge: Stripe's real cut (5.99% + 30c on $100) is 629 cents —
    // far more than the 2.9%+30c card estimate (320 cents) would assume.
    const pi = { latest_charge: { balance_transaction: { fee: 629 } } };
    expect(actualOrEstimatedFeeCents(pi, 10000)).toBe(629);
  });

  it("falls back to the card-rate estimate when balance_transaction isn't expanded", () => {
    const pi = { latest_charge: "ch_123" }; // unexpanded — just a string id
    expect(actualOrEstimatedFeeCents(pi, 10000)).toBe(320); // 2.9% + 30c
  });

  it("falls back when latest_charge is missing entirely", () => {
    expect(actualOrEstimatedFeeCents({}, 10000)).toBe(320);
    expect(actualOrEstimatedFeeCents(null, 10000)).toBe(320);
    expect(actualOrEstimatedFeeCents(undefined, 10000)).toBe(320);
  });

  it("falls back when balance_transaction is present but unexpanded (a string id)", () => {
    const pi = { latest_charge: { balance_transaction: "txn_123" } };
    expect(actualOrEstimatedFeeCents(pi, 10000)).toBe(320);
  });
});
