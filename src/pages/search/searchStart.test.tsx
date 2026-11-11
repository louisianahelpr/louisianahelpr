/**
 * Q2645 (account audit 1102d row 4): /search with nothing typed was an empty page with one line ("Search every
 * section at once."), although the member had saved searches. It now lists them (each opens its results, as in
 * Settings) and offers a few categories per open section; Declutter's are offered only while Declutter is open.
 *
 * @mutate src/pages/search/SearchPage.tsx |         {!q && <SearchStart userId={user?.id ?? null} declutterOn={declutterOn} signedIn={!!user} />} |         {!q && <p className="font-sans text-ds-13 text-muted-foreground px-1">Search every section at once.</p>}
 * @mutate src/pages/search/SearchStart.tsx |   const open = (s: SavedSearch) => s.section === "jobs" \|\| (s.section === "declutter" && declutterOn); |   const open = (s: SavedSearch) => !!s;
 * @mutate src/pages/search/SearchStart.tsx |     ...(declutterOn ? [{ key: "declutter" | ...(true ? [{ key: "declutter"
 * @mutate src/pages/search/SearchStart.tsx | <Link key={s.id} to={resultsPath(s)} | <Link key={s.id} to="/profile?tab=saved_searches"
 *
 * F259l (whole-app audit 2026-11-10): each saved search shows its "N new" (saved_search_new_counts, as in Settings),
 * and opening one marks it seen.
 * @mutate src/pages/search/SearchStart.tsx |                 <SavedSearchNewPill n={counts.data?.get(s.id) ?? 0} />\n |
 * @mutate src/pages/search/SearchStart.tsx | onClick={() => openSaved(s)} |
 * @mutate src/pages/search/SearchStart.tsx |     if (!userId \|\| !(counts.data?.get(s.id) ?? 0)) return; |     return;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ declutter: true, counts: [] as { search_id: string; new_count: number }[], updates: [] as unknown[] }));

const SAVED = [
  { id: "s1", name: "Lawn mowing", section: "jobs", query: "lawn", category: null, min_budget: null, max_budget: null, radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: false, last_seen_at: null, created_at: "2026-11-01T00:00:00Z" },
  { id: "s2", name: "Couches", section: "declutter", query: "couch", category: "furniture", min_budget: null, max_budget: null, radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: false, last_seen_at: "2026-11-01T12:00:00Z", created_at: "2026-11-01T00:00:00Z" },
];

vi.mock("@/hooks/useFeature", () => ({
  useFeatureStatus: (key: string) => ({ on: key === "declutter" ? state.declutter : false, settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "or", "order", "limit", "eq"]) b[m] = () => b;
    b.update = (row: unknown) => {
      state.updates.push({ table, row });
      return b;
    };
    const data = table === "saved_searches" ? SAVED : [];
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: data.length }).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: async (fn: string) => ({ data: fn === "saved_search_new_counts" ? state.counts : [], error: null }) } };
});

import SearchPage from "./SearchPage";

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.declutter = true;
  state.counts = [];
  state.updates = [];
});

describe("search with nothing typed starts somewhere (Q2645)", () => {
  it("lists the member's saved searches, each opening its own results", async () => {
    mount("/search");
    const saved = await screen.findByRole("region", { name: "Your saved searches" });
    expect(within(saved).getByRole("link", { name: /Lawn mowing/ })).toHaveAttribute("href", "/jobs?tab=browse&q=lawn");
    expect(within(saved).getByRole("link", { name: /Couches/ }).getAttribute("href")).toMatch(/^\/declutter\?q=couch&cat=furniture/);
  });

  it("F259l: each saved search says how many new matches it has; opening one marks it seen", async () => {
    state.counts = [{ search_id: "s1", new_count: 3 }, { search_id: "s2", new_count: 0 }];
    mount("/search");
    const saved = await screen.findByRole("region", { name: "Your saved searches" });
    const lawn = within(saved).getByRole("link", { name: /Lawn mowing/ });
    expect(await within(lawn).findByText("3 new")).toBeInTheDocument();
    // Hidden at 0: every number is real or hidden.
    expect(within(within(saved).getByRole("link", { name: /Couches/ })).queryByText(/new$/)).toBeNull();
    fireEvent.click(lawn);
    await vi.waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.updates[0]).toMatchObject({ table: "saved_searches", row: { last_seen_at: expect.any(String) } });
  });

  it("offers a few categories of each open section, each opening that Browse", async () => {
    mount("/search");
    const cats = screen.getByRole("region", { name: "Browse by category" });
    const links = within(cats).getAllByRole("link");
    expect(links.length).toBeGreaterThan(5);
    expect(within(cats).getByRole("link", { name: "Cleaning" })).toHaveAttribute("href", "/jobs?tab=browse&cat=cleaning");
    expect(within(cats).getByRole("link", { name: "Furniture" })).toHaveAttribute("href", "/declutter?cat=furniture");
  });

  it("Declutter closed: no Declutter chips and no Declutter saved search", async () => {
    state.declutter = false;
    mount("/search");
    const saved = await screen.findByRole("region", { name: "Your saved searches" });
    expect(within(saved).queryByRole("link", { name: /Couches/ })).toBeNull();
    const cats = screen.getByRole("region", { name: "Browse by category" });
    expect(within(cats).queryByRole("link", { name: "Furniture" })).toBeNull();
    expect(within(cats).getByRole("link", { name: "Cleaning" })).toBeInTheDocument();
  });

  // F223 (audit 11-10): the Jobs chips stopped before Errands (Browse offers it), and the chips were 40px tall.
  // @mutate src/pages/search/SearchStart.tsx | const START_CHIPS_PER_SECTION = 5; | const START_CHIPS_PER_SECTION = 4;
  // @mutate src/pages/search/SearchStart.tsx | rounded-full px-4 min-h-11 border | rounded-full px-4 min-h-[40px] border
  it("the Jobs chips include Errands, and every chip is a 44px target (F223)", () => {
    mount("/search");
    const cats = screen.getByRole("region", { name: "Browse by category" });
    expect(within(cats).getByRole("link", { name: "Errands" })).toHaveAttribute("href", "/jobs?tab=browse&cat=errands");
    const chips = within(cats).getAllByRole("link");
    expect(chips.length).toBeGreaterThan(5);
    for (const c of chips) expect(c.className.split(/\s+/)).toContain("min-h-11");
  });

  it("a typed search shows results, not the start screen", () => {
    mount("/search?q=zzqx");
    expect(screen.queryByTestId("search-start")).toBeNull();
  });

  // F142 (owner UI audit 11-09): chips grouped under "Jobs" and "Declutter"; recent searches shown.
  // @mutate src/pages/search/SearchStart.tsx |       {recent.length > 0 && ( |       {false && (
  // @mutate src/pages/search/SearchPage.tsx |     if (next) pushRecentSearch(next); |
  it("groups the category chips under Jobs and Declutter (F142)", () => {
    mount("/search");
    const cats = screen.getByRole("region", { name: "Browse by category" });
    const groups = [...cats.querySelectorAll("[data-category-group]")];
    expect(groups.map((g) => g.querySelector("h3")?.textContent)).toEqual(["Jobs", "Declutter"]);
    expect(within(groups[0] as HTMLElement).getByRole("link", { name: "Cleaning" })).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByRole("link", { name: "Furniture" })).toBeInTheDocument();
  });

  it("lists recent searches first, each running again, and a search run here joins them (F142)", () => {
    localStorage.removeItem("helpr:search-history");
    const first = mount("/search");
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "porch swing" } });
    fireEvent.submit(screen.getByRole("search", { name: "Search Helpr" }));
    first.unmount();
    mount("/search");
    const recent = screen.getByRole("region", { name: "Recent searches" });
    expect(within(recent).getByRole("link", { name: "porch swing" })).toHaveAttribute("href", "/search?q=porch%20swing");
    expect(screen.getByTestId("search-start").firstElementChild?.nextElementSibling).toBe(recent);
    localStorage.removeItem("helpr:search-history");
  });
});
