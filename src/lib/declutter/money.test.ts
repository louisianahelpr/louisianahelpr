/**
 * @mutate src/lib/declutter/money.ts | Math.round(itemsCents * BUYER_FEE_RATE) + BUYER_FEE_FIXED_CENTS | Math.round(itemsCents * BUYER_FEE_RATE)
 * @mutate src/lib/declutter/money.ts | const BUYER_FEE_RATE = 0.05; | const BUYER_FEE_RATE = 0.15;
 * @mutate src/lib/declutter/money.ts | Math.max(100, Math.ceil(currentPriceCents / 2)) | Math.max(100, Math.floor(currentPriceCents / 2))
 */
import { describe, expect, it } from "vitest";
import { checkoutAmounts, minOfferCents } from "./money";

// Stripe's standard US card price, on the WHOLE charge (items + fee). The
// server's estimate is the same formula (declutter_card_fee_estimate).
const cardCost = (totalCents: number) => Math.round(totalCents * 0.029) + 30;

describe("Declutter buyer's fee F1: 5% of the item total + 70c, card cost inside", () => {
  it("$10, $50 and $200 orders", () => {
    expect(checkoutAmounts([1000])).toEqual({ itemsCents: 1000, premiumCents: 120, totalCents: 1120 });
    expect(checkoutAmounts([5000])).toEqual({ itemsCents: 5000, premiumCents: 320, totalCents: 5320 });
    expect(checkoutAmounts([20000])).toEqual({ itemsCents: 20000, premiumCents: 1070, totalCents: 21070 });
  });
  it("the 70c is charged once per checkout, not per item (row 38)", () => {
    expect(checkoutAmounts([300, 400])).toEqual({ itemsCents: 700, premiumCents: 105, totalCents: 805 });
    expect(checkoutAmounts([100, 100, 100])).toEqual({ itemsCents: 300, premiumCents: 85, totalCents: 385 });
  });
  it("small items: $1 and $2 still leave the platform above zero after the card cost", () => {
    const one = checkoutAmounts([100]);
    expect(one).toEqual({ itemsCents: 100, premiumCents: 75, totalCents: 175 });
    expect(one.premiumCents - cardCost(one.totalCents)).toBe(75 - 35); // 40c kept
    const two = checkoutAmounts([200]);
    expect(two).toEqual({ itemsCents: 200, premiumCents: 80, totalCents: 280 });
    expect(two.premiumCents - cardCost(two.totalCents)).toBe(80 - 38); // 42c kept
  });
  it("never below zero for any whole-dollar order from $1 to $10,000 (ten $1,000 items)", () => {
    let worst = Infinity;
    for (let cents = 100; cents <= 1_000_000; cents += 100) {
      const a = checkoutAmounts([cents]);
      worst = Math.min(worst, a.premiumCents - cardCost(a.totalCents));
    }
    expect(worst).toBe(40); // the $1 order is the tightest
  });
  it("the lowest offer is half the price, rounded up to the cent, never under $1", () => {
    expect(minOfferCents(4000)).toBe(2000);
    expect(minOfferCents(4001)).toBe(2001);
    expect(minOfferCents(150)).toBe(100);
  });
});
