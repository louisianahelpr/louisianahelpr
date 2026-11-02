/**
 * Q2259 shipping S6 part 2e (spec 5.3 "Debts (review fix 4)", section 11 fix 4): no new shipped sale while the seller owes
 * a shipping fee debt. A BEFORE INSERT trigger on declutter_orders refuses handover 'ship' (handover_not_offered) while a
 * ship_* debt has remaining_cents > 0. Read from the newest definitions. Behaviour proven in PGlite:
 * src/test/pglite/shippingDebtBlocksNewShipSales.pglite.mjs (45/45; skip and plants RED).
 *
 * @mutate supabase/migrations/20261102054411_shipping_debt_blocks_new_ship_sales.sql |           AND d.remaining_cents > 0) THEN |           AND d.remaining_cents >= 0) THEN
 * @mutate supabase/migrations/20261102054411_shipping_debt_blocks_new_ship_sales.sql | d.source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected') | d.source_kind IN ('ship_label')
 * @mutate supabase/migrations/20261102054411_shipping_debt_blocks_new_ship_sales.sql |         WHERE d.seller_id = NEW.seller_id |         WHERE d.seller_id = NEW.buyer_id
 * @mutate supabase/migrations/20261102054411_shipping_debt_blocks_new_ship_sales.sql | BEFORE INSERT ON public.declutter_orders | AFTER UPDATE ON public.declutter_orders
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");
/** The newest CREATE of a function: its own statement only (to the next dollar-quote close of any tag). */
const newestFn = (name: string) => {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`);
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const m = head.exec(sql);
    if (!m) continue;
    const tag = /AS (\$[A-Za-z_]*\$)/.exec(sql.slice(m.index))?.[1] ?? "$$";
    const open = sql.indexOf(tag, m.index);
    const close = sql.indexOf(tag, open + tag.length);
    return { file: f, sql: flat(sql.slice(m.index, close + tag.length)) };
  }
  throw new Error(`no migration defines ${name}`);
};
const newestStmt = (re: RegExp) => {
  for (const f of [...files].reverse()) {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, f), "utf8")));
    const m = re.exec(sql);
    if (m) return { file: f, stmt: m[0] };
  }
  throw new Error(`no migration matches ${re}`);
};
const SHIP_KINDS = ["'ship_adjustment'", "'ship_hazmat_fee'", "'ship_label'", "'ship_void_rejected'"];

describe("an open shipping debt blocks new shipped sales (S6 2e)", () => {
  it("the trigger refuses a ship order while the seller owes any shipping debt", () => {
    const { file, sql } = newestFn("declutter_ship_debt_blocks_sale");
    expect(file >= "20261102054411").toBe(true);
    expect(sql).toContain("IF NEW.handover = 'ship' AND EXISTS ( SELECT 1 FROM public.declutter_seller_fee_debts d WHERE d.seller_id = NEW.seller_id");
    const kinds = (/d\.source_kind IN \(([^)]*)\)/.exec(sql)?.[1].match(/'[a-z_]+'/g) ?? []).sort();
    expect(kinds).toEqual(SHIP_KINDS);
    expect(kinds.length).toBeGreaterThan(3);
    expect(sql).toContain("AND d.remaining_cents > 0) THEN RAISE EXCEPTION 'handover_not_offered'");
  });
  it("runs before every new declutter order", () => {
    const t = newestStmt(/CREATE TRIGGER trg_declutter_orders_ship_debt [^;]*;/);
    expect(t.stmt).toBe("CREATE TRIGGER trg_declutter_orders_ship_debt BEFORE INSERT ON public.declutter_orders FOR EACH ROW WHEN (NEW.handover = 'ship') EXECUTE FUNCTION public.declutter_ship_debt_blocks_sale();");
  });
  it("every shipping debt kind the ledger allows is one the gate reads", () => {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, "20261102043018_shipping_debt_source_key.sql"), "utf8")));
    const allowed = (/OR \(source_kind IN \(([^)]*)\)/.exec(sql)?.[1].match(/'[a-z_]+'/g) ?? []).sort();
    expect(allowed).toEqual(SHIP_KINDS);
  });
});
