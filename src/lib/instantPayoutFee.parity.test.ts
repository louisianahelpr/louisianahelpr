import { describe, it, expect } from "vitest";
// The edge helper lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This is the guard
// that keeps the server-side instant-payout fee (the authority that moves money
// in instant-payout/index.ts) in lock-step with the client mirror in
// src/lib/instantPayoutFee.ts, pinning F-MONEY-35.
import {
  INSTANT_PAYOUT_FEE_PERCENT as EDGE_PERCENT,
  computeInstantPayoutFeeCents,
} from "../../supabase/functions/_shared/instantPayoutFee";
import {
  INSTANT_PAYOUT_FEE_PERCENT as CLIENT_PERCENT,
  instantPayoutFeeLabel,
} from "./instantPayoutFee";

describe("instant-payout fee parity (client mirror ↔ edge authority)", () => {
  it("client and edge rates never drift", () => {
    expect(CLIENT_PERCENT).toBe(EDGE_PERCENT);
  });

  it("is a flat 3% — no fixed add-on, no minimum", () => {
    expect(EDGE_PERCENT).toBe(3);
  });

  it("derives the inline label from the shared rate", () => {
    expect(instantPayoutFeeLabel()).toBe(`${EDGE_PERCENT}% fee`);
  });
});

describe("computeInstantPayoutFeeCents (server authority)", () => {
  it("takes a flat 3% of gross, rounded to the nearest cent", () => {
    expect(computeInstantPayoutFeeCents(10000)).toBe(300); // $100 → $3
    expect(computeInstantPayoutFeeCents(5000)).toBe(150); // $50 → $1.50
    expect(computeInstantPayoutFeeCents(133)).toBe(4); // 3.99¢ → 4¢ (rounds)
    expect(computeInstantPayoutFeeCents(150)).toBe(5); // 4.5¢ → 5¢ (rounds up)
  });

  it("returns 0 for zero / negative / non-positive gross", () => {
    expect(computeInstantPayoutFeeCents(0)).toBe(0);
    expect(computeInstantPayoutFeeCents(-100)).toBe(0);
    expect(computeInstantPayoutFeeCents(Number.NaN)).toBe(0);
  });

  it("never adds a fixed component or floors to a minimum", () => {
    // A tiny 34¢ balance: a flat 3% is 1¢ — NOT the old $2 minimum.
    expect(computeInstantPayoutFeeCents(34)).toBe(1);
  });

  it("rounds sub-17¢ balances to a 0¢ fee — the boundary the transfer guard relies on", () => {
    // index.ts skips the Stripe transfer when feeCents === 0 (Stripe rejects a
    // $0 transfer). 16¢ → round(0.48) = 0; 17¢ → round(0.51) = 1.
    expect(computeInstantPayoutFeeCents(16)).toBe(0);
    expect(computeInstantPayoutFeeCents(17)).toBe(1);
  });
});
