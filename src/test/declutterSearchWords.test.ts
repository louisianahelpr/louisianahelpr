/**
 * Declutter search matches every WORD (audit DA-1, 2026-10-30, live site: "mug blue", "mugs" and "kitchen" found
 * nothing, because Browse matched the whole query as one exact phrase inside the title, and the saved-search alerts
 * did the same with strpos).
 *
 * One rule (src/lib/declutter/searchMatch.ts): every query word, in the title, description or category key, with
 * simple plurals folded. Browse filters with it, /search (SearchPage.tsx) asks the database with searchOrFilter
 * and re-checks the rows with it, and both server readers of a Declutter saved search (the alert
 * sender and the "N new" count) call public.declutter_search_matches, its SQL twin. The two agree case by case in
 * src/test/pglite/declutterSearchMatchParity.pglite.mjs (red with NEW_MIGRATION=skip, migration applied 3x).
 *
 * @mutate src/lib/declutter/browseFilters.ts |     if (!matchesSearch(query, item)) return false; |     if (query.trim() && !item.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
 * @mutate src/lib/declutter/searchMatch.ts |   return words.every((w) => text.includes(w)); |   return text.includes(words.join(" "));
 * @mutate src/lib/declutter/searchMatch.ts |   if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1); |
 * @mutate src/lib/declutter/searchMatch.ts |   return [title, description ?? "", (category ?? "").replace(/_/g, " ")] |   return [title]
 * @mutate src/pages/search/SearchPage.tsx |         .or(searchOrFilter(q) ?? "title.ilike.*") |         .ilike("title", likePattern(q))
 * @mutate src/pages/search/SearchPage.tsx |       const rows = all.filter((it) => matchesSearch(q, it)); |       const rows = all;
 * @mutate src/lib/declutter/searchMatch.ts |     const loose = w.length >= 3 && w.endsWith("y") ? w.slice(0, -1) : w; |     const loose = w;
 * @mutate src/lib/declutter/searchMatch.ts |     return `or(title.ilike.*${loose}*,description.ilike.*${loose}*,category.ilike.*${loose}*)`; |     return `or(title.ilike.*${loose}*)`;
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |       AND public.declutter_search_matches(s.query, v_item.title, v_item.description, v_item.category) |       AND (s.query IS NULL OR strpos(lower(v_item.title), lower(btrim(s.query))) > 0)
 * @mutate supabase/migrations/20261031224850_saved_search_price_drop_counts.sql |           AND public.declutter_search_matches(s.query, i.title, i.description, i.category) |           AND (s.query IS NULL OR strpos(lower(i.title), lower(btrim(s.query))) > 0)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { matchesSearch, searchOrFilter, searchWords, stemWord } from "@/lib/declutter/searchMatch";
import { NO_FILTERS, applyBrowseFilters } from "@/lib/declutter/browseFilters";

const item = (id: string, title: string, description = "", category = "other") => ({
  id, title, description, category, status: "live", condition_stars: 4, current_price_cents: 500, porch_ok: true,
  live_at: "2026-10-10T12:00:00Z", created_at: "2026-10-10T12:00:00Z",
});

describe("Declutter search words (DA-1)", () => {
  it("the audit's three misses now find the blue mug in Browse", () => {
    const rows = [item("mug", "Blue coffee mug", "Barely used", "kitchen"), item("rake", "Leaf rake", "", "outdoor_garden")]
      .map((i) => ({ item: i, miles: null }));
    const ids = (q: string) => applyBrowseFilters(rows, NO_FILTERS, q, undefined).map((r) => r.item.id);
    expect(ids("mug blue")).toEqual(["mug"]);
    expect(ids("mugs")).toEqual(["mug"]);
    expect(ids("kitchen")).toEqual(["mug"]);
    expect(ids("barely")).toEqual(["mug"]);
    expect(ids("")).toEqual(["mug", "rake"]);
    expect(ids("teapot")).toEqual([]);
    expect(ids("mug red")).toEqual([]);
  });

  it("plurals fold the same way on both sides", () => {
    expect(["mugs", "dishes", "boxes", "berries", "glasses", "glass", "shoes", "bus"].map(stemWord))
      .toEqual(["mug", "dish", "box", "berry", "glass", "glass", "shoe", "bus"]);
    expect(searchWords("  Blue,  MUGS! ")).toEqual(["blue", "mug"]);
    expect(matchesSearch("home decor", { title: "Vase", category: "home_decor" })).toBe(true);
    expect(matchesSearch("phone", { title: "iPhone 12" })).toBe(true);
  });

  it("the SQL twin is called by both server readers of a Declutter saved search, never the old title-only strpos", () => {
    const readers = [
      ["deliver_saved_search_item_alerts", "public.declutter_search_matches(s.query, v_item.title, v_item.description, v_item.category)"],
      ["saved_search_new_counts", "public.declutter_search_matches(s.query, i.title, i.description, i.category)"],
    ] as const;
    expect(readers.length).toBeGreaterThan(1);
    for (const [fn, call] of readers) {
      const body = blankSqlComments(newestFunction(fn).body);
      expect(body, fn).toContain(call);
      expect(body, fn).not.toMatch(/strpos\(lower\((v_item|i)\.title\)/);
    }
  });

  it("/search asks the database for every word in title, description or category, then keeps only what the rule accepts", () => {
    expect(searchOrFilter("Blue MUGS")).toBe(
      "and(or(title.ilike.*blue*,description.ilike.*blue*,category.ilike.*blue*),or(title.ilike.*mug*,description.ilike.*mug*,category.ilike.*mug*))",
    );
    // "berry" must still reach "berries" in the raw text: the database filter drops the trailing y.
    expect(searchOrFilter("berries")).toBe("and(or(title.ilike.*berr*,description.ilike.*berr*,category.ilike.*berr*))");
    expect(searchOrFilter("  !! ")).toBeNull();
    const src = blankComments(readFileSync("src/pages/search/SearchPage.tsx", "utf8"));
    const hook = src.slice(src.indexOf("function useItemHits"), src.indexOf("function Thumb"));
    expect(hook.length).toBeGreaterThan(200);
    expect(hook).toContain(".or(searchOrFilter(q)");
    expect(hook).toContain("all.filter((it) => matchesSearch(q, it))");
    expect(hook).toContain("description");
    expect(hook).not.toContain('.ilike("title"');
  });

  it("the SQL stem has the same three plural rules as stemWord", () => {
    const body = blankSqlComments(newestFunction("declutter_search_stem").body).replace(/\s+/g, " ");
    expect(body).toContain("length(p_word) > 4 AND right(p_word, 3) = 'ies' THEN left(p_word, -3) || 'y'");
    expect(body).toContain("length(p_word) > 4 AND p_word ~ '(s|x|z|ch|sh)es$' THEN left(p_word, -2)");
    expect(body).toContain("length(p_word) > 3 AND right(p_word, 1) = 's' AND right(p_word, 2) <> 'ss' THEN left(p_word, -1)");
    const match = blankSqlComments(newestFunction("declutter_search_matches").body);
    expect(match).toContain("replace(COALESCE(p_category::text, ''), '_', ' ')");
    expect((match.match(/'\[\^a-z0-9\]\+'/g) ?? []).length).toBe(2);
  });
});
