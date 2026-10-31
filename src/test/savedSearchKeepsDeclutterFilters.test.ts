/**
 * BUY-13 (buying audit 10-30 #13): a saved Declutter search kept only words, category, price and distance; Free,
 * condition, porch pickup and price drops were dropped, so "Free" plus a category alerted on everything in it.
 * 20261031222115 adds free_only, porch_only, drops_only and conditions to saved_searches, and the alert and the "N new"
 * count apply them; the client saves them, opens Browse with them and names them on the row.
 *
 * Backend proof: src/test/pglite/savedSearchKeepsDeclutterFilters.pglite.mjs (3x replay; NEW_MIGRATION=skip RED; 4
 * MUTANTs fail). This guard reads the NEWEST function definitions (effectiveDefs).
 *
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |       AND (NOT s.free_only OR v_item.current_price_cents = 0)\n |
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |            AND (NOT s.porch_only OR i.porch_ok)\n |
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |   AND (section = 'declutter' OR (NOT free_only | AND (true OR (NOT free_only
 * @mutate src/lib/savedSearches.ts |     if (e.freeOnly) p.set("free", "1"); |     if (e.freeOnly) p.set("free", "0");
 * @mutate src/lib/savedSearches.ts |     if (e.conditions.length > 0) p.set("cond", e.conditions.join(",")); |     if (e.conditions.length > 0) p.set("stars", e.conditions.join(","));
 * @mutate src/lib/savedSearches.ts |     && a.freeOnly === b.freeOnly && a.porchOnly | && a.porchOnly
 * @mutate src/lib/savedSearches.ts |     ...(d.section === "declutter" && hasExtras(d.extras) ? extrasAsColumns(d.extras) : {}), |     ...{},
 * @mutate src/lib/savedSearches.ts |   if (res.error?.code === "42703") res = await read(COLUMNS); |   if (res.error?.code === "PGRST000") res = await read(COLUMNS);
 * @mutate src/lib/savedSearches.ts |   if (e.freeOnly) out.push("free"); |   if (e.freeOnly) out.push("");
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const db = vi.hoisted(() => ({ inserted: [] as unknown[], selects: [] as string[], selectAnswers: [] as { data: unknown; error: unknown }[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => { db.inserted.push(row); return { select: () => Promise.resolve({ data: [{ id: "new" }], error: null }) }; },
      select: (cols: string) => {
        db.selects.push(cols);
        const answer = db.selectAnswers.shift() ?? { data: [], error: null };
        const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve(answer) };
        return chain;
      },
    }),
  },
}));

import { createSavedSearch, fetchSavedSearches, filterWords, resultsPath, sameSearch, type SavedSearch, type SearchDraft } from "@/lib/savedSearches";
import { browseStateFromParams } from "@/lib/declutter/browseFilters";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const migration = blankSqlComments(readFileSync(join(MIG, "20261031222115_saved_search_keeps_declutter_filters.sql"), "utf8")).replace(/\s+/g, " ");

const ROW: SavedSearch = {
  id: "s1", name: "Furniture in Declutter", section: "declutter", query: null, category: "furniture", min_budget: null, max_budget: null,
  radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: true, last_seen_at: null,
  created_at: "2026-10-30T12:00:00.000Z", free_only: true, porch_only: true, drops_only: true, conditions: [5, 4],
};
const DRAFT: SearchDraft = { section: "declutter", query: "", category: "furniture", minDollars: null, maxDollars: null, radiusMiles: null };

describe("a saved Declutter search keeps Free, porch, drops and condition (BUY-13)", () => {
  it("the alert and the count apply all four (inventory floor)", () => {
    const deliver = body("deliver_saved_search_item_alerts");
    const count = body("saved_search_new_counts");
    expect(deliver.length).toBeGreaterThan(2000);
    expect(count.length).toBeGreaterThan(1500);
    for (const [fn, it] of [[deliver, "v_item"], [count, "i"]] as const) {
      expect(fn).toContain(`AND (NOT s.free_only OR ${it}.current_price_cents = 0)`);
      expect(fn).toContain(`AND (NOT s.porch_only OR ${it}.porch_ok)`);
      expect(fn).toContain(`AND (NOT s.drops_only OR (${it}.sale_mode = 'offers' AND NOT ${it}.drops_stopped AND COALESCE(${it}.drop_pct, 5) > 0))`);
      expect(fn).toContain(`AND (cardinality(s.conditions) = 0 OR ${it}.condition_stars = ANY (s.conditions))`);
    }
    // BUY-52's clauses are kept (this restates its copies, which land with it).
    expect(deliver).toContain("AND m.search_id = s.id AND NOT m.held))");
    expect(count).toContain("OR i.id IN (SELECT public.declutter_dropped_into_budget(");
  });

  it("the columns: off by default, Declutter only, stars 1 to 5", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS free_only boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS conditions smallint\[\] NOT NULL DEFAULT '\{\}'/);
    expect(migration).toMatch(/conditions <@ ARRAY\[1, 2, 3, 4, 5\]::smallint\[\]/);
    expect(migration).toMatch(/AND \(section = 'declutter' OR \(NOT free_only AND NOT porch_only AND NOT drops_only AND cardinality\(conditions\) = 0\)\)/);
  });

  it("the search opens Browse with them on, and its row names them", () => {
    const opened = browseStateFromParams(new URLSearchParams(resultsPath(ROW).split("?")[1]));
    expect(opened.filters).toMatchObject({ category: "furniture", freeOnly: true, porchOnly: true, dropsOnly: true, conditions: [4, 5] });
    expect(resultsPath({ ...ROW, free_only: false, porch_only: false, drops_only: false, conditions: [] })).not.toMatch(/free=|porch=|drops=|cond=/);
    expect(filterWords(ROW)).toEqual(["Furniture", "free", "porch pickup", "price drops", "4 or 5 stars"]);
    expect(filterWords({ ...ROW, conditions: [3, 4, 5] })).toContain("3, 4 or 5 stars");
  });

  it("Free (or any of them) makes it another search", () => {
    const plain = { ...ROW, free_only: false, porch_only: false, drops_only: false, conditions: [] };
    expect(sameSearch(plain, DRAFT)).toBe(true);
    expect(sameSearch(plain, { ...DRAFT, extras: { freeOnly: true, porchOnly: false, dropsOnly: false, conditions: [] } })).toBe(false);
    expect(sameSearch(ROW, { ...DRAFT, extras: { freeOnly: true, porchOnly: true, dropsOnly: true, conditions: [4, 5] } })).toBe(true);
    // A row from before the columns reads as none.
    const before: SavedSearch = { ...ROW };
    delete before.free_only; delete before.porch_only; delete before.drops_only; delete before.conditions;
    expect(sameSearch(before, DRAFT)).toBe(true);
  });

  it("the save sends them only when one is on; the list reads without them before they are deployed", async () => {
    await createSavedSearch("u1", { ...DRAFT, extras: { freeOnly: true, porchOnly: false, dropsOnly: false, conditions: [5, 4] } }, true);
    expect(db.inserted[db.inserted.length - 1]).toMatchObject({ category: "furniture", free_only: true, porch_only: false, drops_only: false, conditions: [4, 5] });
    await createSavedSearch("u1", DRAFT, true);
    expect(db.inserted[db.inserted.length - 1]).not.toHaveProperty("free_only");
    await createSavedSearch("u1", { ...DRAFT, section: "jobs", extras: { freeOnly: true, porchOnly: false, dropsOnly: false, conditions: [] } }, true);
    expect(db.inserted[db.inserted.length - 1]).not.toHaveProperty("free_only");

    db.selects.length = 0;
    db.selectAnswers.push({ data: null, error: { code: "42703", message: "column saved_searches.free_only does not exist" } }, { data: [{ ...DRAFT, id: "s9" }], error: null });
    const rows = await fetchSavedSearches("u1");
    expect(db.selects[0]).toContain(",free_only,porch_only,drops_only,conditions");
    expect(db.selects[1]).not.toContain("free_only");
    expect(db.selects[1]).toContain("notify_email");
    // Read with the columns before BUY-13, not the oldest ones (which make every row a Jobs search).
    expect(rows.map((r) => [r.id, r.section])).toEqual([["s9", "declutter"]]);
  });
});
