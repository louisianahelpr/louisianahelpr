/**
 * Shops sales tax codes (owner O1, 2026-10-17; lead 2026-10-18: "use
 * txcd_99999999 General - Tangible Goods for all shop items for now, from the
 * one table in _shared/shopTaxCodes.ts; food codes switch when the CPA answers
 * CPA2"). Every kind an order line can carry (read from the newest
 * shop_order_lines kind CHECK in supabase/migrations) maps to a code in that
 * table, every code is one confirmed in Stripe's Tax Codes API list
 * (GET /v1/tax_codes, 2026-10-17), and shop-checkout takes each line's code
 * from the table, never a literal.
 */
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   farm: GENERAL_TANGIBLE_GOODS_TAX_CODE,\n |
// @mutate supabase/functions/_shared/shopTaxCodes.ts |   home_food: GENERAL_TANGIBLE_GOODS_TAX_CODE, |   home_food: "txcd_40030000",
// @mutate supabase/functions/shop-checkout/index.ts | tax_code: shopTaxCode(l.kind) | tax_code: "txcd_99999999"
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SHOP_KIND_TAX_CODE, shopTaxCode } from "../../supabase/functions/_shared/shopTaxCodes";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

/** Codes confirmed in Stripe's Tax Codes API list (read-only, 2026-10-17). Add one only after reading it there. */
const CONFIRMED_IN_STRIPE_LIST = new Set(["txcd_99999999"]);

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

  it("every code is one confirmed in Stripe's list (today: General - Tangible Goods for all, until the CPA answers CPA2)", () => {
    for (const [k, code] of Object.entries(SHOP_KIND_TAX_CODE)) expect(CONFIRMED_IN_STRIPE_LIST.has(code), `${k}: ${code}`).toBe(true);
  });

  it("an unknown kind fails closed (nothing is charged untaxed by accident)", () => {
    expect(() => shopTaxCode("rental")).toThrow(/no tax code/);
  });

  it("shop-checkout takes each item line's code from the table", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/shop-checkout/index.ts"), "utf8"));
    expect(src).toMatch(/tax_code:\s*shopTaxCode\(l\.kind\)/);
    // The only literal code there is the buyer's fee line's NONTAXABLE one, by name.
    expect(src.match(/txcd_\d{8}/g) ?? []).toEqual([]);
  });
});
