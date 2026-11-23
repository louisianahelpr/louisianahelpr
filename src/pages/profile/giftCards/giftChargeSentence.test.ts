/**
 * A3-B2 (audit 2026-10-29): a $25 gift card said "You'll be charged $26 in
 * total" and Stripe Checkout charged $26.06. Nothing extra was charged: the
 * 6 cents are the card-cost fee (`posterCardCostFeeCents(2500)` = 106), and
 * the screen rounded the true total to whole dollars with `formatPrice`.
 *
 * The sentence the donor reads must name the exact amount the server sends to
 * Stripe as `unit_amount` (face + giftCardHandlingFeeCents(face): the card cost
 * capped at $1, La. R.S. 51:1423(B)(2)), to the cent,
 * at every offered amount and at both bounds.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { giftCardHandlingFeeCents } from "@/lib/posterFees";
import { AMOUNT_PRESETS } from "./constants";
import { giftChargeSentence } from "./giftChargeSentence";

// The bounds create-gift-card-checkout enforces (MIN_GIFT_CENTS / MAX_GIFT_CENTS),
// plus odd amounts a donor can type into the custom field.
const AMOUNTS_DOLLARS = [...AMOUNT_PRESETS, 10, 500, 37, 123.45];

describe("the gift-card total sentence matches the Stripe charge to the cent", () => {
  it("names face + card-cost fee exactly, with cents, at every amount", () => {
    expect(AMOUNTS_DOLLARS.length).toBeGreaterThan(5);
    for (const dollars of AMOUNTS_DOLLARS) {
      const face = Math.round(dollars * 100);
      const chargeCents = face + giftCardHandlingFeeCents(face); // the server's unit_amount
      const shown = giftChargeSentence(chargeCents).match(/\$([\d,]+(?:\.\d{2})?)/);
      expect(shown, `no amount in sentence for $${dollars}`).not.toBeNull();
      const shownCents = Math.round(Number(shown![1].replace(/,/g, "")) * 100);
      expect(shownCents, `$${dollars} gift`).toBe(chargeCents);
    }
  });

  it("pins the cents: a $10 gift reads $10.61, a $25 gift exactly $26 (the $1 cap)", () => {
    expect(giftChargeSentence(1000 + giftCardHandlingFeeCents(1000))).toBe("You'll be charged $10.61 in total.");
    expect(giftChargeSentence(2500 + giftCardHandlingFeeCents(2500))).toBe(
      "You'll be charged $26 in total.",
    );
  });

  it("states only the total, never a fee figure", () => {
    expect(giftChargeSentence(2606)).not.toMatch(/fee|processing/i);
    expect(giftChargeSentence(null)).toBe("Your total is shown before you pay.");
  });

  it("is the sentence the Gift Card screen renders", () => {
    const src = blankComments(readFileSync("src/pages/profile/GiftCard.tsx", "utf8"));
    expect(src).toContain("giftChargeSentence(giftTotalCents)");
    expect(src).not.toMatch(/charged \$\$\{/);
  });
});

// Round the total to whole dollars again (the A3-B2 defect): the first test fails.
// @mutate src/pages/profile/giftCards/giftChargeSentence.ts | formatPriceExact(totalCents / 100) | Math.round(totalCents / 100)
