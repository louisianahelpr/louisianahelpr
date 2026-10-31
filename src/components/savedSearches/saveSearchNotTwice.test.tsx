/**
 * BUY-54 (Declutter buying audit 10-30): nothing stopped saving the same search twice (each copy alerts, and both
 * count toward the 10-search cap), and the "Save this search" pill didn't change after saving. Now the sheet checks
 * the member's saved searches first and says it's already saved instead of adding a copy, and the pill reads
 * "Search saved" (a link to the list) until the filters change.
 * @mutate src/components/savedSearches/SaveSearchSheet.tsx |     if (mine?.some((s) => sameSearch(s, d))) { |     if (false) {
 * @mutate src/components/savedSearches/SaveSearchButton.tsx |   if (isSaved) { |   if (false) {
 * @mutate src/lib/savedSearches.ts |   return s.section === d.section && words(s.query) === words(d.query) |   return s.section === d.section
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], created: [] as unknown[], toasts: [] as string[] }));

vi.mock("sonner", () => ({ toast: Object.assign((m: string) => { h.toasts.push(m); }, { success: vi.fn(), error: (m: string) => { h.toasts.push(`error:${m}`); } }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: () => {}, hapticSuccess: () => {} }));
vi.mock("@/lib/savedSearches", async (orig) => ({
  ...(await orig<object>()),
  fetchSavedSearches: async () => h.rows,
  createSavedSearch: async (_u: string, d: unknown) => { h.created.push(d); return "s-new"; },
}));

import { SaveSearchButton } from "./SaveSearchButton";
import type { SearchDraft } from "@/lib/savedSearches";

const draft: SearchDraft = { section: "declutter", query: "Chair", category: "furniture", minDollars: null, maxDollars: 50, radiusMiles: 25 };
const row = { id: "s1", name: "x", section: "declutter", query: "chair", category: "furniture", min_budget: null, max_budget: 50, radius_miles: 25,
  parish: null, location_keyword: null, notify_enabled: true, notify_email: true, last_seen_at: null, created_at: "2026-10-30T00:00:00Z" };

function show(d: SearchDraft = draft) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (x: SearchDraft) => <QueryClientProvider client={qc}><MemoryRouter><SaveSearchButton userId="u1" draft={x} /></MemoryRouter></QueryClientProvider>;
  const r = render(ui(d));
  return { rerender: (x: SearchDraft) => r.rerender(ui(x)) };
}

async function saveIt() {
  fireEvent.click(screen.getByTestId("save-search"));
  fireEvent.click(await screen.findByRole("button", { name: "Save search" }));
}

describe("BUY-54: the same search is not saved twice", () => {
  beforeEach(() => { h.rows = []; h.created = []; h.toasts = []; });

  it("a search already saved (any case in the words) is not added again, and the pill says it's saved", async () => {
    h.rows = [row];
    show();
    await saveIt();
    await waitFor(() => expect(h.toasts).toEqual(["You already saved this search"]));
    expect(h.created).toEqual([]);
    expect(screen.getByTestId("search-saved").textContent).toBe("Search saved");
    expect(screen.getByTestId("search-saved").getAttribute("href")).toBe("/profile?tab=saved_searches");
  });

  it("a new search saves once; the pill changes, and changes back when the filters change", async () => {
    h.rows = [{ ...row, query: "table" }];
    const v = show();
    await saveIt();
    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.toasts).toEqual(["Search saved"]);
    expect(await screen.findByTestId("search-saved")).toBeTruthy();
    v.rerender({ ...draft, maxDollars: 20 });
    expect(screen.getByTestId("save-search").textContent).toContain("Save this search");
  });

  it("the sheet still holds the check (inventory floor)", () => {
    const src = readFileSync("src/components/savedSearches/SaveSearchSheet.tsx", "utf8");
    expect(src.split("sameSearch(").length - 1).toBeGreaterThan(0);
  });
});
