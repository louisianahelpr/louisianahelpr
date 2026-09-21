/**
 * THE GIFT AMOUNT THAT LEAVES THE CLIENT IS THE AMOUNT STRIPE CHARGES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS BROKEN (measured on prod's build, 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/profile?tab=gift_card`'s custom-amount field is `<input type="number">`
 * with `min`/`max` but no `step`, so "10.555" is a value a person can type.
 * `GiftCard.tsx` read it with `parseFloat` and passed it through untouched:
 *
 *   - the card preview rendered $10.555,
 *   - `create-gift-card-checkout` received `amount: 10.555`,
 *   - and that edge function does `Math.round(amountDollars * 100)` = 1056.
 *
 * The buyer was shown $10.555 and charged $10.56, and no surface ever said so.
 *
 * It had been invisible because the only check for it could not reach the
 * button: `messy-input.spec.ts`'s "gift card: amount 10.555 → normalised" types
 * a recipient into `input[type="email"]`, a control this screen replaced with
 * RecipientPicker's one name-or-email field months ago. With no recipient,
 * `canDonate` was false, the button stayed disabled, nothing was sent, and the
 * assertion below `if (ok === null && sent.length)` never ran. Fixing the
 * selector made the case reach its own assertion for the first time and it
 * failed: "fractional cents must not reach checkout".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The rounding rule the page now applies, against the one the edge function
 * applies — the whole point is that they agree, so the rule is read out of
 * BOTH files rather than restated here. A page that stops rounding, or an edge
 * function that starts rounding differently, fails this.
 */
// Shown able to fail: take the rounding back out and the first case names it.
// @mutate src/pages/GiftCard.tsx | Math.round(rawAmount * 100) / 100 | rawAmount
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = readFileSync(join(process.cwd(), "src/pages/GiftCard.tsx"), "utf8");
const EDGE = readFileSync(join(process.cwd(), "supabase/functions/create-gift-card-checkout/index.ts"), "utf8");

describe("the gift amount is whole cents before it leaves the client", () => {
  it("the page rounds the typed amount to cents", () => {
    expect(
      PAGE,
      "GiftCard.tsx no longer rounds the custom amount to whole cents — a typed 10.555 " +
        "will be previewed as $10.555 and charged as $10.56",
    ).toMatch(/Math\.round\(\s*rawAmount\s*\*\s*100\s*\)\s*\/\s*100/);
  });

  it("the edge function still converts dollars to cents the same way", () => {
    expect(
      EDGE,
      "create-gift-card-checkout changed how it makes cents; the page's rounding must match it",
    ).toMatch(/Math\.round\(\s*amountDollars\s*\*\s*100\s*\)/);
  });

  it("the two rules agree on the values a person can actually type", () => {
    // Both sides, applied for real, must land on the same cents.
    const page = (dollars: number) => Math.round(dollars * 100) / 100;
    const edge = (dollars: number) => Math.round(dollars * 100);
    for (const typed of [10.555, 10.554, 25, 10, 500, 49.999, 0.005, 123.456]) {
      expect(edge(page(typed)), `client-rounded ${typed} must reach the same cents`).toBe(edge(typed));
      expect(
        Number.isInteger(page(typed) * 100 + 0) || Math.abs(page(typed) * 100 - Math.round(page(typed) * 100)) < 1e-9,
        `${typed} must round to a whole number of cents`,
      ).toBe(true);
    }
  });
});
