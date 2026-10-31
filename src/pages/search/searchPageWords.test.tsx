/**
 * AUD31-39: the search box read "Search jobs, items, shops and homes" (cut at 375 and 360) though Shops and Homes
 * are Coming soon and are not searched. It names what it searches: jobs, and items while Declutter is on.
 * AUD31-32: a search with no results offered only "Browse all jobs" though it searched Declutter too.
 *
 * @mutate src/pages/search/SearchPage.tsx |   const fieldLabel = declutterOn ? "Search jobs and items" : "Search jobs"; |   const fieldLabel = "Search jobs, items, shops and homes";
 * @mutate src/pages/search/SearchPage.tsx |                 {declutterOn && ( |                 {false && (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ declutter: true }));

vi.mock("@/hooks/useFeature", () => ({
  useFeatureStatus: (key: string) => ({ on: key === "declutter" ? state.declutter : false, settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const empty = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "or", "order", "limit", "eq"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
    return b;
  };
  return { supabase: { from: () => empty(), rpc: async () => ({ data: [], error: null }) } };
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

describe("the search page names what it searches", () => {
  it("Declutter on: the box says jobs and items; no results offers both Browses", async () => {
    mount("/search?q=zzqx");
    expect(screen.getByRole("searchbox", { name: "Search jobs and items" })).toHaveAttribute("placeholder", "Search jobs and items");
    expect(await screen.findByRole("link", { name: "Browse all jobs" })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: "Browse Declutter" })).toHaveAttribute("href", "/declutter");
  });

  it("Declutter off: the box says jobs; no results offers jobs only", async () => {
    state.declutter = false;
    mount("/search?q=zzqx");
    expect(screen.getByRole("searchbox", { name: "Search jobs" })).toHaveAttribute("placeholder", "Search jobs");
    expect(await screen.findByRole("link", { name: "Browse all jobs" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse Declutter" })).toBeNull();
  });
});
