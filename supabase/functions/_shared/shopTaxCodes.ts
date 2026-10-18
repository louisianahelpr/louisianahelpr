// shopTaxCodes — the Stripe Tax product code for each Shops item kind (owner
// O1, 2026-10-17: the app collects sales tax on Shops sales with Stripe Tax
// from day one, a code per item kind).
//
// Stripe's own rule (docs.stripe.com/tax/tax-codes, "Guidance for AI agents"):
// never construct or infer a txcd_ code, and do not make the legal tax
// classification; use only a code confirmed in the Tax Codes API list. The one
// code confirmed there for goods (GET /v1/tax_codes, 2026-10-17) is
// txcd_99999999 "General - Tangible Goods". Every kind uses it until the CPA
// answers CPA2 (home-made food: the state food-for-home-consumption exemption vs
// parish tax): that may OVER-collect on exempt food, a different exposure, not
// none (same trade as salesTax.ts's handyman note). Changing a kind's code is
// an owner/CPA decision; src/test/shopTaxCodes.test.ts pins this table.
// The code itself lives in salesTax.ts, the one module that may spell a txcd_ code
// (src/test/stripeTaxCodes.test.ts).
import { GENERAL_TANGIBLE_GOODS_TAX_CODE } from "./salesTax.ts";

export const SHOP_KIND_TAX_CODE: Readonly<Record<"made" | "home_food" | "farm", string>> = {
  made: GENERAL_TANGIBLE_GOODS_TAX_CODE,
  home_food: GENERAL_TANGIBLE_GOODS_TAX_CODE,
  farm: GENERAL_TANGIBLE_GOODS_TAX_CODE,
};

/** The code for a line's kind; an unknown kind fails closed (throws) so nothing is charged untaxed by accident. */
export function shopTaxCode(kind: string): string {
  const code = (SHOP_KIND_TAX_CODE as Record<string, string | undefined>)[kind];
  if (!code) throw new Error(`no tax code for shop item kind ${kind}`);
  return code;
}
