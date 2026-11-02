/**
 * Q2645 (account audit 1102d row 4): /search with nothing typed was an empty page with one line ("Search every
 * section at once."), although the member had saved searches. It now lists them (each opens its results, as in
 * Settings) and offers a few categories per open section; Declutter's are offered only while Declutter is open.
 *
 * @mutate src/pages/search/SearchPage.tsx |         {!q && <SearchStart userId={user?.id ?? null} declutterOn={declutterOn} />} |         {!q && <p className="font-sans text-ds-13 text-muted-foreground px-1">Search every section at once.</p>}
 * @mutate src/pages/search/SearchStart.tsx |   const open = (s: SavedSearch) => s.section === "jobs" \|\| (s.section === "declutter" && declutterOn); |   const open = (s: SavedSearch) => !!s;
 * @mutate src/pages/search/SearchStart.tsx |     ...(declutterOn ? CATEGORIES | ...(true ? CATEGORIES
 * @mutate src/pages/search/SearchStart.tsx | <Link key={s.id} to={resultsPath(s)} | <Link key={s.id} to="/profile?tab=saved_searches"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ declutter: true }));

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
    const data = table === "saved_searches" ? SAVED : [];
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: data.length }).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }) } };
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
});

describe("search with nothing typed starts somewhere (Q2645)", () => {
  it("lists the member's saved searches, each opening its own results", async () => {
    mount("/search");
    const saved = await screen.findByRole("region", { name: "Your saved searches" });
    expect(within(saved).getByRole("link", { name: /Lawn mowing/ })).toHaveAttribute("href", "/jobs?tab=browse&q=lawn");
    expect(within(saved).getByRole("link", { name: /Couches/ }).getAttribute("href")).toMatch(/^\/declutter\?q=couch&cat=furniture/);
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

  it("a typed search shows results, not the start screen", () => {
    mount("/search?q=zzqx");
    expect(screen.queryByTestId("search-start")).toBeNull();
  });
});
