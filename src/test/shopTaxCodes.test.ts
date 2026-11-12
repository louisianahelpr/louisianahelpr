/**
 * Shops sales tax codes (owner O1, 2026-10-17; codes per the tax memo the owner
 * adopted in place of a CPA, Q2: food for home on txcd_40040000, made goods on
 * txcd_99999999; Q5: the buyer's fee follows the items it is charged on, split
 * pro rata). Every kind an order line can carry (read from the newest
 * shop_order_lines kind CHECK in supabase/migrations) maps to a code in
 * _shared/shopTaxCodes.ts, every code is one confirmed in Stripe's Tax Codes API
 * list, and shop-checkout takes each line's code from the table, never a literal.
 */
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   home_food: FOOD_FOR_HOME_TAX_CODE, |   home_food: "txcd_40030000",
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   home_food: FOOD_FOR_HOME_TAX_CODE, |   home_food: GENERAL_TANGIBLE_GOODS_TAX_CODE,
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   farm: FOOD_FOR_HOME_TAX_CODE, |   farm: GENERAL_TANGIBLE_GOODS_TAX_CODE,
// @mutate supabase/functions/_shared/shopTaxCodes.ts |     p.cents += 1; |     p.cents += 0;
// @mutate supabase/functions/shop-checkout/index.ts | product_data: taxed(feeLineName(part.tax_code, feeParts.length), part.tax_code), | product_data: taxed(feeLineName(part.tax_code, feeParts.length), "txcd_00000000"),
// @mutate supabase/functions/shop-checkout/index.ts | product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind, l.tax_kind)), | product_data: taxed(l.title.slice(0, 120), "txcd_99999999"),
// @mutate supabase/functions/shop-checkout/index.ts | product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind, l.tax_kind)), | product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind, null)),
// @mutate supabase/functions/shop-checkout/index.ts | .select("title, kind, tax_kind, at_buyer, unit_cents, quantity, line_cents") | .select("title, kind, at_buyer, unit_cents, quantity, line_cents")
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   rental: GENERAL_TANGIBLE_GOODS_TAX_CODE, |   rental: FOOD_FOR_HOME_TAX_CODE,
// @mutate supabase/functions/_shared/shopTaxCodes.ts |     return laborTaxCode(null, taxKind ?? null); |     return laborTaxCode(null, null);
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   if (taxKind != null) throw new Error(`a ${kind} line carries no tax answer (${taxKind})`);\n |
// @mutate supabase/functions/_shared/shopTaxCodes.ts |     const code = shopTaxCode(l.kind, l.tax_kind); |     const code = shopTaxCode(l.kind);
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   digital_art: DIGITAL_ART_TAX_CODE, |   digital_art: DIGITAL_BOOK_TAX_CODE,
// @mutate supabase/functions/_shared/salesTax.ts | export const DIGITAL_BOOK_TAX_CODE = "txcd_10302000"; | export const DIGITAL_BOOK_TAX_CODE = "txcd_10302001";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SHOP_DIGITAL_TAX_CODE, SHOP_KIND_TAX_CODE, SHOP_SERVICE_TAX_KINDS, shopTaxCode, splitBuyerFeeByTaxCode } from "../../supabase/functions/_shared/shopTaxCodes";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

/** Codes confirmed in Stripe's Tax Codes API list (read-only, 2026-10-17). Add one only after reading it there. */
// txcd_40040000 read 2026-10-18 (GET /v1/tax_codes/txcd_40040000: "Food for Non-Immediate Consumption").
// Shops H8 (20261105235833): a service takes Jobs' labor codes, each read in Stripe's list for salesTax.ts
// (txcd_00000000, txcd_20080005, txcd_20090024, txcd_20090002, txcd_20090004; see its comments for the dates).
// Digital downloads (20261108182917): txcd_10302000 and txcd_10505001 read in Stripe's list 2026-11-08 (docs.stripe.com/tax/tax-codes).
const CONFIRMED_IN_STRIPE_LIST = new Set(["txcd_99999999", "txcd_40040000", "txcd_00000000", "txcd_20080005", "txcd_20090024", "txcd_20090002", "txcd_20090004", "txcd_10302000", "txcd_10505001"]);

/** The kinds the newest shop_order_lines kind CHECK allows: the CREATE TABLE's, or a later ADD CONSTRAINT's. */
function orderLineKinds(): string[] {
  let found: string[] | null = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    const table = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.shop_order_lines\s*\(([\s\S]*?)\n\);/i.exec(sql);
    const kind = table && /\bkind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(table[1]);
    if (kind) found = [...kind[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const added = /ALTER\s+TABLE\s+public\.shop_order_lines\s+ADD\s+CONSTRAINT\s+shop_order_lines_kind_check\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
    if (added) found = [...added[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return found ?? [];
}

describe("Shops tax codes: one table, every kind mapped (owner O1, lead 2026-10-18)", () => {
  const kinds = orderLineKinds();

  it("reads the real kind list from the migrations (floor)", () => {
    expect(kinds.length).toBeGreaterThan(2);
  });

  it("every kind an order line can carry has a code in the table, and the table has no stray kind", () => {
    // A service's and a download's code come from the line's tax answer, so they are the kinds not in the table.
    expect([...Object.keys(SHOP_KIND_TAX_CODE), "service", "digital"].sort()).toEqual([...kinds].sort());
    for (const k of kinds) expect(shopTaxCode(k, k === "digital" ? "digital_book" : null), k).toMatch(/^txcd_\d{8}$/);
  });

  it("food for home (every cottage home_food subtype, eggs and whole produce) is on the food code; made goods are general goods (tax memo Q2)", () => {
    expect(SHOP_KIND_TAX_CODE).toEqual({ made: "txcd_99999999", home_food: "txcd_40040000", farm: "txcd_40040000", rental: "txcd_99999999" });
  });

  it("every code is one confirmed in Stripe's list", () => {
    for (const [k, code] of Object.entries(SHOP_KIND_TAX_CODE)) expect(CONFIRMED_IN_STRIPE_LIST.has(code), `${k}: ${code}`).toBe(true);
    for (const t of [null, ...SHOP_SERVICE_TAX_KINDS]) expect(CONFIRMED_IN_STRIPE_LIST.has(shopTaxCode("service", t)), String(t)).toBe(true);
  });

  it("a service is taxed as Jobs taxes labor (R.S. 47:301.3): untaxed, unless it is one of the four taxed answers", () => {
    expect(shopTaxCode("service", null)).toBe("txcd_00000000");
    expect(shopTaxCode("service", "item_repair")).toBe("txcd_20080005");
    expect(shopTaxCode("service", "fabric_cleaning")).toBe("txcd_20090024");
    expect(shopTaxCode("service", "clothing_alterations")).toBe("txcd_20090002");
    expect(shopTaxCode("service", "clothes_cleaning")).toBe("txcd_20090004");
    // The SQL's four answers (the newest shop_order_lines_tax_kind_valid) are exactly the code's.
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, "20261105235833_shops_every_category_sells.sql"), "utf8"));
    const m = /shop_order_lines_tax_kind_valid\s+CHECK\s*\(tax_kind IS NULL OR \(kind = 'service' AND tax_kind IN \(([^)]*)\)/.exec(sql);
    expect([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...SHOP_SERVICE_TAX_KINDS].sort());
  });

  it("a download is a digital product (La. Acts 2024 3rd Ex. Sess. No. 10): books and art, permanent rights", () => {
    expect(shopTaxCode("digital", "digital_book")).toBe("txcd_10302000");
    expect(shopTaxCode("digital", "digital_art")).toBe("txcd_10505001");
    for (const t of Object.keys(SHOP_DIGITAL_TAX_CODE)) expect(CONFIRMED_IN_STRIPE_LIST.has(shopTaxCode("digital", t)), t).toBe(true);
    // A download with no answer, or one the list does not have, fails closed (never taxed at a guessed rate).
    expect(() => shopTaxCode("digital", null)).toThrow(/no tax code/);
    expect(() => shopTaxCode("digital", "item_repair")).toThrow(/no tax code/);
    // The SQL's digital answers (the newest shop_order_lines_tax_kind_valid) are exactly the code's.
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, "20261108182917_shops_digital_downloads.sql"), "utf8"));
    const m = /shop_order_lines_tax_kind_valid[\s\S]*?kind = 'digital' AND tax_kind IN \(([^)]*)\)/.exec(sql);
    expect([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual(Object.keys(SHOP_DIGITAL_TAX_CODE).sort());
  });

  it("a tax answer the service list does not have, or one on a non-service line, fails closed", () => {
    expect(() => shopTaxCode("service", "haircut")).toThrow(/no tax code/);
    expect(() => shopTaxCode("made", "item_repair")).toThrow(/no tax answer/);
  });

  it("an unknown kind fails closed (nothing is charged untaxed by accident)", () => {
    expect(() => shopTaxCode("auction")).toThrow(/no tax code/);
  });

  it("shop-checkout takes each item line's code from the table", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/shop-checkout/index.ts"), "utf8"));
    expect(src).toMatch(/taxed\(l\.title\.slice\(0, 120\), shopTaxCode\(l\.kind, l\.tax_kind\)\)/);
    // H8: the line's tax answer is read with it (a service's code needs it).
    expect(src).toContain('.select("title, kind, tax_kind, at_buyer, unit_cents, quantity, line_cents")');
    expect(src.match(/txcd_\d{8}/g) ?? []).toEqual([]);
    // The buyer's fee carries the items' codes (memo Q5), never the non-taxable one. The non-taxable lines are
    // the one-time account setup fee (Shops H4, 20261105181603; same as declutter-checkout's): import + that line.
    const nontaxable = [...src.matchAll(/^.*\bNONTAXABLE_TAX_CODE\b.*$/gm)].map((m) => m[0].trim());
    expect(nontaxable).toEqual([
      'import { NONTAXABLE_TAX_CODE } from "../_shared/salesTax.ts";',
      'product_data: taxed("One-time account setup fee", NONTAXABLE_TAX_CODE),',
      // Shops H6 (lh-money-escrow PASS d9f38cc9f7): the sales tax line itself is not taxed again.
      // Delivery (20261106180902): the shop's own fee, non-taxable as Declutter's "Seller delivery".
      // Helpr delivery (20261106223244): Declutter's Helpr price, non-taxable as Declutter's "Helpr delivery".
      'product_data: taxed(fulfillment === "helpr_delivers" ? "Helpr delivery" : "Shop delivery", NONTAXABLE_TAX_CODE),',
      'product_data: { name: "Sales tax", description: atHome ? "Louisiana sales tax where the work is done" : fulfillment !== "pickup" ? "Louisiana sales tax where the order is delivered" : "Louisiana sales tax where you pick up the order", tax_code: NONTAXABLE_TAX_CODE },',
      // Q2105 gift cards at Shops (lh-money-escrow PASS-with-notes; refused server-side unless SHOP_GIFT_CARDS is "on"): what is
      // left after the gift card is one line that already carries the order's tax, so it is not taxed again.
      'product_data: { name: "Your Shops order", description: "What is left after your gift card, sales tax included", tax_code: NONTAXABLE_TAX_CODE },',
      // Digital downloads (buy_digital, 20261108185110): the same setup fee and sales tax lines, at the billing address.
      'product_data: taxed("One-time account setup fee", NONTAXABLE_TAX_CODE) } });',
      'product_data: { name: "Sales tax", description: "Sales tax where you live (your billing address)", tax_code: NONTAXABLE_TAX_CODE } } });',
      // Custom orders 2b: the rest of a 50% deposit order already carries its share of the order's tax (figured once).
      'product_data: { name: "Rest of your custom order", description: "Sales tax included", tax_code: NONTAXABLE_TAX_CODE },',
    ]);
    expect(src).toMatch(/splitBuyerFeeByTaxCode\(lines, o\.premium_cents\)/);
  });
});

describe("the buyer's fee follows the items' tax codes (tax memo Q5)", () => {
  const food = (c: number) => ({ kind: "home_food", line_cents: c });
  const made = (c: number) => ({ kind: "made", line_cents: c });

  it("a service's fee follows its own code (untaxed lesson, taxed repair)", () => {
    expect(splitBuyerFeeByTaxCode([{ kind: "service", tax_kind: null, line_cents: 3000 }, { kind: "service", tax_kind: "item_repair", line_cents: 1000 }], 100))
      .toEqual([{ tax_code: "txcd_00000000", cents: 75 }, { tax_code: "txcd_20080005", cents: 25 }]);
  });

  it("one code: the whole fee on that code", () => {
    expect(splitBuyerFeeByTaxCode([food(3600), { kind: "farm", line_cents: 500 }], 275)).toEqual([{ tax_code: "txcd_40040000", cents: 275 }]);
    expect(splitBuyerFeeByTaxCode([made(2500)], 195)).toEqual([{ tax_code: "txcd_99999999", cents: 195 }]);
  });

  it("a mixed cart splits pro rata by item cents, in first-seen order", () => {
    // 375 * 3600 / 6100 = 221.31..., 375 * 2500 / 6100 = 153.68... -> 221 + 154
    expect(splitBuyerFeeByTaxCode([food(3600), made(2500)], 375)).toEqual([
      { tax_code: "txcd_40040000", cents: 221 }, { tax_code: "txcd_99999999", cents: 154 },
    ]);
  });

  it("the parts always add up to the fee exactly", () => {
    for (let a = 100; a < 5000; a += 137) for (let b = 100; b < 5000; b += 211) {
      const fee = Math.round((a + b) * 0.05) + 70;
      const parts = splitBuyerFeeByTaxCode([food(a), made(b)], fee);
      expect(parts.reduce((s, p) => s + p.cents, 0), `${a}/${b}`).toBe(fee);
    }
  });

  it("fails closed on an unknown kind or an empty cart", () => {
    const notAnOrderLineKind = "auction"; // no shop_items or order line kind
    expect(() => splitBuyerFeeByTaxCode([{ kind: notAnOrderLineKind, line_cents: 100 }], 75)).toThrow(/no tax code/);
    expect(() => splitBuyerFeeByTaxCode([], 75)).toThrow(/no items/);
  });
});
