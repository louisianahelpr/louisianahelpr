/**
 * Q2725 (Shops opens to everyone, 11-12): with the shops switch on, /search lists matching shops with the exact count
 * beside Jobs and Declutter; a guest is never searched there (anon has no read on shops, so the read would fail and
 * blank the whole page); with the switch off, nothing is read and the line says Shops is coming soon.
 *
 * @mutate src/pages/search/SearchPage.tsx |  const shopsOn = shops.on && !!user; |  const shopsOn = shops.on;
 * @mutate src/pages/search/SearchPage.tsx |    enabled: on && q.length > 0,\n    staleTime: 30_000,\n    queryFn: async () => {\n      const res = await supabase\n        .from("shops") |    enabled: false,\n    staleTime: 30_000,\n    queryFn: async () => {\n      const res = await supabase\n        .from("shops")
 * @mutate src/pages/search/SearchPage.tsx |              <Row key={s.id} to={`/shops/${s.id}`} |              <Row key={s.id} to={`/shop/${s.id}`}
 * @mutate src/lib/declutter/searchMatch.ts |    return `or(${t}.ilike.*${loose}*,${d}.ilike.*${loose}*,${c}.ilike.*${loose}*)`; |    return `or(title.ilike.*${loose}*,description.ilike.*${loose}*,category.ilike.*${loose}*)`;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  shopsOn: true,
  user: { id: "u1" } as { id: string } | null,
  shops: [] as Record<string, unknown>[],
  count: 0,
  reads: [] as { table: string; or?: string }[],
}));

vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: (key: string) => ({ on: key === "shops" ? state.shopsOn : false, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: state.user, profile: null }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: new Set(state.shopsOn ? ["shops"] : []), settled: true }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/lib/hideUnopenedInApp", () => ({ hideUnopenedInApp: () => false }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/lib/declutter/api", () => ({ fetchPhotos: async () => [], photoPublicUrl: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = (table: string) => {
    const read: { table: string; or?: string } = { table };
    state.reads.push(read);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "order", "limit", "eq"]) b[m] = () => b;
    b.or = (f: string) => { read.or = f; return b; };
    const out = table === "shops" ? { data: state.shops, error: null, count: state.count } : { data: [], error: null, count: 0 };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(out).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => rows(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

const shop = (i: number, name: string, about = "") => ({ id: `s${i}`, name, about, category: "bakery", area_label: "Lafayette" });

function mount(q = "cake") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/search?q=${q}`]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.shopsOn = true;
  state.user = { id: "u1" };
  state.shops = [shop(1, "Mimi's Kitchen", "King cake every Friday"), shop(2, "Cake Lady")];
  state.count = 2;
  state.reads = [];
});

describe("Q2725: /search finds Shops once the switch is on", () => {
  it("a member sees matching shops with the exact count, name hits first, each linking to its shop page", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: /Shops/ })).toBeInTheDocument();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/shops/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/shops/s2", "/shops/s1"]);
    expect(screen.getByRole("button", { name: "Shops · 2" })).toBeInTheDocument();
    const read = state.reads.find((r) => r.table === "shops");
    expect(read?.or).toContain("name.ilike.*cake*");
    expect(read?.or).toContain("about.ilike.*cake*");
    expect(read?.or).not.toContain("title.ilike");
    expect(screen.queryByText(/Shops is coming soon/)).toBeNull();
  });

  it("a guest is not searched in Shops (anon cannot read shops)", async () => {
    state.user = null;
    mount();
    await screen.findByText(/Nothing matches/);
    expect(state.reads.some((r) => r.table === "shops")).toBe(false);
  });

  it("switch off: shops are never read and the line says Shops is coming soon", async () => {
    state.shopsOn = false;
    mount();
    expect(await screen.findByText(/Shops (and Homes )?(is|are) coming soon/)).toBeInTheDocument();
    expect(state.reads.some((r) => r.table === "shops")).toBe(false);
  });
});
