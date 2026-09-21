import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The edge helper lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This is the guard
// that keeps the server-side instant-payout fee (the authority that moves money
// in instant-payout/index.ts) in lock-step with the client mirror in
// src/lib/instantPayoutFee.ts, pinning F-MONEY-35.
import {
  INSTANT_PAYOUT_FEE_PERCENT as EDGE_PERCENT,
  INSTANT_PAYOUT_MIN_CENTS as EDGE_MIN,
  computeInstantPayoutFeeCents,
} from "../../supabase/functions/_shared/instantPayoutFee";
import {
  INSTANT_PAYOUT_FEE_PERCENT as CLIENT_PERCENT,
  INSTANT_PAYOUT_MIN_CENTS as CLIENT_MIN,
  instantPayoutFeeLabel,
  instantPayoutMinLabel,
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

  it("client and edge minimum-cashout floors never drift", () => {
    expect(CLIENT_MIN).toBe(EDGE_MIN);
  });

  it("requires at least a $25 balance to use instant payout", () => {
    // The floor keeps every instant payout profitable: 3% of $25 = $0.75, above
    // Stripe's $0.50 per-instant-payout minimum. Below this, standard (free).
    expect(EDGE_MIN).toBe(2500);
  });

  it("formats the minimum as a clean dollar label", () => {
    expect(instantPayoutMinLabel()).toBe("$25");
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

/**
 * PARITY OF THE CONSTANTS IS NOT PARITY OF THE MONEY.
 *
 * Everything above proves two modules hold the same number and that a pure
 * function rounds correctly. Neither says the edge function that actually moves
 * the money USES either of them. Hardcode `Math.round(availableCents * 0.05)`
 * into instant-payout/index.ts and every case above stays green while the
 * helper is shown "3% fee" and debited 5% — the exact shape F-MONEY-35 exists
 * to prevent. So: read the authority's only caller and require the derivation.
 */
describe("instant-payout/index.ts derives the fee from the shared authority", () => {
  const src = readFileSync(resolve(process.cwd(), "supabase/functions/instant-payout/index.ts"), "utf8");

  it("imports the shared module rather than its own copy of the rate", () => {
    expect(src).toMatch(/from\s+"\.\.\/_shared\/instantPayoutFee\.ts"/);
    expect(src).toContain("computeInstantPayoutFeeCents");
    expect(src).toContain("INSTANT_PAYOUT_MIN_CENTS");
  });

  it("computes feeCents ONLY by calling the authority", () => {
    const assignments = [...src.matchAll(/\bfeeCents\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
    // FLOOR: an empty match set would make the loop below assert nothing.
    expect(assignments.length, "instant-payout no longer assigns feeCents").toBeGreaterThan(0);
    for (const rhs of assignments) {
      expect(rhs, `feeCents is built by hand: ${rhs}`).toBe("computeInstantPayoutFeeCents(availableCents)");
    }
  });

  it("never re-derives a percentage or a floor inline", () => {
    // Any bare fee arithmetic on the balance is a second source of truth.
    expect(src, "a percentage is applied to the balance outside the shared helper")
      .not.toMatch(/availableCents\s*\*\s*[\d.]/);
    // The floor comparison must read the shared constant, not a literal.
    const floorChecks = [...src.matchAll(/availableCents\s*<\s*(?!=)([^)\s]+)/g)].map((m) => m[1]);
    expect(floorChecks.length, "the minimum-balance gate is gone entirely").toBeGreaterThan(0);
    expect(floorChecks).toEqual(["INSTANT_PAYOUT_MIN_CENTS"]);
  });

  it("the quote a helper is shown and the execute that debits them read the same feeCents", () => {
    // One computation, above the `action === "quote"` early return, so the
    // number in the dialog IS the number the transfer uses. Two computations —
    // or a quote that rounds differently — is the drift this pins.
    const compute = src.indexOf("computeInstantPayoutFeeCents(availableCents)");
    const quoteBranch = src.indexOf('action === "quote"');
    const executeBranch = src.indexOf('action !== "execute"');
    expect(compute).toBeGreaterThan(-1);
    expect(quoteBranch).toBeGreaterThan(compute);
    expect(executeBranch).toBeGreaterThan(quoteBranch);
    expect(src.slice(quoteBranch)).not.toContain("computeInstantPayoutFeeCents(");
  });
});

// THE NUMBER THAT LEAVES THE HELPER'S BALANCE. A flat 3%: no fixed add-on, no
// floor. The sub-17c rounding boundary is load-bearing too — index.ts skips the
// Stripe transfer at exactly feeCents === 0.
// @mutate supabase/functions/_shared/instantPayoutFee.ts | Math.round(grossCents * (INSTANT_PAYOUT_FEE_PERCENT / 100)) | Math.round(grossCents * 0.05)
// The rate itself, which is also the rate every UI string is built from.
// @mutate supabase/functions/_shared/instantPayoutFee.ts | export const INSTANT_PAYOUT_FEE_PERCENT = 3; | export const INSTANT_PAYOUT_FEE_PERCENT = 5;
// The minimum-cashout floor keeps a 3% fee above Stripe's $0.50 per-payout cost.
// @mutate supabase/functions/_shared/instantPayoutFee.ts | export const INSTANT_PAYOUT_MIN_CENTS = 2500; | export const INSTANT_PAYOUT_MIN_CENTS = 500;
// And the wiring: the authority is only an authority if index.ts calls it.
// @mutate supabase/functions/instant-payout/index.ts | const feeCents = computeInstantPayoutFeeCents(availableCents); | const feeCents = Math.round(availableCents * 0.05);
