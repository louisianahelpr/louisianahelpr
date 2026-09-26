/**
 * CLASS GUARD (Q54, front/back parity): money bounds the CLIENT checks before
 * a round trip say the same number as the SERVER that refuses them.
 *
 * Covered here (everything else in the money family already has a parity
 * test — see docs/audit/parity-matrix-2026-09-26.md, family "Amounts"):
 *   - gift card min/max: GiftCard.tsx MIN_GIFT/MAX_GIFT (dollars) vs
 *     create-gift-card-checkout MIN_GIFT_CENTS/MAX_GIFT_CENTS. Both sides
 *     carried a "matches …" comment and nothing compared them.
 *   - tip ceiling at the STORAGE layer: the shared TIP_MAX_CENTS (client +
 *     create-payment, one constant already, tipFeesOneDefinition.test.ts) vs
 *     the tips_amount_positive CHECK (dollars). A cap raised in the module but
 *     not in the CHECK takes a charge the tips insert then refuses.
 *
 * @mutate src/pages/profile/GiftCard.tsx | const MIN_GIFT = 10; | const MIN_GIFT = 5;
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | const MAX_GIFT_CENTS = 50000; | const MAX_GIFT_CENTS = 100000;
 * @mutate supabase/functions/_shared/tipFees.ts | export const TIP_MAX_CENTS = 100_000; | export const TIP_MAX_CENTS = 200_000;
 * @mutate supabase/migrations/20260831160012_tips_no_client_writes.sql | CHECK (amount > 0 AND amount <= 1000) NOT VALID; | CHECK (amount > 0 AND amount <= 500) NOT VALID;
 */
import { describe, it, expect } from "vitest";
import { extractConstraints } from "./helpers/schemaConstraints";
import { numericConst } from "./helpers/parityReaders";

const GIFT_UI = "src/pages/profile/GiftCard.tsx";
const GIFT_FN = "supabase/functions/create-gift-card-checkout/index.ts";
const TIP_FEES = "supabase/functions/_shared/tipFees.ts";

function tipsAmountCheck() {
  const c = extractConstraints().get("tips")?.get("tips_amount_positive");
  if (!c || c.kind !== "range" || c.max === null || c.min === null) throw new Error("tips_amount_positive is not a parsed closed range");
  return c;
}

describe("money bounds agree between client and server (Q54)", () => {
  it("inventory floor: every number resolves", () => {
    for (const v of [
      numericConst(GIFT_UI, "MIN_GIFT"),
      numericConst(GIFT_UI, "MAX_GIFT"),
      numericConst(GIFT_FN, "MIN_GIFT_CENTS"),
      numericConst(GIFT_FN, "MAX_GIFT_CENTS"),
      numericConst(TIP_FEES, "TIP_MIN_CENTS"),
      numericConst(TIP_FEES, "TIP_MAX_CENTS"),
    ]) expect(v).toBeGreaterThan(0);
    expect(tipsAmountCheck().max).toBeGreaterThan(0);
  });

  it("gift card minimum: the form's dollars == the checkout's cents", () => {
    expect(numericConst(GIFT_UI, "MIN_GIFT") * 100).toBe(numericConst(GIFT_FN, "MIN_GIFT_CENTS"));
  });

  it("gift card maximum: the form's dollars == the checkout's cents", () => {
    expect(numericConst(GIFT_UI, "MAX_GIFT") * 100).toBe(numericConst(GIFT_FN, "MAX_GIFT_CENTS"));
  });

  it("tip ceiling: TIP_MAX_CENTS == the tips_amount_positive CHECK, and TIP_MIN_CENTS clears its floor", () => {
    const c = tipsAmountCheck();
    expect(numericConst(TIP_FEES, "TIP_MAX_CENTS"), "the tip cap and the tips CHECK disagree").toBe(c.max! * 100);
    const floorCents = c.min! * 100;
    const min = numericConst(TIP_FEES, "TIP_MIN_CENTS");
    expect(c.exclusiveMin ? min > floorCents : min >= floorCents, "the smallest allowed tip is refused by the CHECK").toBe(true);
  });
});
