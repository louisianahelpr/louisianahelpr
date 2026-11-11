/**
 * Whole-app audit 11-10 F359h (owner 11-11 ~2:10 PM; migration 20261111195156): blocking someone closes the OPEN
 * Declutter offers and trade offers between the two, either direction; accepted ones and paid orders are untouched,
 * and a failing close never stops the block (error_logs instead). The block sheet says so (blockSheetShortList).
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterBlockClosesOpenOffers.pglite.mjs (13/13 with the migration 3x; 5 FAIL without it,
 * 1 FAIL with the reverse direction planted out).
 */
// @mutate supabase/migrations/20261111195156_declutter_block_closes_open_offers.sql |     UPDATE public.declutter_offers\n       SET status = 'voided' |     UPDATE public.declutter_offers\n       SET status = 'open'
// @mutate supabase/migrations/20261111195156_declutter_block_closes_open_offers.sql | , updated_at = now(), voided_by_line = NULL | , updated_at = now()
// @mutate supabase/migrations/20261111195156_declutter_block_closes_open_offers.sql | CREATE TRIGGER trg_declutter_close_offers_across_block\n  AFTER INSERT ON public.user_blocks | CREATE TRIGGER trg_declutter_close_offers_across_block\n  AFTER DELETE ON public.user_blocks
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");
const def = effectiveDefs(DIR).get("declutter_close_offers_across_block");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

describe("F359h: a block closes the open Declutter offers between the two members", () => {
  it("reads the newest definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(500);
    expect(def?.file).toMatch(/20261111195156_declutter_block_closes_open_offers\.sql$/);
  });

  it("closes open offers and open trades in both directions, nothing else", () => {
    const pair = "((buyer_id = NEW.blocker_id AND seller_id = NEW.blocked_id) OR (buyer_id = NEW.blocked_id AND seller_id = NEW.blocker_id))";
    for (const table of ["declutter_offers", "declutter_swap_offers"]) {
      const at = flat.indexOf(`UPDATE public.${table} SET status = 'voided'`);
      expect(at, table).toBeGreaterThan(-1);
      const stmt = flat.slice(at, flat.indexOf(";", at));
      expect(stmt).toContain("WHERE status = 'open'");
      expect(stmt).toContain(pair);
      if (table === "declutter_offers") expect(stmt).toContain("voided_by_line = NULL");
    }
    expect(flat).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(flat).toContain("INSERT INTO public.error_logs");
  });

  it("the newest trigger runs it after each block insert", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    const last = files.filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("trg_declutter_close_offers_across_block")).pop() ?? "";
    const sql = blankSqlComments(readFileSync(resolve(DIR, last), "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain("CREATE TRIGGER trg_declutter_close_offers_across_block AFTER INSERT ON public.user_blocks FOR EACH ROW EXECUTE FUNCTION public.declutter_close_offers_across_block();");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_close_offers_across_block() FROM PUBLIC, anon, authenticated;");
  });
});
