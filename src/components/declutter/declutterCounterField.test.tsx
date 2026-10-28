/**
 * The counter-offer field says what it is (Declutter deep audit #47, 2026-10-28, shot 30-seller-counter-filled-390):
 * "Answer with a price" opened a bare box with no "$" and only a hidden label, so the number typed had no unit and
 * the field no name on screen. It now has a shown "Your price" label and a "$" inside the field, and the dollars
 * typed still go out as cents.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ offers: [] as unknown[], responded: [] as unknown[][] }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => [],
  respondOffer: async (...a: unknown[]) => {
    state.responded.push(a);
    return "countered";
  },
}));
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));

import { OffersSection } from "./DeclutterTradeViews";

const OFFER = {
  offer_id: "o1", item_id: "i1", item_title: "Blue enamel mug", my_side: "seller", amount_cents: 2200, awaiting: "seller",
  status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 0, current_price_cents: 4000,
  floor_price_cents: 2500, updated_at: "2026-10-28",
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OffersSection side="seller" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("counter-offer field: a shown label and a $ (deep audit #47)", () => {
  beforeEach(() => {
    state.offers = [OFFER];
    state.responded = [];
  });

  // @mutate src/components/declutter/DeclutterTradeViews.tsx | <label className="block text-sm font-semibold" htmlFor={`counter-${o.offer_id}`}>Your price</label> | <label className="sr-only" htmlFor={`counter-${o.offer_id}`}>Your price</label>
  // @mutate src/components/declutter/DeclutterTradeViews.tsx | <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span> | <span aria-hidden className="sr-only"></span>
  it("the field is named on screen, shows a $ inside it, and sends the dollars typed as cents", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    const label = screen.getByText("Your price", { selector: "label" });
    expect(label.className.split(/\s+/)).not.toContain("sr-only");
    const field = input.closest("[data-counter-field]") as HTMLElement;
    expect(field).not.toBeNull();
    expect(within(field).getByText("$")).toHaveAttribute("aria-hidden");
    // The words in the box never repeat the label or the unit.
    expect(input).toHaveAttribute("placeholder", "30");
    fireEvent.change(input, { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.responded).toHaveLength(1));
    expect(state.responded[0]).toEqual(expect.arrayContaining(["o1", "counter", 3200]));
  });
});
