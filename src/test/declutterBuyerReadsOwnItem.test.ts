/**
 * DA-6 (Declutter audit 2026-10-30, browse-free REPORT.md): after buying or claiming an item its buyer was told
 * "This item isn't available." (the items read policy allowed only live/reserved items, or the seller), and the
 * item pickup-windows read answered "not found" as P0002, which PostgREST sends as HTTP 500.
 *
 * Reads the NEWEST definition of the items read policy (the last migration, by file name, that creates it; any
 * dollar-quote tag; SQL comments blanked) and the EFFECTIVE definition of declutter_item_pickup_windows.
 * Backend proof on a real database: src/test/pglite/declutterBuyerReadsOwnItem.pglite.mjs (3x; 7 FAIL without the
 * migration; RED with the paid-only condition removed: a missed, cancelled or unpaid line then reads the item).
 * @mutate supabase/migrations/20261102022901_declutter_items_hidden_from_blocked.sql |                   AND c.status = 'paid') |                   )
 * @mutate supabase/migrations/20261030080020_declutter_buyer_reads_own_item.sql | RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const POLICY = `CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items`;
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const withPolicy = files.filter((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).includes(POLICY));
const newest = withPolicy[withPolicy.length - 1] ?? "";
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = flat(blankSqlComments(readFileSync(join(MIG, newest), "utf8")));
const policy = body.slice(body.indexOf(POLICY), body.indexOf(";", body.indexOf(POLICY)));
const WINDOWS = flat(blankSqlComments(effectiveDefs(MIG).get("declutter_item_pickup_windows")?.stmt ?? ""));

describe("the buyer opens their own bought or claimed item; not found is a 404 (DA-6)", () => {
  it("reads the newest policy and the windows read (floors)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(withPolicy.length).toBeGreaterThan(2);
    expect(policy.length).toBeGreaterThan(300);
    expect(WINDOWS.length).toBeGreaterThan(400);
  });

  it("the items read policy lets the member read an item they hold a PAID cart line for, their own only", () => {
    expect(policy).toContain(
      "OR EXISTS (SELECT 1 FROM public.declutter_cart_items c WHERE c.item_id = declutter_items.id AND c.buyer_id = (SELECT auth.uid()) AND c.status = 'paid')",
    );
    // Browse stays as it was: live or reserved, behind the switch, not a hidden seller, seed rule.
    expect(policy).toContain("seller_id = (SELECT auth.uid()) OR (status IN ('live', 'reserved') AND (SELECT public.feature_enabled_for('declutter')) AND NOT seller_hidden");
  });

  it("the item pickup-windows read says item_not_found as PT404 (HTTP 404), not P0002 (HTTP 500)", () => {
    expect(WINDOWS).toContain("RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';");
    expect(WINDOWS).not.toContain("'P0002'");
  });
});
