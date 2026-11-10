/**
 * L001 (landing audit 11-09, High): /search told a signed-out visitor "Declutter Coming soon" and searched no
 * Declutter items ("pillow": nothing, while /declutter had 4+ pillows). useFeatureStatus is false for every switch when
 * signed out; a guest's sections are the switches open to EVERYONE (features_open_to_everyone, useSectionsOpen).
 * L004: a guest's Jobs category chips went to /jobs?tab=browse (signed-in only) and hit the login wall; they open the
 * public board (/browse?cat=). "See all in Jobs" likewise opens /browse?q= for a guest.
 *
 * @mutate src/pages/search/SearchPage.tsx |     guest ? { on: !!openToAll.open?.has(key), settled: openToAll.settled } : member; |     member;
 * @mutate src/pages/search/SearchStart.tsx |   return signedIn ? `/jobs?tab=browse&cat=${cat}` : `/browse?cat=${cat}`; |   return `/jobs?tab=browse&cat=${cat}`;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ open: new Set<string>(["declutter"]) as Set<string> | null, signedIn: false }));

vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: state.signedIn ? { id: "u1" } : null, profile: null }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: state.signedIn ? { id: "u1" } : null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({
  useSectionsOpen: (start: boolean) => (start ? { open: state.open, settled: state.open !== null, failed: false } : { open: null, settled: false, failed: false }),
}));
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
    const out = table === "declutter_items"
      ? { data: [{ id: "i1", title: "Feather pillow", description: null, category: "bedding_bath", current_price_cents: 500, price_cents: 500, area_label: null }], error: null, count: 1 }
      : { data: [], error: null, count: 0 };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(out).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => rows(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.open = new Set(["declutter"]);
  state.signedIn = false;
});

describe("L001: a signed-out visitor's /search covers the sections open to everyone", () => {
  it("Declutter open to everyone: its items are searched and it never says Coming soon", async () => {
    mount("/search?q=pillow");
    expect(await screen.findByRole("link", { name: /Feather pillow/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search jobs and items")).toBeInTheDocument();
    // Shops and Homes are not open to everyone: they still say so; Declutter does not.
    const soon = screen.queryAllByText("Coming soon");
    expect(soon.length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Declutter\s*Coming soon/);
  });

  it("Declutter not open to everyone: no items, and it says Coming soon", async () => {
    state.open = new Set();
    mount("/search?q=pillow");
    expect(await screen.findByPlaceholderText("Search jobs")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Feather pillow/ })).toBeNull();
  });
});

describe("L004: a signed-out visitor's Jobs chips open the public board", () => {
  it("the empty /search's Jobs chips go to /browse?cat=, the Declutter chips to /declutter?cat=", () => {
    mount("/search");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    const jobs = hrefs.filter((h) => /cat=/.test(h) && !h.startsWith("/declutter"));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((h) => h.startsWith("/browse?cat="))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("/declutter?cat="))).toBe(true);
  });

  it("signed in, the chips still open Jobs > Browse", () => {
    state.signedIn = true;
    mount("/search");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.startsWith("/jobs?tab=browse&cat=")).length).toBeGreaterThan(0);
    expect(hrefs.some((h) => h.startsWith("/browse?cat="))).toBe(false);
  });
});
