/**
 * Lead 11-07 (Builder 5): the listing rows on a seller's public profile (/u/:handle, "For sale · N") show the item's
 * CURRENT price, the one a buyer pays after a price drop, with the "$X.XX incl. fee" line every other Declutter price
 * has (PriceInclFee, owner 11-07 Vinted review).
 *
 * public_profile_by_handle sends each listing's current price under the ambiguous key `price_cents` (it is built from
 * declutter_items.current_price_cents, not the listed price_cents). fetchPublicProfile renames it to
 * current_price_cents, so the page reads one unambiguous name and the repo-wide incl.-fee class guard
 * (src/test/declutterPriceInclFee.test.tsx, which keys on `.current_price_cents`) sees this row too.
 *
 * @mutate src/lib/profileLink/api.ts | ({ ...l, current_price_cents: price_cents }) | ({ ...l, current_price_cents: 0, price_cents })
 * @mutate src/pages/u/PublicProfilePage.tsx |                     <PriceInclFee priceCents={l.current_price_cents} /> | {null}
 */
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
const { fetchPublicProfile } = await import("@/lib/profileLink/api");
const { buyNowTotalCents } = await import("@/lib/declutter/money");

// Listed at $8.00, dropped to $5.00: the read sends the current price as `price_cents`.
const PAGE = {
  handle: "eli-b",
  name: "Eli B.",
  photo_url: null,
  member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 0, avg_rating: null, is_id_verified: false },
  listings: [
    { id: "i1", title: "Oak dresser", price_cents: 500, area_label: "Mid City", photo_id: null, live_at: "2026-10-30T00:00:00Z" },
    { id: "i2", title: "Free lamp", price_cents: 0, area_label: null, photo_id: null, live_at: "2026-10-29T00:00:00Z" },
  ],
  jobs: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] },
  wanted: [],
};

describe("the public profile's listing rows show the current price, with the incl.-fee line", () => {
  it("the read builds the listing price from current_price_cents (effective definition)", () => {
    const def = blankSqlComments(effectiveDefs(resolve(__dirname, "../../supabase/migrations")).get("public_profile_by_handle")?.stmt ?? "").replace(/\s+/g, " ");
    expect(def.length).toBeGreaterThan(2000);
    expect(def).toContain("'price_cents', i.current_price_cents,");
    expect(def).not.toMatch(/'price_cents', i\.price_cents/);
  });

  it("fetchPublicProfile names it current_price_cents", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    const p = await fetchPublicProfile("eli-b");
    expect(p?.listings.map((l) => l.current_price_cents)).toEqual([500, 0]);
    expect(p?.listings[0]).not.toHaveProperty("price_cents");
    rpc.mockResolvedValue({ data: { ...PAGE, listings: null }, error: null });
    expect((await fetchPublicProfile("eli-b"))?.listings).toEqual([]);
  });

  it("the row says $5 and the buyer's total incl. fee; a free item says Free and nothing more", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/u/eli-b"]}>
          <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Oak dresser");
    const grid = container.querySelector("[data-testid='pp-listings-grid']")!;
    const rows = [...grid.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("$5 · Mid City");
    expect(rows[0].textContent).not.toContain("$8");
    const fee = rows[0].querySelector("[data-price-incl-fee]");
    expect(fee?.textContent).toBe(`$${(buyNowTotalCents(500) / 100).toFixed(2)} incl. fee`);
    expect(rows[1].textContent).toContain("Free");
    expect(rows[1].querySelector("[data-price-incl-fee]")).toBeNull();
  });
});
