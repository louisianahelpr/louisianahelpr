import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_MAX,
} from "./searchHistory";

describe("searchHistory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when nothing is stored", () => {
    expect(getRecentSearches()).toEqual([]);
  });

  it("returns [] when storage holds corrupt JSON", () => {
    localStorage.setItem(SEARCH_HISTORY_KEY, "{not json");
    expect(getRecentSearches()).toEqual([]);
  });

  it("returns [] when storage holds a non-array value", () => {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify({ foo: 1 }));
    expect(getRecentSearches()).toEqual([]);
  });

  it("pushes a query to the front", () => {
    pushRecentSearch("mowing");
    pushRecentSearch("painting");
    expect(getRecentSearches()).toEqual(["painting", "mowing"]);
  });

  it("ignores queries shorter than the min length", () => {
    pushRecentSearch("ab");
    pushRecentSearch("  c  ");
    expect(getRecentSearches()).toEqual([]);
  });

  it("trims whitespace before storing", () => {
    pushRecentSearch("  lawn care  ");
    expect(getRecentSearches()).toEqual(["lawn care"]);
  });

  it("dedupes case-insensitively, moving repeats to the front", () => {
    pushRecentSearch("Mowing");
    pushRecentSearch("painting");
    pushRecentSearch("MOWING");
    expect(getRecentSearches()).toEqual(["MOWING", "painting"]);
  });

  it("caps history at the FIFO max", () => {
    for (let i = 0; i < SEARCH_HISTORY_MAX + 3; i++) {
      pushRecentSearch(`query ${i}`);
    }
    const recent = getRecentSearches();
    expect(recent).toHaveLength(SEARCH_HISTORY_MAX);
    // Newest first, oldest evicted.
    expect(recent[0]).toBe(`query ${SEARCH_HISTORY_MAX + 2}`);
    expect(recent).not.toContain("query 0");
  });

  it("clearRecentSearches empties storage", () => {
    pushRecentSearch("mowing");
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
  });
});
