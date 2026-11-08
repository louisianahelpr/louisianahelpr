// shopTaxCodes — the Stripe Tax product code for each Shops item kind (owner
// O1, 2026-10-17: the app collects sales tax on Shops sales with Stripe Tax
// from day one, a code per item kind), and how the buyer's fee is taxed.
//
// Codes follow the tax memo the owner adopted in place of a CPA
// (~/.lh-wt/handoffs-1017/tax-research-memo.md, Q2 table; owner 2026-10-17
// "tax memo adopted"): Louisiana exempts food for home consumption from the 5%
// STATE tax and taxes it at the LOCAL rate (R.S. 47:305(D)(1)(n)-(r); LAC
// 61:I.4401(F) lists bakery products and candy as food). Every home_food
// subtype is a cottage-law item (R.S. 40:4.9: baked goods, candy, cane syrup,
// dry mixes, honey, jams, pickles, sauces, spices; never hot, never served with
// utensils, so never "prepared food"), and farm is eggs and whole uncut
// produce: all txcd_40040000 "Food for Non-Immediate Consumption". Made goods
// stay txcd_99999999 "General - Tangible Goods".
//
// Stripe's own rule (docs.stripe.com/tax/tax-codes, "Guidance for AI agents"):
// never construct or infer a txcd_ code; use only a code confirmed in the Tax
// Codes API list. Both codes were read there (GET /v1/tax_codes/<id>,
// 2026-10-17 and 2026-10-18). MEASURED 2026-10-18 in Stripe TEST mode (Tax
// Calculation taxcalc_1URkeAKp2H4b7tECbW80Sxjo, Lafayette 70506, a test-mode
// Louisiana registration): $100 of txcd_99999999 -> $9.00 (state 5% + parish
// 2% + city 2%); $100 of txcd_40040000 -> $2.00 (state 0% product_exempt,
// parish 1% + city 1%); txcd_40100001 Candy came out the same as 40040000, so
// candy stays on the food code (owner confirmed both by pop-up 2026-10-18 ~17:00Z:
// the fee taxed like its items, candy on the food code). src/test/shopTaxCodes.test.ts pins this table.
// Both codes live in salesTax.ts, the one module that may spell a txcd_ code
// (src/test/stripeTaxCodes.test.ts).
//
// Shops H8 (owner 11-05, answer 1: every category sells; migration 20261105235833):
// - a RENTAL is the lease of tangible personal property, taxed like a sale of it (La. R.S. 47:301(7)(a) "lease or
//   rental", 47:302(B)), so General - Tangible Goods;
// - a SERVICE is taxed exactly as Jobs taxes labor (salesTax.ts laborTaxCode; R.S. 47:301.3, the enumerated list):
//   untaxed unless its type is a repair of a movable item, carpet/furniture cleaning, clothes cleaning or
//   alterations, which the order line carries as tax_kind (snapshotted from the item's type at the order).
// Digital downloads (owner 11-08; migration 20261108182917): like a service, the code comes from the line's tax answer,
// which the item's type carries ('digital_book' or 'digital_art', snapshotted onto the order line). A digital line
// with no answer fails closed. Codes and the Louisiana law are cited in salesTax.ts.
import {
  DIGITAL_ART_TAX_CODE, DIGITAL_BOOK_TAX_CODE, FOOD_FOR_HOME_TAX_CODE, GENERAL_TANGIBLE_GOODS_TAX_CODE, laborTaxCode,
} from "./salesTax.ts";

export const SHOP_KIND_TAX_CODE: Readonly<Record<"made" | "home_food" | "farm" | "rental", string>> = {
  made: GENERAL_TANGIBLE_GOODS_TAX_CODE,
  home_food: FOOD_FOR_HOME_TAX_CODE,
  farm: FOOD_FOR_HOME_TAX_CODE,
  rental: GENERAL_TANGIBLE_GOODS_TAX_CODE,
};

/** The four service answers an order line may carry (shop_order_lines.tax_kind, the jobs.tax_kind words). */
export const SHOP_SERVICE_TAX_KINDS: ReadonlySet<string> = new Set(["item_repair", "fabric_cleaning", "clothes_cleaning", "clothing_alterations"]);

/** The two digital answers an order line may carry, and their codes. */
export const SHOP_DIGITAL_TAX_CODE: Readonly<Record<string, string>> = {
  digital_book: DIGITAL_BOOK_TAX_CODE,
  digital_art: DIGITAL_ART_TAX_CODE,
};

/**
 * The code for a line's kind (and, for a service, its tax answer). An unknown kind, or a tax answer that is not one of
 * the four, fails closed (throws) so nothing is charged at a guessed rate.
 */
export function shopTaxCode(kind: string, taxKind?: string | null): string {
  if (kind === "digital") {
    const code = taxKind == null ? undefined : SHOP_DIGITAL_TAX_CODE[taxKind];
    if (!code) throw new Error(`no tax code for shop digital answer ${taxKind ?? "(none)"}`);
    return code;
  }
  if (kind === "service") {
    if (taxKind != null && !SHOP_SERVICE_TAX_KINDS.has(taxKind)) throw new Error(`no tax code for shop service answer ${taxKind}`);
    return laborTaxCode(null, taxKind ?? null);
  }
  if (taxKind != null) throw new Error(`a ${kind} line carries no tax answer (${taxKind})`);
  const code = (SHOP_KIND_TAX_CODE as Record<string, string | undefined>)[kind];
  if (!code) throw new Error(`no tax code for shop item kind ${kind}`);
  return code;
}

/**
 * The buyer's fee, split by tax code (memo Q5, "the fee follows the item"):
 * Louisiana's "sales price" includes services that are part of the sale
 * (R.S. 47:301(13)(a)) and the facilitator is the dealer, so the fee is taxed
 * like the items it is charged on; on a mixed cart it is split pro rata by the
 * items' cents. Largest-remainder rounding, so the parts add up to the fee
 * EXACTLY (shop-checkout also checks Stripe's subtotal against the order).
 * Codes come out in the order they first appear in the lines; a zero part is
 * dropped. Throws on an empty or zero-cents cart (nothing to split against).
 */
export function splitBuyerFeeByTaxCode(
  lines: ReadonlyArray<{ kind: string; tax_kind?: string | null; line_cents: number }>,
  feeCents: number,
): Array<{ tax_code: string; cents: number }> {
  if (!Number.isInteger(feeCents) || feeCents < 0) throw new Error(`bad buyer fee ${feeCents}`);
  const byCode = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.line_cents) || l.line_cents < 0) throw new Error(`bad line cents ${l.line_cents}`);
    const code = shopTaxCode(l.kind, l.tax_kind);
    byCode.set(code, (byCode.get(code) ?? 0) + l.line_cents);
  }
  const total = [...byCode.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("no items to split the buyer fee against");
  // Integer math (review nit, 2026-10-18): the remainder is exact, so ties break by order alone.
  const parts = [...byCode.entries()].map(([tax_code, cents], i) => {
    const rem = (feeCents * cents) % total;
    return { tax_code, cents: (feeCents * cents - rem) / total, rem, i };
  });
  let left = feeCents - parts.reduce((a, p) => a + p.cents, 0);
  for (const p of [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (left <= 0) break;
    p.cents += 1;
    left -= 1;
  }
  return parts.filter((p) => p.cents > 0).map(({ tax_code, cents }) => ({ tax_code, cents }));
}
