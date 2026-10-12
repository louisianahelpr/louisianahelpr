import { describe, it, expect } from "vitest";
import {
  POSTER_SERVICE_FEE_PERCENT as uiPercent,
  POSTER_SERVICE_FEE_DESCRIPTION as uiDescription,
  posterCardCostFeeCents as uiFee,
} from "./posterFees";
// The edge helpers are plain TS (no Deno imports at module scope), so vitest can
// import them directly. This test is the guard that keeps the poster-fee logic
// identical across the two runtimes — a drift here would make the shown checkout
// total disagree with what the poster is actually charged.
import {
  POSTER_SERVICE_FEE_PERCENT as edgePercent,
  POSTER_SERVICE_FEE_DESCRIPTION as edgeDescription,
  posterCardCostFeeCents as edgeFee,
} from "../../supabase/functions/_shared/posterFees";
import { stripeProcessingCostCents } from "./stripeFees";

describe("poster service fee = Stripe's card cost only (owner, 2026-10-11) — UI ↔ edge parity", () => {
  it("both runtimes charge NO platform percentage and describe the fee the same way", () => {
    expect(uiPercent).toBe(0);
    expect(edgePercent).toBe(0);
    expect(uiDescription).toBe(edgeDescription);
    expect(uiDescription).not.toMatch(/%|surcharge/i);
  });

  it("computes the same fee for a grid of budgets / extras / prepaid card cost", () => {
    let n = 0;
    for (const b of [0, 100, 1000, 2500, 3000, 5000, 10_000, 25_000, 100_000]) {
      for (const e of [0, 200, 500, 700, 25_000]) {
        for (const p of [0, 15, 45]) {
          expect(uiFee(b, e, p), `${b}/${e}/${p}`).toBe(edgeFee(b, e, p));
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("covers Stripe's real cost on the WHOLE charge (fee included), by at most 1c", () => {
    // `fee >= stripeCost(budget + fee + other)` is the money-safety rule; the
    // closed-form solve can land 1c above the exact minimum, never more.
    for (let b = 100; b <= 60_000; b += 137) {
      for (const e of [0, 200, 500, 900]) {
        const fee = uiFee(b, e);
        expect(fee).toBe(edgeFee(b, e));
        const cost = stripeProcessingCostCents(b + fee + e);
        expect(fee, `${b}/${e}`).toBeGreaterThanOrEqual(cost);
        expect(fee - cost, `${b}/${e}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is the card cost, not a tier percent: $30 → $1.21, $100 → $3.30, $250 → $7.78", () => {
    // Before 2026-10-11 a free-tier poster paid 12%: $3.60, $12.00, $30.00.
    expect(uiFee(3000)).toBe(121);
    expect(uiFee(10_000)).toBe(330);
    expect(uiFee(25_000)).toBe(edgeFee(25_000));
    expect(uiFee(25_000)).toBe(778);
  });

  it("charges nothing on nothing", () => {
    expect(uiFee(0)).toBe(0);
    expect(edgeFee(0)).toBe(0);
  });
});

// The card-cost solve itself, dropped on each runtime in turn: a fee that
// skips the gross-up undershoots Stripe's cost on the fee's own share.
// @mutate src/lib/posterFees.ts |   let feeCents = base > 0 ? Math.ceil((base * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT)) : 0;\n  while (feeCents > 0 && feeCents < stripeProcessingCostCents(base + feeCents)) feeCents++; |   let feeCents = stripeProcessingCostCents(base);
// @mutate supabase/functions/_shared/posterFees.ts |   let feeCents = base > 0 ? Math.ceil((base * STRIPE_PCT + STRIPE_FLAT_CENTS) / (1 - STRIPE_PCT)) : 0;\n  while (feeCents > 0 && feeCents < stripeProcessingCostCents(base + feeCents)) feeCents++; |   let feeCents = stripeProcessingCostCents(base);
