/**
 * Audit 1030 DC-13: a seller's good news about money ("If you accept and the buyer pays, you keep the whole $6",
 * "You get $10 once the sale is final") sat on the rust money tint, the same tint as a held payout, a problem or
 * an error, so it read as a warning. Good news now sits on the sage tint (GOOD_NEWS_NOTE, goodNews.ts) in ordinary
 * ink, the amount in money ink; the held payout and the buyer's "You paid" keep the rust tint.
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <p className={GOOD_NEWS_NOTE} data-offer-note="" data-tone="good"> | <p className="rounded-xl bg-[hsl(var(--burnt-sienna)/0.10)] px-3 py-2 text-ds-13 text-[hsl(var(--sienna-ink))]" data-offer-note="" data-tone="good">
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const goodNews = side === "seller" && !problemOpen; |   const goodNews = false;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |   const goodNews = side === "seller" && !problemOpen; |   const goodNews = side === "seller";
 * @mutate src/components/declutter/goodNews.ts | bg-[hsl(var(--sage)/0.14)] | bg-[hsl(var(--burnt-sienna)/0.10)]
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ offers: [] as unknown[] }));

// A3-49: the seller's waiting line reads the buyer's first name; the tint is what this file checks.
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: null, name: null, avatarUrl: null, first: null, who: "the buyer" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => [],
  respondOffer: async () => "countered",
}));
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("./BuyerTotal", () => ({ BuyerTotal: () => null }));
// A3-18/19: the order row's pickup times (book_by, the checkout time); none here, so the old words stand.
vi.mock("@/lib/declutter/orderPickupTimes", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/orderPickupTimes")>()), fetchOrderPickupTimes: async () => [] }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => ({ set_out_at: null, picked_up_at: null, confirmed_at: null, status: "paid" }),
  handoverPhotoUrl: async () => null,
}));
vi.mock("./useMyPaidCents", () => ({ useMyPaidCents: () => new Map([["o1", 4470]]) }));

import { OffersSection } from "./DeclutterTradeViews";
import { PickupStatus } from "./DeclutterPorchHandover";

const RUST = /burnt-sienna/;
const SAGE = "bg-[hsl(var(--sage)/0.14)]";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
/** The tint a note paints: its class list plus any inline background. */
const tint = (el: HTMLElement) => `${el.className} ${el.getAttribute("style") ?? ""}`;

describe("a seller's good news about money is on the sage tint, not the rust warning tint (DC-13)", () => {
  beforeEach(() => {
    state.offers = [{
      offer_id: "o1", item_id: "i1", item_title: "Blue enamel mug", my_side: "seller", amount_cents: 600, awaiting: "seller",
      status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 0, current_price_cents: 1000,
      floor_price_cents: null, updated_at: "2026-10-30",
    }];
  });

  it("the offer's 'you keep the whole' note", async () => {
    wrap(<OffersSection side="seller" />);
    const note = (await screen.findByText(/you keep the whole/)).closest("[data-offer-note]") as HTMLElement;
    expect(note.textContent).toBe("If you accept and the buyer pays, you keep the whole $6.");
    expect(note.className.split(/\s+/)).toContain(SAGE);
    expect(tint(note)).not.toMatch(RUST);
    expect(note.className.split(/\s+/)).toContain("text-foreground");
  });

  it("the seller's 'You get' line is sage; a held payout and the buyer's 'You paid' keep the rust tint", async () => {
    const notes: HTMLElement[] = [];
    const { unmount } = wrap(<PickupStatus orderId="o1" handover="porch" side="seller" slot={null} itemsCents={1000} />);
    const good = (await screen.findByText(/You get/)).closest("[data-money-note]") as HTMLElement;
    notes.push(good);
    expect(good.className.split(/\s+/)).toContain(SAGE);
    expect(tint(good)).not.toMatch(RUST);
    unmount();

    const held = wrap(<PickupStatus orderId="o1" handover="porch" side="seller" slot={null} itemsCents={1000} problemOpen />);
    const heldNote = (await screen.findByText(/is held while/)).closest("[data-money-note]") as HTMLElement;
    notes.push(heldNote);
    expect(tint(heldNote)).toMatch(RUST);
    expect(heldNote.className.split(/\s+/)).not.toContain(SAGE);
    held.unmount();

    wrap(<PickupStatus orderId="o1" handover="porch" side="buyer" slot={null} itemsCents={1000} />);
    const paid = (await screen.findByText(/You paid/)).closest("[data-money-note]") as HTMLElement;
    notes.push(paid);
    expect(tint(paid)).toMatch(RUST);
    expect(notes.length).toBeGreaterThan(2);
  });
});
