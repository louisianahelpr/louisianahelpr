/**
 * Shops H8 (audit 11-05; owner answer 1, 11-05: "every category can list sellable items/services with a price"):
 * services and rentals are kinds that sell. Reads the EFFECTIVE (newest) definitions and the app's lists; behaviour on
 * a real database is src/test/pglite/shopsEveryCategorySells.pglite.mjs (3x, 12 planted defects each RED).
 *
 * @mutate supabase/migrations/20261105235833_shops_every_category_sells.sql |   IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN |   IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm') THEN
 * @mutate supabase/migrations/20261106194243_shops_option_words_checked.sql |   IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN\n    RAISE EXCEPTION 'invalid_kind' |   IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN\n    RAISE EXCEPTION 'invalid_kind'
 * @mutate supabase/migrations/20261106165310_shops_item_variants.sql |     IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN\n      RAISE EXCEPTION 'item_unavailable' |     IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN\n      RAISE EXCEPTION 'item_unavailable'
 * @mutate supabase/migrations/20261105235833_shops_every_category_sells.sql | CREATE TRIGGER shop_order_lines_snapshot_tax_kind BEFORE INSERT ON public.shop_order_lines | CREATE TRIGGER shop_order_lines_snapshot_tax_kind AFTER INSERT ON public.shop_order_lines
 * @mutate supabase/migrations/20261105235833_shops_every_category_sells.sql |   IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 500000 THEN |   IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 100000 THEN
 * @mutate supabase/functions/declutter-ai-draft/shopItemSanitize.ts |   rental: ["equipment_rental", "party_rental"],\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { SHOP_ITEM_KIND_LABEL, SHOP_ITEM_TYPE_LABEL } from "@/lib/shops/items";
import { SHOP_ITEM_SYSTEM_PROMPT, SHOP_ITEM_TYPES } from "../../supabase/functions/declutter-ai-draft/shopItemSanitize";

const ROOT = resolve(__dirname, "../..");
const MIG = "20261105235833_shops_every_category_sells.sql";
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const SQL = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", MIG), "utf8"));
const SELL = "('made', 'home_food', 'farm', 'service', 'rental')";

describe("Shops H8: every category sells (services and rentals, with a price)", () => {
  it("reads the newest definitions, and they are this migration's (floor)", () => {
    for (const fn of ["shops_check_item_fields", "shops_publish_item", "shops_request_order", "shop_item_required_statements", "shop_item_text_flag"]) {
      // A floor: a later migration may restate one (shops_request_order: 20261106165310 variants).
      expect((DEFS.get(fn)?.file ?? "") >= MIG, fn).toBe(true);
      expect(flat(fn).length, fn).toBeGreaterThan(200);
    }
  });

  it("the field check, publish and order all take the five kinds; rentals are no longer refused", () => {
    expect(flat("shops_check_item_fields")).toContain(`p_kind NOT IN ${SELL}`);
    expect(flat("shops_check_item_fields")).not.toContain("rental_not_available");
    expect(flat("shops_check_item_fields")).toContain("p_price_cents NOT BETWEEN 100 AND 500000");
    expect(flat("shops_publish_item")).toContain(`v_item.kind NOT IN ${SELL}`);
    expect(flat("shops_publish_item")).not.toContain("rental_not_available");
    expect(flat("shops_request_order")).toContain(`v_item.kind NOT IN ${SELL}`);
    expect(flat("shops_publish_item")).toContain("PERFORM public.require_feature('shops')");
    expect(flat("shops_request_order")).toContain("PERFORM public.require_feature('shops')");
  });

  it("the order line takes its tax answer from the item's type, before the row is written", () => {
    expect(SQL.replace(/\s+/g, " ")).toContain("CREATE TRIGGER shop_order_lines_snapshot_tax_kind BEFORE INSERT ON public.shop_order_lines");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.shop_order_line_snapshot_tax_kind\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it("the app's types and labels are the SQL rows (service and rental), word for word", () => {
    const ins = /INSERT INTO public\.shop_item_subtypes \(slug, kind, label, position, tax_kind\) VALUES([\s\S]*?)ON CONFLICT/.exec(SQL)?.[1] ?? "";
    const rows = [...ins.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([^']+)'/g)].map((m) => ({ slug: m[1], kind: m[2], label: m[3] }));
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(SHOP_ITEM_TYPE_LABEL[r.slug], r.slug).toBe(r.label);
    expect([...SHOP_ITEM_TYPES.service, ...SHOP_ITEM_TYPES.rental].sort()).toEqual(rows.map((r) => r.slug).sort());
    expect(SHOP_ITEM_KIND_LABEL.service).toBeTruthy();
    expect(SHOP_ITEM_KIND_LABEL.rental).toBeTruthy();
    expect(rows.some((r) => /bounce|inflat/.test(r.slug))).toBe(false);
  });

  it("the AI draft knows the two kinds, and still flags an inflatable", () => {
    expect(SHOP_ITEM_SYSTEM_PROMPT).toContain("service (work the seller does");
    expect(SHOP_ITEM_SYSTEM_PROMPT).toContain("rental (a thing the seller rents out; it may be used)");
    expect(SHOP_ITEM_SYSTEM_PROMPT).toContain("A bounce house or any other inflatable is possibly_banned");
  });
});
