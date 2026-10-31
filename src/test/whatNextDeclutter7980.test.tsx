/**
 * Boards 79 and 80: Declutter's "What next" sheets on the shared WhatNextSheet.
 * 79 (after an offer): the real rules from the offer panel's fine print, read 2026-10-20 (48 hours to answer,
 * 48 hours to check out, nothing charged until then), the pickup total from buyNowTotalCents.
 * 80 (after listing): price and next drop read back from the item via priceDrop.ts; a fixed-price
 * listing shows no drop step; a listing sent for review says so.
 *
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       setSentCents(cents); |       toast.success("Offer sent. The seller has 48 hours to answer.");
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | <BuyerTotal priceCents={cents} className={MONEY} pendingClassName="font-normal" /> | <Money cents={cents} />
 * @mutate src/components/declutter/OfferSentWhatNext.tsx |         returnFocusTo.current.focus({ preventScroll: true }); |         void returnFocusTo;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | cents={sentCents} returnFocusTo={panel} onClose | cents={sentCents} onClose
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | <section ref={panel} tabIndex={-1} className | <section ref={panel} className
 * @mutate src/components/declutter/ListedWhatNext.tsx |   const drop = live ? nextPriceDrop(it) : null; |   const drop = live ? { at: new Date(), lowestCents: 1 } : null;
 * @mutate src/components/declutter/useSellFlowState.ts |       navigate("/declutter?tab=selling", { state: { justListed: { itemId: id, status } } }); |       navigate("/declutter?tab=selling");
 */
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfferSentWhatNext } from "@/components/declutter/OfferSentWhatNext";
import { ListedWhatNext } from "@/components/declutter/ListedWhatNext";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
// BuyerTotal (2026-10-29): the pickup total adds the one-time setup fee still owed (useFirstPayoutFee).
const fee = { cents: 0, known: true };
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => fee.cents, useFirstPayoutFeeKnown: () => fee.known }));
const items: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async (id: string) => items[id] ?? null,
  fetchItemDropState: async (id: string) => ({ sale_mode: items[id]?.sale_mode ?? null, last_price_drop_on: null, ...(items[id] && "drop_pct" in items[id] ? { drop_pct: items[id].drop_pct as number } : {}) }),
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

  it("BuyerTotal: the pickup total includes a setup fee still owed, and says one may be added while unknown", () => {
    fee.cents = 200;
    const { unmount } = render(<OfferSentWhatNext cents={5000} onClose={() => {}} onBrowse={() => {}} />);
    expect(within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem")[2].textContent).toContain("check out: $55.20 for pickup");
    unmount();
    fee.cents = 0;
    fee.known = false;
    render(<OfferSentWhatNext cents={5000} onClose={() => {}} onBrowse={() => {}} />);
    expect(within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem")[2].textContent).toContain("check out: $53.20 + any one-time setup fee for pickup");
    fee.known = true;
  });
});

describe("board 79: closing Offer sent", () => {
  function Sent() {
    const panel = useRef<HTMLElement>(null);
    const [cents, setCents] = useState<number | null>(5000);
    return (
      <section ref={panel} tabIndex={-1} aria-label="the panel">
        <OfferSentWhatNext cents={cents} returnFocusTo={panel} onClose={() => setCents(null)} onBrowse={() => setCents(null)} />
      </section>
    );
  }

  it("focus goes to the offer panel, because Send offer's form has already left the page", async () => {
    render(<Sent />);
    const sheet = await screen.findByTestId("what-next-sheet");
    const panel = document.querySelector<HTMLElement>('[aria-label="the panel"]')!;
    await act(async () => {
      fireEvent.keyDown(sheet, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("what-next-sheet")).toBeNull();
      expect(document.activeElement).toBe(panel);
    });
  });

  it("the real panel gives its section as the target, and the section can take focus", () => {
    const panel = code("src/components/declutter/DeclutterOfferPanel.tsx");
    expect(panel).toMatch(/cents=\{sentCents\} returnFocusTo=\{panel\}/);
    expect(panel).toMatch(/<section ref=\{panel\} tabIndex=\{-1\}/);
  });
});

describe("board 80: after listing", () => {
  // Audit posting 1030 #12: a giveaway's sheet reads as one.
  // @mutate src/components/declutter/ListedWhatNext.tsx |   const free = it.current_price_cents === 0; |   const free = false;
  it("a free listing says free and claimed, never price or buyers", async () => {
    items.f = { id: "f", title: "Box of books", status: "live", sale_mode: "offers", current_price_cents: 0, live_at: new Date().toISOString() };
    renderListed("f", "live");
    expect(await screen.findByRole("heading", { name: "Your free listing is live" })).toBeTruthy();
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).toContain("Listed for free");
    expect(text).toContain("When it's claimed");
    expect(text).not.toMatch(/\$0|up for sale|When it sells|Buyers ask/);
  });

  it("a live offers listing shows its price and the next possible drop", async () => {
    items.a = { id: "a", title: "Brass lamp", status: "live", sale_mode: "offers", current_price_cents: 4000, live_at: new Date(Date.now() - 60e3).toISOString(), last_price_drop_on: null };
    renderListed("a", "live");
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeTruthy();
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).toContain("Listed at $40");
    expect(text).toMatch(/Price can drop/);
    expect(text).toContain("As low as $38");
  });

  // LEAD-BUNCH-DROPS-IGNORED (owner 2026-10-31): the sheet reads the listing's own saved step. Drops off (0) promises
  // no drop; the seller's 5% says 5%.
  // @mutate src/components/declutter/ListedWhatNext.tsx | return row ? { ...row, ...(drop ?? {}) } : null; | return row ? { ...row, ...(drop ?? {}), drop_pct: 5 } : null;
  it("LEAD-BUNCH-DROPS-IGNORED: a live listing saved with drops off promises no drop; one saved at 5% says 5%", async () => {
    items.off = { id: "off", title: "Cooler", status: "live", sale_mode: "offers", current_price_cents: 2500, live_at: new Date(Date.now() - 60e3).toISOString(), last_price_drop_on: null, drop_pct: 0 };
    const { unmount } = renderListed("off", "live");
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeTruthy();
    expect(screen.getByTestId("what-next-sheet").textContent).not.toMatch(/drop/i);
    unmount();
    items.on = { ...items.off, id: "on", drop_pct: 5 };
    renderListed("on", "live");
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeTruthy();
    expect(screen.getByTestId("what-next-sheet").textContent).toMatch(/Price can drop[\s\S]*5% less each evening/);
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
    expect(code("src/components/declutter/useSellFlowState.ts")).toMatch(/state: \{ justListed: \{ itemId: id, status \} \}/);
  });
});
