/**
 * Shops M15 + owner answer 5 (11-05): the home-food yearly limit is the law's $100,000 (La. R.S. 40:4.9(B), Act 801 of
 * 2026), and a shop item may cost up to $5,000 (migration 20261105191330_shops_caps.sql).
 *
 * Read from the NEWEST definitions: the item field check, the newest price CHECKs on shop_items and shop_order_lines
 * (no later migration may narrow them back without failing here), the limit the migrations leave, and the app's copy.
 * Behaviour: src/test/pglite/shopsCaps.pglite.mjs (11/11 applied 3x; --before 5 FAIL).
 *
 * @mutate supabase/migrations/20261105235833_shops_every_category_sells.sql |   IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 500000 THEN | IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 100000 THEN
 * @mutate supabase/migrations/20261105191330_shops_caps.sql |    SET cap_cents = 10000000, |    SET cap_cents = 3000000,
 * @mutate supabase/migrations/20261105191330_shops_caps.sql | ADD CONSTRAINT shop_items_price_cents_check CHECK (price_cents BETWEEN 100 AND 500000); | ADD CONSTRAINT shop_items_price_cents_check CHECK (price_cents BETWEEN 100 AND 100000);
 * @mutate supabase/migrations/20261105191330_shops_caps.sql | ADD CONSTRAINT shop_order_lines_unit_cents_check CHECK (unit_cents BETWEEN 100 AND 500000); | ADD CONSTRAINT shop_order_lines_unit_cents_check CHECK (unit_cents BETWEEN 100 AND 100000);
 * @mutate src/lib/shops/errors.ts | export const SHOP_ITEM_MAX_PRICE_CENTS = 500_000; | export const SHOP_ITEM_MAX_PRICE_CENTS = 100_000;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { SHOPS_ERROR_COPY, SHOP_ITEM_MAX_PRICE_CENTS } from "@/lib/shops/errors";

const root = resolve(__dirname, "../..");
const dir = resolve(root, "supabase/migrations");
const DEFS = effectiveDefs(dir);
const ws = (s: string) => s.replace(/\s+/g, " ");
/** Every migration, oldest first, comments blanked. */
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ f, sql: ws(blankSqlComments(readFileSync(resolve(dir, f), "utf8"))) }));
/** The newest migration that names `needle`, and its text. */
const newest = (needle: string) => [...migrations].reverse().find((m) => m.sql.includes(needle));

describe("Shops caps: the law's home-food limit and the owner's $5,000 item cap", () => {
  it("the item field check allows $1 to $5,000", () => {
    const fn = ws(blankSqlComments(DEFS.get("shops_check_item_fields")?.stmt ?? ""));
    expect(fn).toContain("p_price_cents NOT BETWEEN 100 AND 500000");
  });

  it("the newest price CHECKs on items and order lines are $1 to $5,000", () => {
    const items = newest("shop_items_price_cents_check CHECK");
    expect(items?.sql).toContain("ADD CONSTRAINT shop_items_price_cents_check CHECK (price_cents BETWEEN 100 AND 500000)");
    const lines = newest("shop_order_lines_unit_cents_check CHECK");
    expect(lines?.sql).toContain("ADD CONSTRAINT shop_order_lines_unit_cents_check CHECK (unit_cents BETWEEN 100 AND 500000)");
  });

  it("the newest write of the home-food limit is $100,000, and it never overwrites a value set by hand", () => {
    const m = newest("UPDATE public.shop_cottage_settings");
    expect(m).toBeTruthy();
    const stmt = m!.sql.slice(m!.sql.lastIndexOf("UPDATE public.shop_cottage_settings"));
    expect(stmt).toMatch(/^UPDATE public\.shop_cottage_settings SET cap_cents = 10000000,/);
    expect(stmt).toContain("WHERE id AND cap_cents = 3000000;");
    expect(migrations.filter((x) => x.sql.includes("UPDATE public.shop_cottage_settings")).length).toBeGreaterThan(0);
  });

  it("the app tells a shop the same cap the SQL holds", () => {
    const fn = ws(blankSqlComments(DEFS.get("shops_check_item_fields")?.stmt ?? ""));
    expect(fn).toContain(`p_price_cents NOT BETWEEN 100 AND ${SHOP_ITEM_MAX_PRICE_CENTS}`);
    expect(SHOPS_ERROR_COPY.invalid_price).toBe("Set a price from $1 to $5,000.");
  });
});
