/*
 * GUARD (owner 11-07, after reviewing Vinted): the Declutter item page shows
 *   - "Listed 3 min ago" beside the condition;
 *   - the seller's trust badges from real data with honest bars and NO badge when the data is thin ("Lists often" at
 *     5+ for sale, "On-time handovers" only on the server's yes, "Active today" only for the server's "today" band);
 *   - a "Bundle and save" box only when the seller's bundle discount can apply here, pointing at the bundle flow;
 *   - "Free porch pickup" first on the where-line where porch pickup applies;
 *   - SPEED: the badges and the "More from this seller" / "Similar items" rows are read only after the item has
 *     painted, and guests see the rows too.
 * Server rule for "On-time handovers": src/test/pglite/declutterSellerOnTimeHandovers.pglite.mjs.
 */
// @mutate src/lib/declutter/sellerBadges.ts | if (s.othersForSale !== null && s.othersForSale + 1 >= LISTS_OFTEN_FROM) | if (s.othersForSale !== null)
// @mutate src/lib/declutter/sellerBadges.ts | if (s.onTime === true) | if (s.onTime !== false)
// @mutate src/lib/declutter/sellerBadges.ts |   return band === "today" ? "Active today" : null; |   return band ? "Active today" : null;
// @mutate src/lib/declutter/sellerBadges.ts |   if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`; |   if (ms < HOUR) return `${Math.floor(ms / HOUR)} min ago`;
// @mutate src/components/declutter/SellerTrustBadges.tsx | queryFn: () => fetchOnTimeHandovers(sellerId), enabled: after, | queryFn: () => fetchOnTimeHandovers(sellerId), enabled: true,
// @mutate src/components/declutter/DeclutterBundleRow.tsx |   if (!summary.offer) return null; |   if (false) return null;
// @mutate src/components/declutter/DeclutterItemView.tsx |       {!isSeller && afterPaint && ( |       {!isSeller && (
// @mutate src/components/declutter/DeclutterItemView.tsx | <DeclutterItemRows item={it} viewerId={user?.id ?? null} | <DeclutterItemRows item={it} viewerId={user!.id}
// @mutate src/components/declutter/DeclutterItemView.tsx |               {forSale && listedAgo(it.live_at) && | {false && listedAgo(it.live_at) &&
// @mutate src/components/declutter/DeclutterItemView.tsx |               {it.porch_ok !== false && <span data-item-porch-free="" | {false && <span data-item-porch-free=""
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const reads = vi.hoisted(() => ({ onTime: 0, seen: 0, more: 0, onTimeAnswer: true as boolean | null, seenAnswer: null as ActiveBand | null, others: 4 }));
vi.mock("@/lib/declutter/sellerBadges", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerBadges")>()),
  fetchOnTimeHandovers: async () => { reads.onTime++; return reads.onTimeAnswer; },
  fetchActiveBand: async () => { reads.seen++; return reads.seenAnswer; },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchSellerItems: async () => { reads.more++; return Array.from({ length: reads.others }, (_, i) => ({ id: `o${i}`, status: "live" })); },
}));

import { activeToday, listedAgo, sellerBadges } from "@/lib/declutter/sellerBadges";
import type { ActiveBand } from "@/lib/activeBand";
import { SellerTrustBadges } from "@/components/declutter/SellerTrustBadges";
import { BundleSaveBox } from "@/components/declutter/DeclutterBundleRow";

const NOW = new Date("2026-11-07T18:00:00Z");
const minus = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("listed and active words", () => {
  it("says how fresh a listing is, and nothing for none or over two months", () => {
    expect(listedAgo(minus(20_000), NOW)).toBe("Listed just now");
    expect(listedAgo(minus(3 * 60_000), NOW)).toBe("Listed 3 min ago");
    expect(listedAgo(minus(5 * 3_600_000), NOW)).toBe("Listed 5 h ago");
    expect(listedAgo(minus(30 * 3_600_000), NOW)).toBe("Listed yesterday");
    expect(listedAgo(minus(4 * 86_400_000), NOW)).toBe("Listed 4 days ago");
    expect(listedAgo(minus(15 * 86_400_000), NOW)).toBe("Listed 2 weeks ago");
    expect(listedAgo(minus(70 * 86_400_000), NOW)).toBeNull();
    expect(listedAgo(null, NOW)).toBeNull();
  });

  it("says Active today only for the server's 'today' band (a sign-in is not a visit: older says nothing)", () => {
    expect(activeToday("today")).toBe("Active today");
    expect(activeToday("this_week")).toBeNull();
    expect(activeToday(null)).toBeNull();
  });
});

describe("seller badges: honest bars, none when thin", () => {
  it("Lists often at 5 for sale (this one and 4 more), not at 4", () => {
    expect(sellerBadges({ othersForSale: 4, onTime: null, activeBand: null }).map((b) => b.key)).toEqual(["lists_often"]);
    expect(sellerBadges({ othersForSale: 3, onTime: null, activeBand: null })).toEqual([]);
    expect(sellerBadges({ othersForSale: null, onTime: null, activeBand: null })).toEqual([]);
  });

  it("On-time handovers only on the server's yes; nothing for no or not deployed", () => {
    expect(sellerBadges({ othersForSale: 0, onTime: true, activeBand: null }).map((b) => b.label)).toEqual(["On-time handovers"]);
    expect(sellerBadges({ othersForSale: 0, onTime: false, activeBand: null })).toEqual([]);
    expect(sellerBadges({ othersForSale: 0, onTime: null, activeBand: null })).toEqual([]);
  });

  it("the card reads nothing before the page has painted, then shows the badges that clear their bars", async () => {
    reads.onTime = reads.seen = reads.more = 0;
    reads.onTimeAnswer = true;
    reads.seenAnswer = "today";
    reads.others = 4;
    const { rerender, container } = wrap(<SellerTrustBadges sellerId="s1" itemId="i1" after={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reads.onTime + reads.seen + reads.more).toBe(0);
    expect(container.querySelector("[data-seller-badges]")).toBeNull();
    rerender(<QueryClientProvider client={new QueryClient()}><SellerTrustBadges sellerId="s1" itemId="i1" after /></QueryClientProvider>);
    await waitFor(() => expect(container.querySelectorAll("[data-seller-badge]").length).toBe(3));
    expect([...container.querySelectorAll("[data-seller-badge]")].map((b) => b.textContent)).toEqual(["Lists often", "On-time handovers", "Active today"]);
  });

  it("thin data: no badges at all", async () => {
    reads.onTimeAnswer = false;
    reads.seenAnswer = null;
    reads.others = 1;
    const { container } = wrap(<SellerTrustBadges sellerId="s2" itemId="i2" after />);
    await waitFor(() => expect(reads.more).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-seller-badges]")).toBeNull();
  });
});

describe("Bundle and save", () => {
  const summary = { count: 3, capped: false, firstName: "Marie", free: false, pickup: true, offer: "Buy 2+, get 10% off" };
  it("shows when the seller's bundle discount applies, and points at the seller's items", () => {
    wrap(<BundleSaveBox summary={summary} />);
    expect(screen.getByRole("heading", { name: "Bundle and save" })).toBeTruthy();
    expect(screen.getByText(/Buy 2\+, get 10% off from Marie\. 3 more items for sale, one pickup and one payment\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "See Marie's items" })).toBeTruthy();
  });
  it("no box without a discount", () => {
    const { container } = wrap(<BundleSaveBox summary={{ ...summary, offer: null }} />);
    expect(container.querySelector("[data-bundle-save]")).toBeNull();
  });
});

describe("the item page wiring", () => {
  const src = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
  it("reads below-the-fold only after the item and photos paint; guests see the rows", () => {
    expect(src).toMatch(/const afterPaint = useAfterPaint\(!!item\.data && !photos\.isLoading\);/);
    expect(src).toMatch(/\{!isSeller && afterPaint && \(\s*<div className="mt-8">\s*<DeclutterItemRows item=\{it\} viewerId=\{user\?\.id \?\? null\}/);
    expect(src).toMatch(/<SellerTrustBadges sellerId=\{it\.seller_id\} itemId=\{it\.id\} after=\{afterPaint\} \/>/);
  });
  it("Listed beside the condition; Free porch pickup leads the where-line; the bundle box", () => {
    expect(src).toMatch(/<ConditionChip stars=\{it\.condition_stars\} \/>\s*(?:\{\s*\}\s*)?\{forSale && listedAgo\(it\.live_at\) &&/);
    expect(src).toMatch(/\{it\.porch_ok !== false && <span data-item-porch-free=""[^>]*>\{t\("decl\.item\.freePorch"\)\} · <\/span>\}/);
    expect(src).toMatch(/<BundleSaveBox summary=\{bundle\} \/>/);
  });
});
