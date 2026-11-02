/**
 * Account audit 1102d rows 2 and 3 (Q2643, Q2644), Search's Declutter hits:
 *   - a free item read "$0" (Orange Waffle Weave Zip Bag); everywhere else in Declutter it says "Free";
 *   - the section's link read "See 20 of 59", a count of what is shown rather than an action.
 *
 * @mutate src/pages/search/SearchPage.tsx | price={typeof cents === "number" ? itemPriceLabel(cents) : null} /> | price={typeof cents === "number" ? `$${cents / 100}` : null} />
 * @mutate src/pages/search/SearchPage.tsx |             {count > MAX_ROWS ? "See more" : `See all ${count}`} |             {count > MAX_ROWS ? `See ${MAX_ROWS} of ${count}` : `See all ${count}`}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], count: 0 }));

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
    const out = table === "declutter_items" ? { data: state.items, error: null, count: state.count } : { data: [], error: null, count: 0 };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(out).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => rows(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

const item = (i: number, cents: number) => ({ id: `i${i}`, title: `Zip bag ${i}`, description: null, category: "bags", current_price_cents: null, price_cents: cents, area_label: null });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/search?q=bag"]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.items = [item(1, 0), item(2, 1250), item(3, 4000)];
  state.count = 3;
});

describe("Search's Declutter hits use Declutter's words", () => {
  it('a free item says "Free", a priced one its price', async () => {
    mount();
    const free = await screen.findByRole("link", { name: /Zip bag 1/ });
    expect(free).toHaveTextContent("Free");
    expect(free).not.toHaveTextContent("$0");
    expect(screen.getByRole("link", { name: /Zip bag 2/ })).toHaveTextContent("$12.50");
  });

  it('more hits than a section shows: "See more", never "See 20 of 59"', async () => {
    state.items = Array.from({ length: 20 }, (_, i) => item(i + 1, 1000));
    state.count = 59;
    mount();
    expect(await screen.findByRole("button", { name: "See more" })).toBeInTheDocument();
    expect(screen.queryByText(/See 20 of/)).toBeNull();
  });

  it('a few more than the first three: "See all 5"', async () => {
    state.items = Array.from({ length: 5 }, (_, i) => item(i + 1, 1000));
    state.count = 5;
    mount();
    expect(await screen.findByRole("button", { name: "See all 5" })).toBeInTheDocument();
  });
});
