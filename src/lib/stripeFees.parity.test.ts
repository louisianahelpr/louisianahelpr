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
} from "../../supabase/functions/_shared/stripeFees";
import {
  STRIPE_PCT as CLIENT_PCT,
  STRIPE_FLAT_CENTS as CLIENT_FLAT,
  stripeProcessingCostCents as clientCost,
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
