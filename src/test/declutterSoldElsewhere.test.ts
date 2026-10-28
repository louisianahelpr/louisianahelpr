/**
 * "Mark sold elsewhere" is not "Delete" (Declutter audit 2, SE2-1; Q?soldelsewhere; migration 20261028192719).
 *
 * THE CLASS. Two different outcomes shared one write: Manage listing's "Mark sold elsewhere" and "Delete"
 * both called declutter_withdraw_item, so a listing sold elsewhere became 'withdrawn' ("Taken down") like a
 * deleted one and no record of the sale was kept. Now 'sold_elsewhere' is its own item status, written only by
 * declutter_mark_sold_elsewhere, and Delete stays a withdraw.
 *
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs) and the newest status CHECK. Backend proof:
 * src/test/pglite/declutterSoldElsewhere.pglite.mjs (3x replay; red without the migration, 19 FAIL; red on 6
 * planted defects: written as 'withdrawn', a draft or a reserved item allowed, photos kept, offers left open,
 * no switch gate).
 */
// @mutate supabase/migrations/20261028192719_declutter_sold_elsewhere.sql |   UPDATE public.declutter_items SET status = 'sold_elsewhere', updated_at = now() WHERE id = p_item_id; |   UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now() WHERE id = p_item_id;
// @mutate supabase/migrations/20261028192719_declutter_sold_elsewhere.sql |   'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere' |   'ended', 'withdrawn', 'rejected', 'removed'
// @mutate supabase/migrations/20261028192719_declutter_sold_elsewhere.sql |   PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN |   IF public.is_caller_banned() THEN
// @mutate supabase/migrations/20261028192719_declutter_sold_elsewhere.sql | IF v_item.status NOT IN ('pending_review', 'live', 'paused', 'ended') THEN | IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'ended', 'reserved') THEN
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

/** The statuses of the NEWEST declutter_items_status_check the migrations add. */
function itemStatuses(): string[] {
  let last = "";
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/ADD CONSTRAINT declutter_items_status_check CHECK \(status IN \(([^)]*)\)\)/g)) last = m[1];
  }
  return [...last.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("Declutter: sold elsewhere is its own outcome, Delete stays a withdraw", () => {
  const statuses = itemStatuses();

  it("reads the status list and both RPCs (floors)", () => {
    expect(statuses.length).toBeGreaterThan(10);
    expect(flat("declutter_mark_sold_elsewhere").length).toBeGreaterThan(500);
    expect(flat("declutter_withdraw_item").length).toBeGreaterThan(500);
  });

  it("'sold_elsewhere' is an item status, and every earlier one is kept", () => {
    for (const s of ["draft", "pending_review", "live", "paused", "reserved", "sold", "completed", "ended", "withdrawn", "rejected", "removed", "sold_elsewhere"]) {
      expect(statuses, s).toContain(s);
    }
  });

  it("marking it sold elsewhere keeps the listing as 'sold_elsewhere', behind the switch, never a draft or an in-app sale", () => {
    const b = flat("declutter_mark_sold_elsewhere");
    expect(b).toMatch(/^.*?BEGIN PERFORM public\.require_feature\('declutter'\);/);
    expect(b).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE");
    expect(b).toContain("IF v_item.status NOT IN ('pending_review', 'live', 'paused', 'ended') THEN RAISE EXCEPTION 'item_not_editable'");
    expect(b).toContain("UPDATE public.declutter_items SET status = 'sold_elsewhere', updated_at = now() WHERE id = p_item_id;");
    expect(b).not.toContain("'withdrawn'");
    expect(b).not.toMatch(/DELETE FROM public\.declutter_items\b/);
  });

  it("Delete is still a withdraw and never writes 'sold_elsewhere'", () => {
    const b = flat("declutter_withdraw_item");
    expect(b).toContain("THEN 'withdrawn' ELSE v_item.status END");
    expect(b).not.toContain("sold_elsewhere");
  });
});
