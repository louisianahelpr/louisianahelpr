/**
 * Audit 1a #15 (2026-10-29): Stripe's Declutter page read "Pay Helpr $15.30" on one
 * purchase and "Declutter purchase $26.95" on another. The purchase line always names
 * what is being bought (supabase/functions/_shared/declutterCheckoutName.ts); the
 * edge side (that declutter-checkout sends it) is src/test/edge/declutter-payments.test.ts.
 *
 * @mutate supabase/functions/_shared/declutterCheckoutName.ts |   if (clean.length === 0) return DECLUTTER_CHECKOUT_FALLBACK_NAME; |   return DECLUTTER_CHECKOUT_FALLBACK_NAME;
 * @mutate supabase/functions/_shared/declutterCheckoutName.ts |   return more === 0 ? first : `${first} + ${more} more ${more === 1 ? "item" : "items"}`; |   return first;
 */
import { describe, expect, it } from "vitest";
import {
  DECLUTTER_CHECKOUT_FALLBACK_NAME,
  declutterCheckoutLineName,
} from "../../supabase/functions/_shared/declutterCheckoutName";

describe("declutterCheckoutLineName", () => {
  it("one item: its own title, spaces tidied", () => {
    expect(declutterCheckoutLineName(["  Blue   coffee mug "])).toBe("Blue coffee mug");
  });
  it("a bundle: the first title (stable order) and how many more", () => {
    expect(declutterCheckoutLineName(["Lamp", "Desk"])).toBe("Desk + 1 more item");
    expect(declutterCheckoutLineName(["Lamp", "Desk", "Chair"])).toBe("Chair + 2 more items");
  });
  it("no readable title falls back to the generic name, never an empty Stripe line", () => {
    expect(declutterCheckoutLineName([])).toBe(DECLUTTER_CHECKOUT_FALLBACK_NAME);
    expect(declutterCheckoutLineName([null, undefined, "   "])).toBe(DECLUTTER_CHECKOUT_FALLBACK_NAME);
  });
});
