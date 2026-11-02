// Owner 2026-11-01 (via the lead): the owner's Buying tab showed "Your offers: Fixture rocking chair [E2E-PRODAUDIT]",
// an expired 10-19 offer by admin@ on an is_seed item. The CLASS: a Buying-tab list (the caller's offers, cart, free
// asks) must leave out a test item the caller may not see, by the same launch-switch rule as Browse
// (20261020033623: NOT is_seed OR NOT seed_hidden_in_discovery()), the seller still seeing their own. The two lists
// read through SECURITY DEFINER functions (past RLS), so the rule is in their NEWEST definitions; the free asks read
// under RLS with the item required (an inner join).
//
// @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |      AND (NOT i.is_seed OR i.seller_id = v_uid OR NOT public.seed_hidden_in_discovery()) |      AND true
// @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |      AND (i.id IS NULL OR NOT i.is_seed OR c.seller_id = v_uid OR NOT public.seed_hidden_in_discovery()) |      AND true
// @mutate src/lib/declutter/api.ts | status, created_at, declutter_items!inner(title) | status, created_at, declutter_items(title)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const LISTS = ["declutter_my_offers", "declutter_my_cart"];

describe("Buying lists leave out test items the caller may not see", () => {
  it("the inventory: both SECURITY DEFINER Buying lists exist", () => {
    for (const fn of LISTS) expect(DEFS.get(fn), fn).toBeTruthy();
    expect(LISTS.length).toBeGreaterThan(1);
  });

  it.each(LISTS)("%s (newest definition) asks the launch switch, and lets the seller keep their own", (fn) => {
    const body = blankSqlComments(DEFS.get(fn)!.stmt);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/NOT i\.is_seed OR (i|c)\.seller_id = v_uid OR NOT public\.seed_hidden_in_discovery\(\)/);
  });

  it("free asks require the item, so the items read policy's seed rule applies", () => {
    const api = readFileSync(resolve(__dirname, "../lib/declutter/api.ts"), "utf8");
    const fn = api.slice(api.indexOf("export async function fetchMyFreeRequests"), api.indexOf("export async function fetchOpenFreeRequestCounts"));
    expect(fn).toContain("declutter_items!inner(title)");
  });
});
