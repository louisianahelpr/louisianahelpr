/**
 * Q2259 shipping S6 part 2a (shipping-draft 5.3 "Debts", money review fix 4): the seller fee-debt ledger has ONE key,
 * (source_kind, source_ref) UNIQUE, so a shipping debt can be booked once per source. Read from the NEWEST migration
 * that restates declutter_fee_debts_one_source and the newest declutter_fee_debt_source() body. The behaviour itself
 * is proven in PGlite: src/test/pglite/shippingDebtSourceKey.pglite.mjs (40/40, 7 planted defects RED).
 *
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql | ADD CONSTRAINT declutter_fee_debts_source_once\n      UNIQUE (source_kind, source_ref); | ADD CONSTRAINT declutter_fee_debts_source_once\n      UNIQUE (source_kind, source_ref, id);
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql | AND num_nonnulls(%1$s) = 0) | AND num_nonnulls(%1$s) >= 0)
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql | (source_kind = 'refund_card_fee' AND refund_id = source_ref AND | (source_kind = 'refund_card_fee' AND
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql |   IF TG_OP = 'UPDATE' AND (NEW.source_kind | IF false AND (NEW.source_kind
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql | BEFORE INSERT OR UPDATE ON public.declutter_seller_fee_debts | BEFORE INSERT ON public.declutter_seller_fee_debts
 * @mutate supabase/migrations/20261102043018_shipping_debt_source_key.sql | ALTER COLUMN source_ref SET NOT NULL; | ALTER COLUMN source_ref DROP NOT NULL;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => blankSqlComments(readFileSync(join(DIR, f), "utf8"));
const newest = (re: RegExp) => {
  const f = [...files].reverse().find((n) => re.test(read(n)));
  if (!f) throw new Error(`no migration matches ${re}`);
  return { file: f, sql: read(f) };
};
const flat = (s: string) => s.replace(/\s+/g, " ");

const SHIP_KINDS = ["ship_label", "ship_adjustment", "ship_hazmat_fee", "ship_void_rejected"];

describe("the seller fee-debt ledger has one key (source_kind, source_ref) and can hold shipping debts", () => {
  const chk = newest(/ADD CONSTRAINT declutter_fee_debts_one_source/);
  const body = flat(chk.sql);

  it("the newest one-source rule lets a shipping kind name no source column, and ties every refund kind to its column", () => {
    expect(chk.file >= "20261102043018").toBe(true);
    const shipClause = /source_kind IN \(([^)]*)\) AND num_nonnulls\(%1\$s\) = 0\)/.exec(body);
    expect(shipClause, "the shipping clause").not.toBeNull();
    const kinds = [...shipClause![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual([...SHIP_KINDS].sort());
    expect(kinds.length).toBeGreaterThan(3);
    expect(body).toContain("(source_kind = 'refund_card_fee' AND refund_id = source_ref AND num_nonnulls(%1$s) = 1)");
    expect(body).toMatch(/shop_refund_id = source_ref/);
    expect(body).toMatch(/raise_id = source_ref/);
  });

  it("one debt per source: UNIQUE (source_kind, source_ref), both NOT NULL", () => {
    expect(body).toContain("ADD CONSTRAINT declutter_fee_debts_source_once UNIQUE (source_kind, source_ref);");
    expect(body).toContain("ALTER COLUMN source_kind SET NOT NULL;");
    expect(body).toContain("ALTER COLUMN source_ref SET NOT NULL;");
  });

  it("the trigger fills the pair on insert AND update and refuses a changed source", () => {
    const trg = newest(/CREATE TRIGGER trg_declutter_fee_debt_source/);
    expect(flat(trg.sql)).toContain("CREATE TRIGGER trg_declutter_fee_debt_source BEFORE INSERT OR UPDATE ON public.declutter_seller_fee_debts");
    const fn = newest(/FUNCTION public\.declutter_fee_debt_source\(\)/);
    const f = flat(fn.sql);
    expect(f).toMatch(/IF TG_OP = 'UPDATE' AND \(NEW\.source_kind IS DISTINCT FROM OLD\.source_kind OR NEW\.source_ref IS DISTINCT FROM OLD\.source_ref\) THEN RAISE EXCEPTION 'debt_source_is_fixed'/);
    expect(f).toContain("RAISE EXCEPTION 'debt_source_mismatch'");
    expect(f).toContain("REVOKE ALL ON FUNCTION public.declutter_fee_debt_source() FROM PUBLIC, anon, authenticated;");
  });
});
