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

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
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
vi.mock("./BuyerTotal", () => ({ BuyerTotal: () => null }));

import { OffersSection } from "./DeclutterTradeViews";

const OFFER = {
  offer_id: "o1", item_id: "i1", item_title: "Blue enamel mug", my_side: "seller", amount_cents: 2200, awaiting: "seller",
  status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 0, current_price_cents: 4000,
  floor_price_cents: 2500, updated_at: "2026-10-28",
};

function show(side: "buyer" | "seller" = "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OffersSection side={side} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("counter-offer field: a shown label and a $ (deep audit #47)", () => {
  beforeEach(() => {
    state.offers = [OFFER];
    state.responded = [];
  });

  // @mutate src/components/declutter/DeclutterOffersSection.tsx | <label className="block text-sm font-semibold" htmlFor={`counter-${o.offer_id}`}>Your price</label> | <label className="sr-only" htmlFor={`counter-${o.offer_id}`}>Your price</label>
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span> | <span aria-hidden className="sr-only"></span>
  it("the field is named on screen, shows a $ inside it, and sends the dollars typed as cents", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    const label = screen.getByText("Your price", { selector: "label" });
    expect(label.className.split(/\s+/)).not.toContain("sr-only");
    const field = input.closest("[data-counter-field]") as HTMLElement;
    expect(field).not.toBeNull();
    expect(within(field).getByText("$")).toHaveAttribute("aria-hidden");
    // The words in the box never repeat the label or the unit. Audit 1030 DC-12: the example is halfway between
    // this offer ($22) and the price now ($40), not a hard-coded "30".
    expect(input).toHaveAttribute("placeholder", "31");
    fireEvent.change(input, { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.responded).toHaveLength(1));
    expect(state.responded[0]).toEqual(expect.arrayContaining(["o1", "counter", 3200]));
  });

  // @mutate src/components/declutter/DeclutterOffersSection.tsx | placeholder={counterExample(o)} | placeholder="30"
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |   o.my_side === "seller" ? String(Math.round((Math.min(o.amount_cents, o.current_price_cents) + o.current_price_cents) / 200)) : undefined; |   String(Math.round((Math.min(o.amount_cents, o.current_price_cents) + o.current_price_cents) / 200));
  it("the example follows each offer's numbers; a buyer answering a counter gets no made-up number (DC-12)", async () => {
    state.offers = [
      { ...OFFER, offer_id: "o2", item_title: "Oak chair", amount_cents: 5000, current_price_cents: 9000 },
      { ...OFFER, offer_id: "o3", item_title: "Lamp", amount_cents: 1200, current_price_cents: 1000 },
    ];
    show();
    const answers = await screen.findAllByRole("button", { name: "Answer with a price" });
    expect(answers.length).toBeGreaterThan(1);
    answers.forEach((b) => fireEvent.click(b));
    const boxes = screen.getAllByLabelText("Your price");
    expect(boxes.map((b) => b.getAttribute("placeholder"))).toEqual(["70", "10"]);
  });

  it("the buyer's counter box has no example", async () => {
    state.offers = [{ ...OFFER, my_side: "buyer", awaiting: "buyer", amount_cents: 3500 }];
    show("buyer");
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    expect(screen.getByLabelText("Your price")).not.toHaveAttribute("placeholder");
  });
});

// NIGHT-SELL-offers,sale-4: "Answer with a price" took any number and said nothing; the box wasn't focused.
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   return { min: o.my_side === "buyer" ? Math.max(100, Math.ceil(o.current_price_cents / 2)) : 100, max: o.current_price_cents }; |   return { min: 100, max: o.current_price_cents };
// @mutate src/components/declutter/DeclutterOffersSection.tsx | disabled={act.isPending \|\| !counterCents \|\| !!counterBad}> | disabled={act.isPending \|\| !counterCents}>
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   useEffect(() => { if (countering) counterBox.current?.focus(); }, [countering]); |   useEffect(() => {}, [countering]);
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   if (cents === o.amount_cents) return | if (cents === -1) return
describe("the counter box says its range and refuses a price outside it (NIGHT-SELL-offers,sale-4)", () => {
  beforeEach(() => {
    state.offers = [{ ...OFFER, current_price_cents: 4500 }];
    state.responded = [];
  });

  it("seller: focused on opening, $1 to the price now; $99 and the buyer's own amount keep Send off with the reason", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription("Between $1 and $45.");
    fireEvent.change(input, { target: { value: "99" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("Your price has to be between $1 and $45.");
    fireEvent.change(input, { target: { value: "22" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("$22 is the offer already on the table. To agree to it, tap Accept.");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.responded).toHaveLength(1));
    expect(state.responded[0]).toEqual(expect.arrayContaining(["o1", "counter", 4000]));
  });

  it("buyer: at least half the price now", async () => {
    state.offers = [{ ...OFFER, current_price_cents: 4500, my_side: "buyer", awaiting: "buyer", amount_cents: 4000 }];
    show("buyer");
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    expect(input).toHaveAccessibleDescription("Between $22.50 and $45.");
    fireEvent.change(input, { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "23" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});

// BUY-10 (buying audit 10-30 #10): "Take back my offer" ended the offer in one tap.
// @mutate src/components/declutter/DeclutterOffersSection.tsx | disabled={act.isPending} onClick={() => setWithdrawing(true)}> | disabled={act.isPending} onClick={() => act.mutate({ action: "withdraw" })}>
// @mutate src/components/declutter/DeclutterOffersSection.tsx |         {`"${o.item_title}": your offer of ${formatPrice(o.amount_cents)} ends. Nothing is charged.`} |         {""}
describe("Take back my offer asks first (BUY-10)", () => {
  beforeEach(() => {
    state.offers = [{ ...OFFER, my_side: "buyer", awaiting: "seller" }];
    state.responded = [];
  });

  it("opens a sheet naming the item and amount; Keep my offer sends nothing; the sheet's button withdraws", async () => {
    show("buyer");
    fireEvent.click(await screen.findByRole("button", { name: "Take back my offer" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Take back your offer?");
    expect(sheet).toHaveTextContent('"Blue enamel mug": your offer of $22 ends. Nothing is charged.');
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep my offer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.responded).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Take back my offer" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.responded).toEqual([["o1", "withdraw", null]]));
  });
});
