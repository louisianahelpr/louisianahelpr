/**
 * Boards 79 and 80: Declutter's "What next" sheets on the shared WhatNextSheet.
 * 79 (after an offer): the real rules from the offer panel's fine print, read 2026-10-20 (48 hours to answer,
 * 48 hours to check out, nothing charged until then), the pickup total from buyNowTotalCents.
 * 80 (after listing): price and next drop read back from the item via priceDrop.ts; a fixed-price
 * listing shows no drop step; a listing sent for review says so.
 *
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       setSentCents(cents); |       toast.success("Offer sent. The seller has 48 hours to answer.");
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | <Money cents={buyNowTotalCents(cents)} /> | <Money cents={cents} />
 * @mutate src/components/declutter/ListedWhatNext.tsx |   const drop = live ? nextPriceDrop(it) : null; |   const drop = live ? { at: new Date(), lowestCents: 1 } : null;
 * @mutate src/components/declutter/DeclutterSellView.tsx |       navigate("/declutter?view=selling", { state: { justListed: { itemId, status } } }); |       navigate("/declutter?view=selling");
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfferSentWhatNext } from "@/components/declutter/OfferSentWhatNext";
import { ListedWhatNext } from "@/components/declutter/ListedWhatNext";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
const items: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async (id: string) => items[id] ?? null,
  fetchItemDropState: async (id: string) => ({ sale_mode: items[id]?.sale_mode ?? null, last_price_drop_on: null }),
  // Board 192's link card reads the cover.
  fetchPhotos: async () => [],
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
}));
const code = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");

function renderListed(itemId: string, status: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: "/declutter", search: "?view=selling", state: { justListed: { itemId, status } } }]}>
        <ListedWhatNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("board 79: after an offer", () => {
  it("states the real windows and the pickup total, no pronouns", () => {
    render(<OfferSentWhatNext cents={5000} onClose={() => {}} onBrowse={() => {}} />);
    const sheet = screen.getByTestId("what-next-sheet");
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps[0].textContent).toContain("You offered $50");
    expect(steps[1].getAttribute("data-state")).toBe("now");
    // 5000 + round(5000 * 0.05) + 70 = 5320
    expect(steps[2].textContent).toContain("48 hours to check out: $53.20 for pickup");
    expect(sheet.textContent).not.toMatch(/\b(he|she|his|her)\b/i);
    expect(code("src/components/declutter/DeclutterOfferPanel.tsx")).toMatch(/setSentCents\(cents\);/);
  });
});

describe("board 80: after listing", () => {
  it("a live offers listing shows its price and the next possible drop", async () => {
    items.a = { id: "a", title: "Brass lamp", status: "live", sale_mode: "offers", current_price_cents: 4000, live_at: new Date(Date.now() - 60e3).toISOString(), last_price_drop_on: null };
    renderListed("a", "live");
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeTruthy();
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).toContain("Listed at $40");
    expect(text).toMatch(/Price can drop/);
    expect(text).toContain("As low as $38");
  });

  it("a listing the drop rule never touches (auction) shows no drop, and a reviewed one says so", async () => {
    items.b = { id: "b", title: "Box fan", status: "live", sale_mode: "auction", current_price_cents: 2000, live_at: new Date().toISOString() };
    const { unmount } = renderListed("b", "live");
    expect(await screen.findByText(/Listed at/)).toBeTruthy();
    expect(screen.getByTestId("what-next-sheet").textContent).not.toMatch(/drop/i);
    unmount();
    items.c = { id: "c", title: "Chair", status: "pending_review", current_price_cents: 1500, live_at: null };
    renderListed("c", "pending_review");
    expect(await screen.findByRole("heading", { name: "Sent for a review" })).toBeTruthy();
    expect(code("src/components/declutter/DeclutterSellView.tsx")).toMatch(/state: \{ justListed: \{ itemId, status \} \}/);
  });
});
