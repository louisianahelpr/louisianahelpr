import { describe, it, expect } from "vitest";
import { defaultName, resultsPath, rowSummary, type SavedSearch } from "./savedSearches";
import { browseStateFromParams } from "./declutter/browseFilters";

// Swapping the channel words must turn the row-summary test red.
// @mutate src/lib/savedSearches.ts | s.notify_email ? "Email" : "App only" | s.notify_email ? "App only" : "Email"

const base: SavedSearch = {
  id: "s1", name: "", section: "declutter", query: "chair", category: null, min_budget: null, max_budget: 100,
  radius_miles: 25, parish: null, location_keyword: null, notify_enabled: true, notify_email: true, last_seen_at: null, created_at: "",
};

describe("saved searches in plain words (board 91)", () => {
  it("names a search after its words and section", () => {
    expect(defaultName({ section: "declutter", query: " chair ", category: null })).toBe("“chair” in Declutter");
    expect(defaultName({ section: "jobs", query: "", category: null })).toBe("Everything in Jobs");
  });

  // SS-7 (saved audit 10-30): a long search was cut mid-word with no closing quote ("…eight matching chai").
  // @mutate src/lib/savedSearches.ts |   const words = (atWord > 0 ? cut.slice(0, atWord) : q.slice(0, room)).trimEnd(); |   const words = q.slice(0, room);
  // @mutate src/lib/savedSearches.ts |   return `“${words}…”${where}`; |   return `“${words}${where}`;
  it("a long search is cut at a word, with an ellipsis and its closing quote, within 60", () => {
    const long = "antique mahogany dining room table with eight matching chairs and a hutch";
    const name = defaultName({ section: "declutter", query: long, category: null });
    expect(name).toBe("“antique mahogany dining room table with…” in Declutter");
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.length).toBeGreaterThan(40);
    // One unbroken word longer than the room is cut, still closed.
    const one = defaultName({ section: "jobs", query: "x".repeat(80), category: null });
    expect(one).toMatch(/^“x+…” in Jobs$/);
    expect(one.length).toBeLessThanOrEqual(60);
    // At exactly the limit nothing is cut.
    const fits = "a".repeat(60 - " in Jobs".length - 2);
    expect(defaultName({ section: "jobs", query: fits, category: null })).toBe(`“${fits}” in Jobs`);
  });

  it("each row says its channel, then its filters", () => {
    expect(rowSummary(base)).toBe("Email · within 25 mi · under $100");
    expect(rowSummary({ ...base, notify_email: false, radius_miles: 40, max_budget: null })).toBe("App only · within 40 mi");
    expect(rowSummary({ ...base, notify_enabled: false })).toMatch(/^Alerts off/);
  });

  it("a Declutter search opens Declutter Browse with the same filters it saved", () => {
    const path = resultsPath({ ...base, category: "furniture" });
    expect(path.startsWith("/declutter?")).toBe(true);
    const st = browseStateFromParams(new URLSearchParams(path.split("?")[1]));
    expect(st).toMatchObject({ query: "chair", maxMiles: 25, filters: { category: "furniture", maxDollars: 100, minDollars: null } });
  });

  it("a Jobs search opens Jobs Browse with the dashboard's own params", () => {
    expect(resultsPath({ ...base, section: "jobs", category: "yard_work", min_budget: 50 })).toBe("/jobs?tab=browse&q=chair&cat=yard_work&min=50&max=100&loc=nearby%3A25");
  });

  it("a bad URL value is no filter, not a wrong one", () => {
    expect(browseStateFromParams(new URLSearchParams("max=abc&mi=-3")).filters.maxDollars).toBeNull();
    expect(browseStateFromParams(new URLSearchParams("max=abc&mi=-3")).maxMiles).toBeNull();
  });
});
