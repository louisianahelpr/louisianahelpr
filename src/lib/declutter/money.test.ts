/**
 * @mutate src/lib/declutter/money.ts | Math.max(Math.round(itemsCents * BUYER_PREMIUM_RATE), MIN_PREMIUM_CENTS) | Math.round(itemsCents * BUYER_PREMIUM_RATE)
 * @mutate src/lib/declutter/money.ts | Math.max(100, Math.ceil(currentPriceCents / 2)) | Math.max(100, Math.floor(currentPriceCents / 2))
 */
import { describe, expect, it } from "vitest";
import { checkoutAmounts, minOfferCents } from "./money";

describe("Declutter checkout amounts (rows 20-22, 38)", () => {
  it("adds a 15% premium to the item prices", () => {
    expect(checkoutAmounts([4000])).toEqual({ itemsCents: 4000, premiumCents: 600, totalCents: 4600 });
  });
  it("charges the $1 minimum once per checkout, not per item", () => {
    expect(checkoutAmounts([300, 400])).toEqual({ itemsCents: 700, premiumCents: 105, totalCents: 805 });
    expect(checkoutAmounts([200, 200])).toEqual({ itemsCents: 400, premiumCents: 100, totalCents: 500 });
  });
  it("matches the PGlite-proven server numbers", () => {
    // src/test/pglite/declutterSlice3.pglite.mjs: $3 + $4 -> $8.05; $40 -> $46.
    expect(checkoutAmounts([300, 400]).totalCents).toBe(805);
    expect(checkoutAmounts([4000]).totalCents).toBe(4600);
  });
  it("the lowest offer is half the price, rounded up to the cent, never under $1", () => {
    expect(minOfferCents(4000)).toBe(2000);
    expect(minOfferCents(4001)).toBe(2001);
    expect(minOfferCents(150)).toBe(100);
  });
});
