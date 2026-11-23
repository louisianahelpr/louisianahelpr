/**
 * La. R.S. 51:1423(B)(2) (read 2026-11-23, https://legis.la.gov/Legis/Law.aspx?d=285608):
 * "It shall be unlawful for any person or entity to sell a gift certificate to a
 * purchaser that contains ... A service fee ... However, nothing shall prevent the
 * issuer from charging a one-time handling fee, which shall not exceed one dollar per
 * gift certificate." (E): a violation is a deceptive and unfair trade practice.
 *
 * Before 2026-11-23 create-gift-card-checkout charged face + the full card cost
 * (posterCardCostFeeCents): $1.06 on a $25 card, $15.25 on a $500 card. This guard
 * holds every gift card charge to face + at most $1, in both runtimes, on the
 * screen the buyer reads, and in the Terms.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import {
  GIFT_CARD_HANDLING_FEE_CAP_CENTS as uiCap,
  giftCardHandlingFeeCents as uiFee,
  posterCardCostFeeCents,
} from "@/lib/posterFees";
import {
  GIFT_CARD_HANDLING_FEE_CAP_CENTS as edgeCap,
  giftCardHandlingFeeCents as edgeFee,
} from "../../supabase/functions/_shared/posterFees";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const CHECKOUT = "supabase/functions/create-gift-card-checkout/index.ts";

describe("a gift card costs face + a one-time handling fee of at most $1 (La. R.S. 51:1423(B)(2))", () => {
  it("both runtimes cap the fee at $1 for every amount a buyer can pick", () => {
    expect(uiCap).toBe(100);
    expect(edgeCap).toBe(100);
    let n = 0;
    // MIN_GIFT_CENTS..MAX_GIFT_CENTS in create-gift-card-checkout ($10..$500).
    for (let face = 1000; face <= 50_000; face += 37) {
      const fee = uiFee(face);
      expect(fee, `$${face / 100}`).toBe(edgeFee(face));
      expect(fee, `$${face / 100}`).toBeLessThanOrEqual(100);
      expect(fee, `$${face / 100}`).toBeGreaterThan(0);
      // Below the cap the buyer pays only the card cost, never a rounded-up $1.
      expect(fee).toBe(Math.min(posterCardCostFeeCents(face), 100));
      n++;
    }
    expect(n).toBeGreaterThan(1000);
    expect(uiFee(50_000)).toBe(100);
    expect(uiFee(1000)).toBe(61);
  });

  it("the checkout charges face + giftCardHandlingFeeCents, and nothing else", () => {
    const src = code(CHECKOUT);
    expect(src).toMatch(/const feeCents = giftCardHandlingFeeCents\(amountCents\);/);
    expect(src).toMatch(/const chargeCents = amountCents \+ feeCents;/);
    expect(src).toMatch(/unit_amount: chargeCents/);
    // One line item: no second line can carry an uncapped fee.
    expect([...src.matchAll(/unit_amount:/g)]).toHaveLength(1);
    expect(src).not.toMatch(/posterCardCostFeeCents/);
  });

  it("the buy screen's total uses the same capped fee", () => {
    const src = code("src/pages/profile/GiftCard.tsx");
    expect(src).toMatch(/giftCardHandlingFeeCents\(giftAmountCents\)/);
    expect(src).not.toMatch(/posterCardCostFeeCents/);
  });

  it("the Terms state the $1 one-time handling fee from the same constant", () => {
    const src = code("src/pages/info/legal/TermsSection.tsx");
    expect(src).toMatch(/Gift cards:<\/strong> the buyer pays the gift card amount plus a one-time handling fee of at most \{formatDollarsWhole\(GIFT_CARD_HANDLING_FEE_CAP_CENTS \/ 100\)\}/);
  });
});

// Each must turn this guard red on its own:
// 1: the pre-fix charge (uncapped card cost).
// 2: the cap raised past what the law allows.
// 3: the buy screen showing the uncapped total.
// @mutate supabase/functions/create-gift-card-checkout/index.ts | const feeCents = giftCardHandlingFeeCents(amountCents); | const feeCents = posterCardCostFeeCents(amountCents);
// @mutate supabase/functions/_shared/posterFees.ts | export const GIFT_CARD_HANDLING_FEE_CAP_CENTS = 100; | export const GIFT_CARD_HANDLING_FEE_CAP_CENTS = 150;
// @mutate src/pages/profile/GiftCard.tsx | giftCardHandlingFeeCents(giftAmountCents) | posterCardCostFeeCents(giftAmountCents)
