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

const state = vi.hoisted(() => ({ offers: [] as unknown[], responded: [] as unknown[][], cart: [] as unknown[] }));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
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
    state.cart = [];
  });

  // Audit 11-10 F356 (owner 11-11): the seller's card names the buyer, first name + last initial, as the server gives it.
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | {o.my_side === "seller" && o.buyer_display && | {false && o.buyer_display &&
  it("F356: the seller's card says From Ann S.; nothing when the server sends no name", async () => {
    state.offers = [{ ...OFFER, buyer_display: "Ann S." }, { ...OFFER, offer_id: "o2", item_id: "i2", item_title: "Oak chair", buyer_display: null }];
    show("seller");
    await waitFor(() => expect(document.querySelectorAll("[data-offer-buyer]").length).toBe(1));
    expect(document.querySelector("[data-offer-buyer]")?.textContent).toBe("From Ann S.");
  });

  // Audit 11-10 F359: an accepted offer says what is next, from its cart line: the buyer checks out by its deadline,
  // the seller waits on the payment. A paid line says nothing more here.
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |       {o.status === "accepted" && <AcceptedOfferNext o={o} />}\n |
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | l.my_side === o.my_side && l.status === "in_cart" | l.my_side === o.my_side
  it("F359: an accepted offer says In your cart with Check out (buyer) or Waiting on the buyer to pay (seller)", async () => {
    const by = "2027-11-12T20:23:00Z";
    const line = (side: string, status: string) => ({ line_id: `l-${side}`, item_id: "i1", item_title: "Blue enamel mug", my_side: side, seller_id: "s1", price_cents: 2200, status, checkout_by: by, order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true });
    state.offers = [{ ...OFFER, my_side: "buyer", status: "accepted" }];
    state.cart = [line("buyer", "in_cart")];
    const buyer = show("buyer");
    const next = await waitFor(() => {
      const el = document.querySelector('[data-accepted-next="buyer"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(next.textContent).toContain("In your cart. Check out by ");
    expect(within(next).getByRole("link", { name: "Check out" })).toHaveAttribute("href", "/declutter?tab=buying&checkout=s1");
    buyer.unmount();
    state.offers = [{ ...OFFER, status: "accepted" }];
    state.cart = [line("seller", "in_cart")];
    const seller = show("seller");
    // The seller's accepted offer sits under the closed-offers fold (deep audit #30).
    fireEvent.click(await screen.findByRole("button", { name: /^Show 1 closed offer/ }));
    await waitFor(() => expect(document.querySelector('[data-accepted-next="seller"]')?.textContent ?? "").toMatch(/^Waiting on the buyer to pay by .+\.$/));
    seller.unmount();
    state.cart = [line("seller", "paid")];
    show("seller");
    fireEvent.click(await screen.findByRole("button", { name: /^Show 1 closed offer/ }));
    await screen.findByText("Blue enamel mug");
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-accepted-next]")).toBeNull();
  });

  // @mutate src/components/declutter/DeclutterOffersSection.tsx | <label className="block text-sm font-semibold" htmlFor={`counter-${o.offer_id}`}>{t("dof.yourPriceLabel")}</label> | <label className="sr-only" htmlFor={`counter-${o.offer_id}`}>{t("dof.yourPriceLabel")}</label>
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
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   const serverMin = o.my_side === "buyer" ? Math.max(100, Math.ceil(o.current_price_cents / 2)) : 100; |   const serverMin = 100;
// Audit 11-10 F355: the seller's counter sits above the buyer's offer, the buyer's below the seller's counter.
// @mutate src/components/declutter/DeclutterOffersSection.tsx | Math.max(serverMin, o.amount_cents + 1)) : serverMin; | serverMin) : serverMin;
// @mutate src/components/declutter/DeclutterOffersSection.tsx | Math.min(serverMax, o.amount_cents - 1)) : serverMax; | serverMax) : serverMax;
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   if (o.my_side === "seller" && cents <= o.amount_cents && cents >= 100) return |   if (o.my_side === "seller" && cents === o.amount_cents) return
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   if (o.my_side === "buyer" && cents >= o.amount_cents && cents <= o.current_price_cents) return |   if (o.my_side === "buyer" && cents === o.amount_cents) return
// @mutate src/components/declutter/DeclutterOffersSection.tsx | disabled={act.isPending \|\| !counterCents \|\| !!counterBad}> | disabled={act.isPending \|\| !counterCents}>
// @mutate src/components/declutter/DeclutterOffersSection.tsx |   useEffect(() => { if (countering) counterBox.current?.focus(); }, [countering]); |   useEffect(() => {}, [countering]);
describe("the counter box says its range and refuses a price outside it (NIGHT-SELL-offers,sale-4)", () => {
  beforeEach(() => {
    state.offers = [{ ...OFFER, current_price_cents: 4500 }];
    state.responded = [];
  });

  it("seller: focused on opening, above the buyer's $22 up to the $45 price; $99, $22 and $10 keep Send off with the reason", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription("Between $22.01 and $45.");
    fireEvent.change(input, { target: { value: "99" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("Your price has to be between $22.01 and $45.");
    fireEvent.change(input, { target: { value: "22" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("They already offered $22. Answer with more than that, or tap Accept.");
    // F355: less than the offer on the table is not a counter.
    fireEvent.change(input, { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("They already offered $22. Answer with more than that, or tap Accept.");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.responded).toHaveLength(1));
    expect(state.responded[0]).toEqual(expect.arrayContaining(["o1", "counter", 4000]));
  });

  it("buyer: at least half the price now, and under the seller's $40 counter (F355)", async () => {
    state.offers = [{ ...OFFER, current_price_cents: 4500, my_side: "buyer", awaiting: "buyer", amount_cents: 4000 }];
    show("buyer");
    fireEvent.click(await screen.findByRole("button", { name: "Answer with a price" }));
    const input = screen.getByLabelText("Your price");
    expect(input).toHaveAccessibleDescription("Between $22.50 and $39.99.");
    fireEvent.change(input, { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "42" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(input).toHaveAccessibleDescription("They're asking $40. Answer with less than that, or tap Accept.");
    fireEvent.change(input, { target: { value: "23" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});

// BUY-10 (buying audit 10-30 #10): "Take back my offer" ended the offer in one tap.
// @mutate src/components/declutter/DeclutterOffersSection.tsx | disabled={act.isPending} onClick={() => setWithdrawing(true)}> | disabled={act.isPending} onClick={() => act.mutate({ action: "withdraw" })}>
// @mutate src/components/declutter/DeclutterOffersSection.tsx |         {t("dof.wdBody", { title: o.item_title, amount: formatPrice(o.amount_cents) })} |         {""}
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
