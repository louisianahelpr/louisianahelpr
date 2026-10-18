import { describe, it, expect } from "vitest";
// Plain TS, no Deno imports at module scope — vitest can import it directly,
// same as stripeFees.parity.test.ts does for the rest of this module.
import { actualOrEstimatedFeeCents, actualStripeFeeCents, estimatedFeeCentsFor } from "../../supabase/functions/_shared/stripeFees";

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

  // Q2082 (c): a Pay-in-4 charge whose fee could not be read is estimated at
  // the Pay-in-4 rate, never the card rate (which would leave the platform
  // paying ~3% of the charge on every such refund).
  it("estimates a Pay-in-4 charge at its own rate when the real fee is unread (Q2082 c)", () => {
    // The charge says how it was paid.
    expect(actualOrEstimatedFeeCents({ latest_charge: { payment_method_details: { type: "klarna" } } }, 10000)).toBe(629);
    expect(actualOrEstimatedFeeCents({ latest_charge: { payment_method_details: { type: "afterpay_clearpay" } } }, 10000)).toBe(630);
    // A card-paid charge keeps the card rate even if BNPL was also offered.
    expect(actualOrEstimatedFeeCents({
      latest_charge: { payment_method_details: { type: "card" } },
      payment_method_types: ["klarna", "afterpay_clearpay"],
    }, 10000)).toBe(320);
    // Unexpanded charge: a Pay-in-4 checkout allowed only Klarna + Afterpay,
    // so the higher of the two rates.
    expect(actualOrEstimatedFeeCents({ latest_charge: "ch_1", payment_method_types: ["klarna", "afterpay_clearpay"] }, 10000)).toBe(630);
    // A normal job checkout (card, Link, ACH) stays on the card rate.
    expect(actualOrEstimatedFeeCents({ latest_charge: "ch_1", payment_method_types: ["card", "link", "us_bank_account"] }, 10000)).toBe(320);
    expect(actualOrEstimatedFeeCents({ latest_charge: "ch_1", payment_method_types: ["card", "klarna"] }, 10000)).toBe(320);
    // The real fee still wins over every estimate.
    expect(actualOrEstimatedFeeCents({
      latest_charge: { balance_transaction: { fee: 611 }, payment_method_details: { type: "klarna" } },
    }, 10000)).toBe(611);
    expect(estimatedFeeCentsFor({ payment_method_types: ["klarna"] }, 0)).toBe(0);
  });

  it("actualStripeFeeCents says when the fee is Stripe's actual one: the fee, else null (Q1827)", () => {
    expect(actualStripeFeeCents({ latest_charge: { balance_transaction: { fee: 629 } } })).toBe(629);
    expect(actualStripeFeeCents({ latest_charge: { balance_transaction: { fee: 0 } } })).toBe(0);
    expect(actualStripeFeeCents({ latest_charge: { balance_transaction: "txn_123" } })).toBeNull();
    expect(actualStripeFeeCents({ latest_charge: "ch_123" })).toBeNull();
    expect(actualStripeFeeCents(null)).toBeNull();
  });
});

// Drops the REAL fee off the expanded balance transaction and always guesses
// the card rate — a Klarna charge's 629c cut booked as 320c.
// @mutate supabase/functions/_shared/stripeFees.ts | return balanceTransaction.fee; | return null;
// Q1827: an unread fee counted as an actual one (a crew refund would then
// honour an estimate stamped on its ledger row as if Stripe had charged it).
// @mutate supabase/functions/_shared/stripeFees.ts |   return null;\n} |   return 0;\n}
// Q2082 (c): the charge's own method ignored, a Klarna charge estimated at the card rate.
// @mutate supabase/functions/_shared/stripeFees.ts |     pct = STRIPE_BNPL_PCT[paidWith]; |     pct = undefined;
// Q2082 (c): a Pay-in-4-only PaymentIntent with an unexpanded charge estimated at the card rate.
// @mutate supabase/functions/_shared/stripeFees.ts |     if (rates.length > 0 && rates.every((r) => r !== undefined)) pct = Math.max(...(rates as number[])); |
