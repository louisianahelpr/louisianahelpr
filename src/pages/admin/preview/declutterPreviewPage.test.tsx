/**
 * Q2585: the admin Declutter stage preview draws the REAL Buying / Selling views on the stage's sample, for every
 * stage on either side, and while it is open nothing reaches the network (the page's own fetch layer answers; the
 * window's fetch underneath is a spy that must stay unused for every Supabase request).
 * The backend's rules are proved request by request in src/test/adminDeclutterPreviewIsInert.test.ts.
 *
 * @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |           : <SellingDash todo={todo} userId={sample.userId} listings={<MyListingsView userId={sample.userId} haulOn />} />} |           : null}
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |   globalThis.fetch = previewFetch; |   void previewFetch;
 * @mutate src/pages/admin/preview/declutterPreviewSamples.ts |     declutter_my_free_pause: null,\n |
 * @mutate src/pages/admin/preview/declutterPreviewSamples.ts |     declutter_payouts: [],\n |
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts |       if (Object.prototype.hasOwnProperty.call(s.reads, name)) { |       if (false) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DECLUTTER_PREVIEW_STAGES } from "./declutterPreviewSamples";
import { declutterPreviewChecks } from "./declutterPreviewBackend";

const ADMIN = "00000000-0000-4000-a000-000000000001";
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: ADMIN }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: ADMIN }, isReady: true }) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

const SUPABASE = "https://unit-test.invalid";
let spy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;
beforeEach(() => {
  spy = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  globalThis.fetch = spy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  declutterPreviewChecks.onUnlisted = undefined;
});

import DeclutterPreviewPage, { isSamePageMove } from "./DeclutterPreviewPage";

function open(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/declutter${search}`]}>
        <Routes><Route path="/admin/preview/declutter" element={<DeclutterPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const supabaseCalls = () => spy.mock.calls.filter(([u]) => String(u instanceof Request ? u.url : u).startsWith(SUPABASE) && !String(u).includes("/auth/v1/"));

describe("Q2585: /admin/preview/declutter", () => {
  it("draws the real Buying view on a paid sample order for the buyer, and the real Selling view for the seller", async () => {
    const a = open("?stage=paid&side=buyer");
    expect(await screen.findByRole("heading", { level: 1, name: /Declutter preview: Paid, pickup not booked, buyer/ })).toBeInTheDocument();
    expect(await screen.findAllByText(/Oak rocking chair \(sample\)/)).not.toHaveLength(0);
    expect(document.querySelector('[data-preview-view="paid:buyer"]')).not.toBeNull();
    a.unmount();
    open("?stage=paid&side=seller");
    await waitFor(() => expect(document.querySelector('[data-preview-view="paid:seller"]')).not.toBeNull());
    expect(await screen.findAllByText(/Oak rocking chair \(sample\)/)).not.toHaveLength(0);
    expect(supabaseCalls()).toEqual([]);
  });

  it("every stage on either side draws without an error screen, answers every read from its sample, and sends nothing", async () => {
    // Audit 1102c P1: a read the sample does not answer drew made-up states (Invalid Date, a crashed Seller delivers).
    const unlisted: string[] = [];
    let drawn = 0;
    for (const { key } of DECLUTTER_PREVIEW_STAGES) {
      for (const side of ["buyer", "seller"]) {
        declutterPreviewChecks.onUnlisted = (what) => unlisted.push(`${key}:${side} ${what}`);
        const r = open(`?stage=${key}&side=${side}`);
        await waitFor(() => expect(document.querySelector(`[data-preview-view="${key}:${side}"]`), `${key}:${side}`).not.toBeNull());
        // Let the views' reads land.
        await new Promise((res) => setTimeout(res, 20));
        expect(screen.queryByText(/Something went wrong/i), `${key}:${side}`).toBeNull();
        expect(document.querySelector("[data-preview-crashed]"), `${key}:${side} crashed`).toBeNull();
        r.unmount();
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(20);
    expect(unlisted).toEqual([]);
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P3 (Q2621): the preview passed todo={null}, so the Selling chips showed no counts and a sale to hand
  // over never came first. The counts come from the sample (declutterTodo), as the real tab's come from the cart.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |           : <SellingDash todo={todo} userId | : <SellingDash todo={null} userId
  it("Q2621: Selling's chips count the sample's sale to hand over, and the sale comes first", async () => {
    open("?stage=paid&side=seller");
    const chip = await waitFor(() => { const el = document.querySelector('[data-status-box="sold"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(chip.textContent).toBe("Hand over · 1");
    // AUD31-4: the sale to hand over is drawn before the listings.
    const sold = await screen.findByRole("region", { name: /Sold: pickup and payout/ });
    const listings = await screen.findByText(/Your listings/);
    expect(sold.compareDocumentPosition(listings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Let the views' last reads land on the preview layer before cleanup puts the real fetch back.
    await new Promise((res) => setTimeout(res, 50));
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P4 (Q2622): the status chips are a search-param change on this page; the inert navigation blocked them
  // ("Preview: this would open ...&status=offers"), so no chip filter could be walked.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | replace: (...a: Opts) => (samePage(a[0]) ? outer.navigator.replace(...a) | replace: (...a: Opts) => (false ? outer.navigator.replace(...a)
  it("Q2622: a status chip filters the preview's own list", async () => {
    open("?stage=paid&side=seller");
    const chip = await waitFor(() => { const el = document.querySelector('[data-status-box="sold"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    chip.click();
    await waitFor(() => expect(document.querySelector('[data-status-box="sold"]')).toHaveAttribute("aria-pressed", "true"));
    // The stage and side stay (the chip changes only ?status=).
    expect(document.querySelector('[data-preview-view="paid:seller"]')).not.toBeNull();
    await new Promise((res) => setTimeout(res, 50));
    expect(supabaseCalls()).toEqual([]);
  });

  // Q2622: only a move on this page goes through; another page (Browse, an item, Home) stays a note.
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |   return !to.pathname \|\| to.pathname === here; |   return true;
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | to.startsWith("?") \|\| to.startsWith("#") \|\| to.split(/[?#]/)[0] === here; | true;
  it("Q2622: only a move on this page goes through", () => {
    const here = "/admin/preview/declutter";
    expect(isSamePageMove("?status=sold", here)).toBe(true);
    expect(isSamePageMove(`${here}?stage=paid&status=sold`, here)).toBe(true);
    expect(isSamePageMove({ pathname: here, search: "?status=offers" }, here)).toBe(true);
    expect(isSamePageMove({ search: "?status=offers" }, here)).toBe(true);
    expect(isSamePageMove("/declutter?tab=selling&status=offers", here)).toBe(false);
    expect(isSamePageMove({ pathname: "/declutter/item/1" }, here)).toBe(false);
    expect(isSamePageMove("/home", here)).toBe(false);
  });

  // Audit 1102c P5 (Q2623): three samples did not match the real flows. Donation: the item was withdrawn with no
  // haul-away row, so nothing about the donation drew (a charity is chosen while the item is live). Ran out: the item
  // was removed, so the seller saw "You haven't listed anything yet" though it goes back up for sale. Problem: only a
  // buyer-reported one could be drawn.
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts | name: "St. Vincent de Paul (sample)", address: "220 St Vincent St, Baton Rouge", parish: "East Baton Rouge", takes: "Furniture, housewares", miles: 3.4, chosen: true }], | }],
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         items: side === "seller" ? [item(sellerId, now)] : [], paidCents: [] }; |         items: [], paidCents: [] };
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts | problems: [{ id: PROBLEM_ID, order_id: ORDER_ID, reporter_side: "seller", reason: "other" }] }, { | problems: [{ id: PROBLEM_ID, order_id: ORDER_ID, reporter_side: "buyer", reason: "other" }] }, {
  it("Q2623: donation, donated, ran out and a seller-reported problem draw as the real flows do", async () => {
    let r = open("?stage=donation&side=seller");
    const picker = await waitFor(() => { const el = document.querySelector("[data-donate-picker]"); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(picker.querySelector('[aria-checked="true"]')?.textContent).toMatch(/St\. Vincent de Paul \(sample\)/);
    r.unmount();
    // Donated: the stage draws. Its receipt does not show yet when the donated item was the seller's only listing:
    // MyListingsView's "You haven't listed anything yet" returns before the haul-away card that holds the receipts (Q2667).
    r = open("?stage=donated&side=seller");
    await waitFor(() => expect(document.querySelector('[data-preview-view="donated:seller"]')).not.toBeNull());
    await new Promise((res) => setTimeout(res, 50));
    r.unmount();
    r = open("?stage=cancelled&side=seller");
    await waitFor(() => expect(document.querySelector('[data-preview-view="cancelled:seller"]')).not.toBeNull());
    await new Promise((res) => setTimeout(res, 50));
    expect(screen.queryByText(/You haven't listed anything yet/)).toBeNull();
    r.unmount();
    expect(DECLUTTER_PREVIEW_STAGES.map((x) => x.key)).toContain("problem_seller");
    r = open("?stage=problem_seller&side=buyer");
    await waitFor(() => expect(document.querySelector('[data-preview-view="problem_seller:buyer"]')).not.toBeNull());
    expect(await screen.findByText(/, reported by the seller\./)).toBeInTheDocument();
    await new Promise((res) => setTimeout(res, 50));
    r.unmount();
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P7 (Q2625), measured 2026-11-02: the controls covered ~40% of a 375 screen and the stage box showed 4 of the stages.
  // They fold to the title row, and a phone picks the stage from one dropdown (chips from sm up).
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |       {open && (\n        <div id="declutter-preview-controls-body" | {true && (\n        <div id="declutter-preview-controls-body"
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | <SelectTrigger aria-label="Order stage"> | <SelectTrigger aria-label="Stage">
  // @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx | className="hidden max-h-28 flex-wrap gap-1.5 overflow-y-auto sm:flex" | className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto"
  it("Q2625: the controls fold away, and at 375 the stage is one dropdown", async () => {
    open("?stage=booked&side=seller");
    const panel = await screen.findByRole("region", { name: "Declutter preview controls" });
    const select = panel.querySelector("[data-preview-stage-select]") as HTMLElement;
    expect(select.className).toContain("sm:hidden");
    expect(within(select).getByRole("combobox", { name: "Order stage" })).toHaveTextContent("Pickup booked");
    expect(within(panel).getByRole("radiogroup", { name: "Order stage" }).className).toMatch(/(^| )hidden( |$).*sm:flex/);
    const fold = within(panel).getByRole("button", { name: "Hide" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(fold);
    expect(panel.querySelector("[data-preview-side]")).toBeNull();
    expect(panel.querySelector("[data-preview-stage-select]")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Show" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(panel).getByRole("button", { name: "Show" }));
    expect(panel.querySelector('[data-preview-side="seller"]')).toHaveAttribute("aria-checked", "true");
    await new Promise((res) => setTimeout(res, 50));
    expect(supabaseCalls()).toEqual([]);
  });

  // Audit 1102c P6 (Q2624): the stages the preview did not offer (offers, a 2-item cart, refund asked and answered,
  // no-show, delivered, review left). Each draws its own state on the real views, nothing sent.
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         awaiting: stage === "offer_countered" ? "buyer" : "seller", | awaiting: "seller",
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         return { ...base, offers: [offer], paidCents: [], items: side === "seller" ? [item(sellerId, now)] : [] }; |         return { ...base, paidCents: [], items: side === "seller" ? [item(sellerId, now)] : [] };
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |             id: REFUND_ID, status: offered ? "offered" : "open", | id: REFUND_ID, status: "open",
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         handovers: { [ORDER_ID]: handover(side, { no_show_reported_at: hoursFrom(now, -1), no_show_answer_by: hoursFrom(now, 23) }) }, |         handovers: { [ORDER_ID]: handover(side) },
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |           proposals_left: 2, delivered_at: hoursFrom(now, -1), delivered_photo_path: "sample/delivered.jpg", | proposals_left: 2, delivered_at: null, delivered_photo_path: null,
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         { declutter_i_reviewed: true, declutter_refund_request_view: noRefundAsked(side, now) }); |         { declutter_i_reviewed: false, declutter_refund_request_view: noRefundAsked(side, now) });
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         { declutter_refund_request_view: noRefundAsked(side, now), declutter_i_reviewed: false }); |         { declutter_i_reviewed: false });
  it("Q2624: the added stages draw their own state", async () => {
    const want: [string, string, RegExp][] = [
      ["offer_open", "buyer", /Waiting on the seller to answer/],
      ["offer_open", "seller", /Next: answer their offer/],
      ["offer_countered", "buyer", /their counter/],
      ["offer_countered", "seller", /Waiting on the buyer to answer/],
      ["offer_accepted", "buyer", /Reserved for you, not paid yet/],
      ["offer_accepted", "seller", /Sold, waiting for the buyer to pay/],
      ["cart_two", "buyer", /One checkout for 2 items/],
      ["refund_asked", "buyer", /You asked for a refund/],
      ["refund_asked", "seller", /Next: answer the refund request/],
      ["refund_offered", "buyer", /You have a refund offer to answer/],
      ["no_show", "seller", /The buyer says you didn't show/],
      ["delivered", "buyer", /Next: tap I got it once you have it/],
      ["delivered", "seller", /Waiting on the buyer to say they have it/],
      ["reviewed", "buyer", /Handed over\. It's yours\./],
    ];
    expect(want.length).toBeGreaterThan(10);
    for (const [key, side, text] of want) {
      expect(DECLUTTER_PREVIEW_STAGES.map((x) => x.key), key).toContain(key);
      const r = open(`?stage=${key}&side=${side}`);
      const view = await waitFor(() => { const el = document.querySelector(`[data-preview-view="${key}:${side}"]`); expect(el).not.toBeNull(); return el as HTMLElement; });
      await waitFor(() => expect(view.textContent, `${key}:${side}`).toMatch(text));
      await new Promise((res) => setTimeout(res, 20));
      r.unmount();
    }
    // Review left: the order's Details say "Review sent." instead of offering the form (declutter_i_reviewed true).
    localStorage.clear();
    const r = open("?stage=reviewed&side=buyer");
    fireEvent.click(await screen.findByRole("button", { name: /^Details/ }));
    expect(await screen.findByText(/^Review sent\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
    await new Promise((res) => setTimeout(res, 20));
    r.unmount();
    // Handed over (no review yet): Details draws (the refund view was null and Details crashed on it) and offers the form.
    localStorage.clear();
    const h = open("?stage=handed_over&side=buyer");
    fireEvent.click(await screen.findByRole("button", { name: /^Details/ }));
    expect(await screen.findByRole("button", { name: "Leave a review" })).toBeInTheDocument();
    expect(document.querySelector("[data-preview-crashed]")).toBeNull();
    await new Promise((res) => setTimeout(res, 20));
    h.unmount();
    expect(supabaseCalls()).toEqual([]);
  }, 30_000);

  // Q2624 rest (Builder 185): the free-claim stages Builder 180 left out: an ask waiting on the giver's pick, the
  // picked asker's no-payment confirm, and a missed free pickup's 30-day pause. Each draws its own state, nothing sent.
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         }, { declutter_free_requests: [ask] }); |         }, { declutter_free_requests: [] });
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts | item(sellerId, now, { price_cents: 0, current_price_cents: 0, | item(sellerId, now, { price_cents: 0, current_price_cents: 4000,
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts | const freeLine = (over: Partial<CartLine>) => line({ price_cents: 0, | const freeLine = (over: Partial<CartLine>) => line({ price_cents: 4000,
  // @mutate src/pages/admin/preview/declutterPreviewSamples.ts |         { declutter_my_free_pause: side === "buyer" ? hoursFrom(now, 24 * 29) : null }); |         {});
  it("Q2624 rest: the free-claim stages draw their own state", async () => {
    const want: [string, string, RegExp][] = [
      ["free_asked", "buyer", /You asked for Oak rocking chair \(sample\)/],
      ["free_asked", "seller", /Requests \(1\)/],
      ["free_picked", "buyer", /Confirm and pick a time/],
      ["free_missed", "buyer", /You can ask for free items again on [A-Z][a-z]+ \d+\./],
    ];
    expect(want.length).toBeGreaterThan(3);
    for (const [key, side, text] of want) {
      expect(DECLUTTER_PREVIEW_STAGES.map((x) => x.key), key).toContain(key);
      const r = open(`?stage=${key}&side=${side}`);
      const view = await waitFor(() => { const el = document.querySelector(`[data-preview-view="${key}:${side}"]`); expect(el).not.toBeNull(); return el as HTMLElement; });
      await waitFor(() => expect(view.textContent, `${key}:${side}`).toMatch(text));
      expect(view.textContent, `${key}:${side}`).not.toMatch(/Invalid Date/);
      await new Promise((res) => setTimeout(res, 20));
      r.unmount();
    }
    expect(supabaseCalls()).toEqual([]);
  }, 30_000);

  it("the controls name every stage and both sides", async () => {
    open("?stage=booked&side=seller");
    await screen.findByRole("region", { name: "Declutter preview controls" });
    expect(document.querySelectorAll("[data-preview-stage]").length).toBe(DECLUTTER_PREVIEW_STAGES.length);
    expect(document.querySelector('[data-preview-stage="booked"]')).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector('[data-preview-side="seller"]')).toHaveAttribute("aria-checked", "true");
  });
});
