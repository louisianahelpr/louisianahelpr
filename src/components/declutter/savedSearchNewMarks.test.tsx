/**
 * BUY-53 (buying audit 10-30): "3 new" on a saved Declutter search opened Browse with no mark on which items were new.
 * Now the search opens Browse with `new=<when the member last looked>` (resultsPath), the same instant
 * saved_search_new_counts counts from (live_at > COALESCE(last_seen_at, created_at)), and each card whose listing went
 * live after it wears the "New" tag.
 *
 * @mutate src/lib/savedSearches.ts |     if (since) p.set("new", since); |     if (since) p.delete("new");
 * @mutate src/lib/declutter/browseFilters.ts |   return Date.parse(item.live_at) > since; |   return Date.parse(item.live_at) < since;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                   tag={isNewSince(item, newSince) ? "new" : outlook | tag={false ? "new" : outlook
 * @mutate src/components/declutter/DeclutterItemCard.tsx | new: "New" }; | new: "Helpr delivery" };
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } } }));

import { ItemCard } from "./DeclutterItemCard";
import { resultsPath, type SavedSearch } from "@/lib/savedSearches";
import { isNewSince, newSinceFromParams } from "@/lib/declutter/browseFilters";
import type { DeclutterItem } from "@/lib/declutter/api";

const SEARCH: SavedSearch = {
  id: "s1", name: "", section: "declutter", query: "chair", category: null, min_budget: null, max_budget: null,
  radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: true,
  last_seen_at: "2026-10-30T12:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z",
};
const params = (s: SavedSearch) => new URLSearchParams(resultsPath(s).split("?")[1] ?? "");

describe("BUY-53: Browse marks which listings a saved search's \"N new\" counted", () => {
  it("the search opens Browse with the instant the count runs from", () => {
    expect(newSinceFromParams(params(SEARCH))).toBe(Date.parse("2026-10-30T12:00:00.000Z"));
    // Never opened: the count runs from when it was saved.
    expect(newSinceFromParams(params({ ...SEARCH, last_seen_at: null }))).toBe(Date.parse("2026-10-01T00:00:00.000Z"));
    // A Jobs search is untouched.
    expect(resultsPath({ ...SEARCH, section: "jobs" })).not.toContain("new=");
  });

  it("only a listing that went live after it is new; no param or a bad one marks nothing", () => {
    const since = newSinceFromParams(params(SEARCH));
    expect(isNewSince({ live_at: "2026-10-30T12:00:01.000Z" }, since)).toBe(true);
    expect(isNewSince({ live_at: "2026-10-30T11:59:59.000Z" }, since)).toBe(false);
    expect(isNewSince({ live_at: null }, since)).toBe(false);
    expect(isNewSince({ live_at: "2026-10-30T12:00:01.000Z" }, newSinceFromParams(new URLSearchParams("q=chair")))).toBe(false);
    expect(newSinceFromParams(new URLSearchParams("new=yesterday"))).toBeNull();
  });

  it("the card wears the New tag", () => {
    const item = { id: "i1", seller_id: "x", title: "Oak chair", category: "furniture", price_cents: 4000, current_price_cents: 4000, area_label: "Mid City", porch_ok: false, delivery_size: "small" } as unknown as DeclutterItem;
    const { container } = render(<MemoryRouter><ItemCard item={item} miles={null} approximate={false} tag="new" /></MemoryRouter>);
    expect(container.querySelector('[data-card-tag="new"]')?.textContent).toBe("New");
    expect(screen.getByTitle("New since you last looked at this search")).toBeTruthy();
  });

  it("Browse reads the param once and gives the tag to new listings first (inventory floor)", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(src).toContain("useState(() => newSinceFromParams(params))");
    const tags = src.match(/tag=\{isNewSince\(item, newSince\) \? "new" :/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
  });
});
