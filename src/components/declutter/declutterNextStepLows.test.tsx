/**
 * Auditor 3's next-step Lows (audit 11-01, ~/.lh-shots/audit-1101-a3.md), each on the shared NextStep line:
 * - A3-24: the seller's sale waiting for payment says "Waiting on the buyer to pay · by <hold end>".
 * - A3-25: the free giver's "Next: pick who gets it · <n> asked".
 * - A3-27: the order chat shows the order card's step and its one button, which opens that card (?order=).
 * - A3-28: each bank payout in Payout history says its next step (payoutNextStep, PayoutHistory.tsx).
 * (A3-26, the Wanted poster's step, is 0d275553a6 on the follow train: declutterWantedForm.test.tsx.)
 *
 * @mutate src/components/declutter/DeclutterSalesWaiting.tsx | by: kind === "paid" ? byClock(l.checkout_by) : timeLeft(l.checkout_by) | by: timeLeft(l.checkout_by)
 * @mutate src/components/declutter/DeclutterSalesWaiting.tsx |     line: "Waiting on the buyer to pay", |     line: "Waiting for the buyer to pay",
 * @mutate src/lib/declutter/timeLeft.ts |   return sameDay ? `by ${time}` : | return sameDay ? `${time}` :
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | text: "Pick who gets it", by: `${rows.length} asked` | text: "Pick who gets it"
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | {(t.side === "buyer" \|\| t.side === "seller") && <Suspense | {false && <Suspense
 * @mutate src/components/declutter/OrderTalkStep.tsx |   return `/declutter?tab=${side === "buyer" ? "buying" : "selling"}&order=${orderId}`; |   return `/declutter?tab=${side === "buyer" ? "buying" : "selling"}`;
 * @mutate src/components/declutter/OrderTalkStep.tsx | action={step.who === "you" ? "See the order" : null} | action={null}
 * @mutate src/pages/profile/PayoutHistory.tsx | action: { label: "Payout settings", to: "/profile?tab=payment" } | action: null
 * @mutate src/pages/profile/PayoutHistory.tsx |       return { step: { who: "them", text: "Waiting on the bank", by: `arrives about ${payoutDay(p.arrival_date)}` }, action: null }; |       return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

const state = vi.hoisted(() => ({
  cart: [] as unknown[],
  asks: [] as unknown[],
  bookings: [] as unknown[],
  handover: { order_id: "o1", status: "paid", side: "seller", confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null } as unknown,
  talk: null as unknown,
}));

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, loading: false }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("./DeclutterHandoverTalk", () => ({ SellerTalks: () => null, NoWayWorks: () => null }));
vi.mock("./useOpenProblems", () => ({ useOpenProblems: () => new Map() }));
vi.mock("./useMarkTalkRead", () => ({ useMarkTalkRead: () => {} }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyCart: () => Promise.resolve(state.cart),
  fetchFreeRequestsForItem: () => Promise.resolve(state.asks),
}));
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchMyBookings: () => Promise.resolve(state.bookings),
  fetchMyHandover: () => Promise.resolve(state.handover),
}));
vi.mock("@/lib/declutter/orderTalk", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/orderTalk")>()),
  fetchOrderTalk: () => Promise.resolve(state.talk),
  fetchMyOrderTalks: () => Promise.resolve([]),
}));
vi.mock("./BuyingOrders", () => ({
  useBuyingTracker: () => ({
    views: new Map([["33333333-3333-4333-8333-333333333333", { orderId: "33333333-3333-4333-8333-333333333333", next: { who: "you", text: "Pick a pickup time" }, action: "Pick a pickup time" }]]),
  }),
}));

import { SalesWaiting } from "./DeclutterSalesWaiting";
import { FreeRequestsForGiver } from "./DeclutterFreeClaim";
import { OrderTalkFromLink } from "./DeclutterOrderTalk";
import { byClock } from "@/lib/declutter/timeLeft";
import { payoutNextStep } from "@/pages/profile/PayoutHistory";
import { nextStepWords } from "@/components/ui/NextStep";
import type { DeclutterItem } from "@/lib/declutter/api";

let where = "";
function Where() {
  const l = useLocation();
  where = l.pathname + l.search;
  return null;
}
function show(ui: React.ReactNode, at = "/declutter") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>{ui}<Where /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const LINE = { line_id: "l1", item_id: "i1", item_title: "Oak chair", price_cents: 2500, my_side: "seller", status: "in_cart", seller_id: "u1" };

beforeEach(() => {
  state.cart = [];
  state.asks = [];
  state.bookings = [];
  state.talk = null;
  where = "";
});

describe("A3-24: the seller's sale waiting for payment", () => {
  it("says who it waits on and the hold's end as a clock time", async () => {
    const end = new Date(Date.now() + 25 * 60_000).toISOString();
    state.cart = [{ ...LINE, checkout_by: end }];
    show(<SalesWaiting />);
    const region = await screen.findByRole("region", { name: "Sold, waiting for the buyer to pay" });
    const line = region.querySelector("[data-next-step]");
    expect(line?.getAttribute("data-next-step")).toBe("them");
    expect(line?.textContent).toBe(`Waiting on the buyer to pay · ${byClock(end)}`);
    expect(line?.textContent).toMatch(/ · by \d{1,2}:\d{2} [AP]M$/);
    expect(within(region).getByRole("button", { name: "Cancel sale" })).toBeInTheDocument();
  });

  it("byClock names the day when the hold ends on another day, and says when it is up", () => {
    const now = new Date(2026, 10, 1, 23, 50).getTime();
    expect(byClock(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe("by Mon 9:05 AM");
    expect(byClock(new Date(2026, 10, 1, 23, 55).toISOString(), now)).toBe("by 11:55 PM");
    expect(byClock(new Date(2026, 10, 1, 23, 0).toISOString(), now)).toBe("time is up");
  });
});

describe("A3-25: the free giver's Pick who gets it", () => {
  it("counts who asked", async () => {
    state.asks = [
      { request_id: "r1", display_name: "Ann G.", pickup_at: null, review_count: 0, avg_rating: null },
      { request_id: "r2", display_name: "Bo T.", pickup_at: null, review_count: 0, avg_rating: null },
    ];
    show(<FreeRequestsForGiver item={{ id: "i9" } as DeclutterItem} />);
    await screen.findByText("Ann G.");
    const line = document.querySelector('[data-free-requests] [data-next-step="you"]');
    expect(line?.textContent).toBe("Next: pick who gets it · 2 asked");
  });
});

describe("A3-27: the order chat shows the order card's step", () => {
  const talk = (side: "buyer" | "seller") => ({ side, open: true, open_until: null, messages: [] });

  it("seller: put it out and take one photo (the card's words), See the order opens the card at the order", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    state.talk = talk("seller");
    state.cart = [{ ...LINE, status: "paid", order_id: id, order_status: "paid", handover: "porch", porch_ok: true }];
    state.bookings = [{ order_id: id, slot_start: "2026-11-07T15:00:00Z", slot_end: null, porch_mode: null, porch_until: null, pickup_day: null }];
    state.handover = { order_id: id, status: "paid", side: "seller", confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null };
    show(<OrderTalkFromLink />, `/declutter?tab=selling&order_talk=${id}`);
    const step = await screen.findByText("Next: put it out and take one photo where the buyer will find it");
    const box = step.closest("[data-order-talk-step]") as HTMLElement;
    expect(box.getAttribute("data-order-talk-step")).toBe("you");
    fireEvent.click(within(box).getByRole("button", { name: "See the order" }));
    expect(where).toBe(`/declutter?tab=selling&order=${id}`);
  });

  it("buyer: the Buying card's step and its action words", async () => {
    state.talk = talk("buyer");
    const id = "33333333-3333-4333-8333-333333333333";
    show(<OrderTalkFromLink />, `/declutter?tab=buying&order_talk=${id}`);
    const step = await screen.findByText("Next: pick a pickup time");
    const box = step.closest("[data-order-talk-step]") as HTMLElement;
    fireEvent.click(within(box).getByRole("button", { name: "Pick a pickup time" }));
    expect(where).toBe(`/declutter?tab=buying&order=${id}`);
  });
});

describe("A3-28: Payout history says each payout's next step", () => {
  const day = 1792800000;
  it.each([
    ["failed", "Next: check your payout account · we try again once it's right", "Payout settings", "/profile?tab=payment"],
    ["canceled", "Next: message Support", "Message Support", "/support?topic=message"],
  ] as const)("%s: %s, button %s", (status, words, label, to) => {
    const n = payoutNextStep({ status, arrival_date: day });
    expect(n && nextStepWords(n.step)).toBe(words);
    expect(n?.action).toEqual({ label, to });
  });
  it.each(["pending", "in_transit"])("%s: waiting on the bank with the expected day, no button", (status) => {
    const n = payoutNextStep({ status, arrival_date: day });
    expect(n && nextStepWords(n.step)).toMatch(/^Waiting on the bank · arrives about \w{3}, \w{3} \d{1,2}$/);
    expect(n?.action).toBeNull();
  });
  it("paid: nothing to do", () => {
    expect(payoutNextStep({ status: "paid", arrival_date: day })).toBeNull();
  });
});
