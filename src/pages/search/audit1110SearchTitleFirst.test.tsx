/**
 * F222 (audit 11-10): searching "chair" led with "Brown Plush Fleece Blanket" (the word was only in its long
 * description), so results looked random. Declutter hits whose title has every word now come first, newest first
 * within each group.
 *
 * @mutate src/pages/search/SearchPage.tsx | const rows = all.filter((it) => matchesSearch(q, it)).sort((a, b) => titleHit(a) - titleHit(b)); | const rows = all.filter((it) => matchesSearch(q, it));
 * @mutate src/pages/search/SearchPage.tsx | const titleHit = (it: ItemHit) => (matchesSearch(q, { title: it.title }) ? 0 : 1); | const titleHit = (it: ItemHit) => (matchesSearch(q, it) ? 0 : 1);
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const ITEMS = [
  { id: "i1", title: "Brown plush fleece blanket", description: "Soft, fits a chair or a sofa.", category: "home", current_price_cents: null, price_cents: 800, area_label: null },
  { id: "i2", title: "Oak rocking chair", description: null, category: "furniture", current_price_cents: null, price_cents: 4000, area_label: null },
  { id: "i3", title: "Throw pillow set", description: "Matches any chair.", category: "home", current_price_cents: null, price_cents: 1200, area_label: null },
  { id: "i4", title: "Folding chair", description: null, category: "furniture", current_price_cents: null, price_cents: 1500, area_label: null },
];

vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: (key: string) => ({ on: key === "declutter", settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/lib/declutter/api", () => ({ fetchPhotos: async () => [], photoPublicUrl: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "or", "order", "limit", "eq"]) b[m] = () => b;
    const out = table === "declutter_items" ? { data: ITEMS, error: null, count: ITEMS.length } : { data: [], error: null, count: 0 };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(out).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => rows(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

describe("F222: Search ranks title matches first", () => {
  it('"chair": the two chairs lead, the blanket and pillows (description only) follow', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/search?q=chair"]}>
          <SearchPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("link", { name: /Oak rocking chair/ });
    const names = screen.getAllByRole("link").map((a) => a.textContent ?? "").filter((t) => /chair|blanket|pillow/i.test(t));
    expect(names[0]).toMatch(/Oak rocking chair/);
    expect(names[1]).toMatch(/Folding chair/);
    expect(names.some((t) => /blanket/i.test(t) && names.indexOf(t) < 2)).toBe(false);
  });
});
