import { describe, it, expect } from "vitest";
// The edge helper lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This guard keeps
// the server-side Stripe-cost floor (the authority that withholds the
// non-refundable fee in every refund path — cancellation, dispute) in lock-step
// with the client mirror in src/lib/stripeFees.ts.
import {
  STRIPE_PCT as EDGE_PCT,
  STRIPE_FLAT_CENTS as EDGE_FLAT,
  stripeProcessingCostCents as edgeCost,
  stripePercentCostCents as edgePercentCost,
  netUrgentFeeDollars as edgeNetUrgent,
} from "../../supabase/functions/_shared/stripeFees";
import {
  STRIPE_PCT as CLIENT_PCT,
  STRIPE_FLAT_CENTS as CLIENT_FLAT,
  stripeProcessingCostCents as clientCost,
  stripePercentCostCents as clientPercentCost,
  netUrgentFeeDollars as clientNetUrgent,
} from "./stripeFees";

describe("stripe-fee parity (client mirror ↔ edge authority)", () => {
  it("client and edge percentage never drift", () => {
    expect(CLIENT_PCT).toBe(EDGE_PCT);
  });

  it("client and edge flat fee never drift", () => {
    expect(CLIENT_FLAT).toBe(EDGE_FLAT);
  });

  it("matches Stripe's published card rate: 2.9% + $0.30", () => {
    expect(EDGE_PCT).toBe(0.029);
    expect(EDGE_FLAT).toBe(30);
  });
});

describe("stripeProcessingCostCents (server authority)", () => {
  it("takes 2.9% + $0.30, rounded to the nearest cent", () => {
    expect(edgeCost(10000)).toBe(320); // $100 → $2.90 + $0.30 = $3.20
    expect(edgeCost(5000)).toBe(175); // $50 → $1.45 + $0.30 = $1.75
    expect(edgeCost(1000)).toBe(59); // $10 → $0.29 + $0.30 = $0.59
  });

  it("client and edge produce identical costs across amounts", () => {
    for (const amt of [0, 1, 999, 1000, 4237, 50000]) {
      expect(clientCost(amt)).toBe(edgeCost(amt));
    }
  });

  it("returns 0 for zero / negative / non-positive amounts", () => {
    expect(edgeCost(0)).toBe(0);
    expect(edgeCost(-100)).toBe(0);
    expect(edgeCost(Number.NaN)).toBe(0);
  });
});

describe("stripePercentCostCents (bundled marginal cost, no flat)", () => {
  it("takes 2.9% only — never the once-per-transaction $0.30 flat", () => {
    expect(edgePercentCost(10000)).toBe(290); // $100 → $2.90, no +$0.30
    expect(edgePercentCost(1000)).toBe(29); // $10 → $0.29
    expect(edgePercentCost(500)).toBe(15); // $5 → $0.145 → $0.15
  });

  it("is exactly the standalone cost minus the flat, for positive amounts", () => {
    for (const amt of [1, 500, 1000, 4237, 50000]) {
      expect(edgePercentCost(amt)).toBe(edgeCost(amt) - EDGE_FLAT);
    }
  });

  it("client and edge produce identical bundled costs across amounts", () => {
    for (const amt of [0, 1, 999, 1000, 4237, 50000]) {
      expect(clientPercentCost(amt)).toBe(edgePercentCost(amt));
    }
  });

  it("returns 0 for zero / negative / non-positive amounts", () => {
    expect(edgePercentCost(0)).toBe(0);
    expect(edgePercentCost(-100)).toBe(0);
    expect(edgePercentCost(Number.NaN)).toBe(0);
  });
});

describe("netUrgentFeeDollars (helper's urgent take-home after bundled Stripe cost)", () => {
  it("docks only the marginal 2.9% of the urgent fee, in dollars", () => {
    expect(edgeNetUrgent(10)).toBeCloseTo(9.71, 5); // $10 − $0.29
    expect(edgeNetUrgent(5)).toBeCloseTo(4.85, 5); // $5 − $0.15
    expect(edgeNetUrgent(20)).toBeCloseTo(19.42, 5); // $20 − $0.58
  });

  it("never subtracts the flat — a $0 urgent fee nets $0, not −$0.30", () => {
    expect(edgeNetUrgent(0)).toBe(0);
    expect(edgeNetUrgent(null)).toBe(0);
    expect(edgeNetUrgent(undefined)).toBe(0);
    expect(edgeNetUrgent(-5)).toBe(0);
  });

  it("client and edge net identical urgent take-home across fees", () => {
    for (const fee of [0, 1, 5, 7.5, 10, 25, 100]) {
      expect(clientNetUrgent(fee)).toBe(edgeNetUrgent(fee));
    }
  });
});
