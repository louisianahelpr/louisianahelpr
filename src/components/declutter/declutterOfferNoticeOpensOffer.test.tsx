/**
 * Q2660 (account audit 1102d row 20): "New offer" and "New counteroffer" opened the bare Selling or Buying tab. The
 * writer now adds &offer=<id> (declutter_notice_order_link, 20261102124421; behaviour in
 * src/test/pglite/declutterOfferNoticesOpenTheOffer.pglite.mjs, 3x, red with NEW_MIGRATION=skip). Here:
 *   - the app: the offer named in ?offer= is scrolled to and focused, even when it has closed into the seller's fold;
 *     a malformed id names nothing; the member's own tap on the fold still closes it;
 *   - the writer's input: every "New offer" / "New counteroffer" call in the NEWEST declutter_make_offer and
 *     declutter_respond_offer is preceded by declutter_notice_ref(<offer id>), the setting the helper reads.
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <OfferRow key={o.offer_id} o={o} linked={o.offer_id === linkedOffer} />)}</ul>\n      ) | <OfferRow key={o.offer_id} o={o} />)}</ul>\n      )
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   const closedOpen = showClosed ?? (linkedOffer !== null && closed.some((o) => o.offer_id === linkedOffer)); |   const closedOpen = showClosed ?? false;
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   const closedOpen = showClosed ?? (linkedOffer !== null && closed.some((o) => o.offer_id === linkedOffer)); |   const closedOpen = !!showClosed \|\| (linkedOffer !== null && closed.some((o) => o.offer_id === linkedOffer));
 * @mutate src/components/declutter/useLinkedOrder.ts |   return id && UUID.test(id) ? id : null;\n} |   return id;\n}
 * @mutate supabase/migrations/20261102124421_declutter_offer_notices_open_the_offer.sql |       RETURN p_link \|\| '&offer=' \|\| v_offer; |       RETURN p_link;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({ offers: [] as unknown[] }));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => [],
  fetchItemHandovers: async () => [],
  respondOffer: async () => "declined",
}));
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("./BuyerTotal", () => ({ BuyerTotal: () => null }));

import { OffersSection } from "./DeclutterTradeViews";

const OPEN_ID = "dddddddd-0000-4000-8000-000000000001";
const CLOSED_ID = "dddddddd-0000-4000-8000-000000000002";
const OTHER_ID = "dddddddd-0000-4000-8000-000000000003";
const base = {
  item_id: "i1", my_side: "seller", amount_cents: 2200, awaiting: "seller", status: "open", counter_count: 0,
  respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), current_price_cents: 4000, floor_price_cents: null, updated_at: "2026-11-02",
};
const OFFERS = [
  { ...base, offer_id: OTHER_ID, item_title: "Green lamp" },
  { ...base, offer_id: OPEN_ID, item_title: "Blue enamel mug" },
  { ...base, offer_id: CLOSED_ID, item_title: "Oak chair", status: "declined" },
];

function show(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <OffersSection side="seller" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowOf = (title: string) => screen.getByRole("link", { name: title }).closest("li") as HTMLElement;

describe("an offer notice opens its offer (Q2660)", () => {
  beforeEach(() => {
    state.offers = OFFERS;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("the open offer named in ?offer= scrolls into view and takes focus; the others do not", async () => {
    show(`/declutter?tab=selling&offer=${OPEN_ID}`);
    await screen.findByRole("link", { name: "Blue enamel mug" });
    expect(rowOf("Blue enamel mug")).toHaveAttribute("data-linked-offer");
    expect(document.activeElement).toBe(rowOf("Blue enamel mug"));
    expect(rowOf("Green lamp")).not.toHaveAttribute("data-linked-offer");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("a notice's offer that has closed opens the fold, and the member's tap still closes it", async () => {
    show(`/declutter?tab=selling&offer=${CLOSED_ID}`);
    await screen.findByRole("link", { name: "Oak chair" });
    expect(document.activeElement).toBe(rowOf("Oak chair"));
    fireEvent.click(screen.getByRole("button", { name: "Hide closed offers" }));
    expect(screen.queryByRole("link", { name: "Oak chair" })).toBeNull();
  });

  it("no ?offer= or a malformed one: the fold stays closed and nothing is focused", async () => {
    show("/declutter?tab=selling");
    await screen.findByRole("link", { name: "Blue enamel mug" });
    expect(screen.queryByRole("link", { name: "Oak chair" })).toBeNull();
    expect(document.querySelector("[data-linked-offer]")).toBeNull();
    show(`/declutter?tab=selling&offer=${CLOSED_ID}x`);
    expect(document.querySelector("[data-linked-offer]")).toBeNull();
  });
});

describe("the writer names the offer in every offer notice (Q2659 ref, read by the Q2660 helper)", () => {
  it("each New offer / New counteroffer call in the newest callers follows declutter_notice_ref(<offer id>)", () => {
    const calls: [string, RegExp, string][] = [
      ["declutter_make_offer", /'New offer'/g, "v_id"],
      ["declutter_make_offer", /'New counteroffer'/g, "v_id"],
      ["declutter_respond_offer", /'New counteroffer'/g, "p_offer_id"],
    ];
    let seen = 0;
    for (const [fn, title, id] of calls) {
      const body = blankSqlComments(newestFunction(fn).body);
      for (const m of body.matchAll(title)) {
        const before = body.slice(0, m.index);
        const notify = before.lastIndexOf("PERFORM public.declutter_notify(");
        const ref = before.lastIndexOf(`PERFORM public.declutter_notice_ref(${id});`);
        expect(ref, `${fn} ${m[0]}`).toBeGreaterThan(-1);
        // The ref line is the statement right before this notice's call (no other notice between them).
        expect(before.slice(ref, notify).match(/declutter_notify\(/g), `${fn} ${m[0]}`).toBeNull();
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(2);
  });

  it("the newest link helper adds &offer= only for this offer's two parties on the member's own bare tab", () => {
    const body = blankSqlComments(newestFunction("declutter_notice_order_link").body).replace(/\s+/g, " ");
    expect(body).toContain("v_offer text := NULLIF(current_setting('declutter.notice_ref', true), '');");
    expect(body).toContain("SELECT CASE WHEN f.seller_id = p_user AND f.buyer_id = p_other THEN 'selling' WHEN f.buyer_id = p_user AND f.seller_id = p_other THEN 'buying' END");
    expect(body).toContain("IF v_offer_tab IS NOT NULL AND p_link = '/declutter?tab=' || v_offer_tab THEN RETURN p_link || '&offer=' || v_offer;");
  });
});
