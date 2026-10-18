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
// @mutate supabase/functions/shop-checkout/index.ts | product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind)), | product_data: taxed(l.title.slice(0, 120), "txcd_99999999"),
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SHOP_KIND_TAX_CODE, shopTaxCode, splitBuyerFeeByTaxCode } from "../../supabase/functions/_shared/shopTaxCodes";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

/** Codes confirmed in Stripe's Tax Codes API list (read-only, 2026-10-17). Add one only after reading it there. */
// txcd_40040000 read 2026-10-18 (GET /v1/tax_codes/txcd_40040000: "Food for Non-Immediate Consumption").
const CONFIRMED_IN_STRIPE_LIST = new Set(["txcd_99999999", "txcd_40040000"]);

/** The kinds the newest shop_order_lines kind CHECK allows. */
function orderLineKinds(): string[] {
  let found: string[] | null = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    const table = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.shop_order_lines\s*\(([\s\S]*?)\n\);/i.exec(sql);
    if (!table) continue;
    const kind = /\bkind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(table[1]);
    if (kind) found = [...kind[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return found ?? [];
}

describe("Shops tax codes: one table, every kind mapped (owner O1, lead 2026-10-18)", () => {
  const kinds = orderLineKinds();

  it("reads the real kind list from the migrations (floor)", () => {
    expect(kinds.length).toBeGreaterThan(2);
  });

  it("every kind an order line can carry has a code in the table, and the table has no stray kind", () => {
    expect(Object.keys(SHOP_KIND_TAX_CODE).sort()).toEqual([...kinds].sort());
    for (const k of kinds) expect(shopTaxCode(k), k).toMatch(/^txcd_\d{8}$/);
  });

  it("food for home (every cottage home_food subtype, eggs and whole produce) is on the food code; made goods are general goods (tax memo Q2)", () => {
    expect(SHOP_KIND_TAX_CODE).toEqual({ made: "txcd_99999999", home_food: "txcd_40040000", farm: "txcd_40040000" });
  });

  it("every code is one confirmed in Stripe's list", () => {
    for (const [k, code] of Object.entries(SHOP_KIND_TAX_CODE)) expect(CONFIRMED_IN_STRIPE_LIST.has(code), `${k}: ${code}`).toBe(true);
  });

  it("an unknown kind fails closed (nothing is charged untaxed by accident)", () => {
    expect(() => shopTaxCode("rental")).toThrow(/no tax code/);
  });

  it("shop-checkout takes each item line's code from the table", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/shop-checkout/index.ts"), "utf8"));
    expect(src).toMatch(/taxed\(l\.title\.slice\(0, 120\), shopTaxCode\(l\.kind\)\)/);
    expect(src.match(/txcd_\d{8}/g) ?? []).toEqual([]);
    // The buyer's fee carries the items' codes (memo Q5), never the non-taxable one.
    expect(src).not.toMatch(/NONTAXABLE_TAX_CODE/);
    expect(src).toMatch(/splitBuyerFeeByTaxCode\(lines, o\.premium_cents\)/);
  });
});

describe("the buyer's fee follows the items' tax codes (tax memo Q5)", () => {
  const food = (c: number) => ({ kind: "home_food", line_cents: c });
  const made = (c: number) => ({ kind: "made", line_cents: c });

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
    const notAnOrderLineKind = "rental"; // a shop_items kind no order line can carry
    expect(() => splitBuyerFeeByTaxCode([{ kind: notAnOrderLineKind, line_cents: 100 }], 75)).toThrow(/no tax code/);
    expect(() => splitBuyerFeeByTaxCode([], 75)).toThrow(/no items/);
  });
});
