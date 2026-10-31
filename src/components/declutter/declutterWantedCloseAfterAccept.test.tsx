/**
 * BUY-29 (buying audit 10-30 #29; lead decision 10-31 04:55): after the buyer accepted a seller's reply to their Wanted
 * post, the post stayed open and kept matching. The owner prefers asking over silent changes, so the card asks "Close
 * your Wanted post?" right after the accept; "Close it" calls declutter_close_wanted with the post's id, "Keep it open"
 * leaves it. The id comes only on the poster's own row while the post is open (open_wanted_id, 20261031095146; PGlite:
 * src/test/pglite/declutterMyOffersOpenWantedId.pglite.mjs).
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |       if (res === "accepted" && wantedId) setAskClose(true); |       if (false) setAskClose(true);
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | onConfirm={() => close.mutate(wantedId)} | onConfirm={() => setAskClose(false)}
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   const wantedId = o.my_side === "buyer" ? o.open_wanted_id ?? null : null; |   const wantedId = o.open_wanted_id ?? null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  offers: [] as Record<string, unknown>[],
  closed: [] as string[],
  answer: "accepted",
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("@/lib/declutter/api", () => ({
  fetchItemHandovers: async () => null,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => [],
  respondOffer: async () => state.answer,
}));
vi.mock("@/lib/declutter/wanted", () => ({
  closeWanted: async (id: string) => { state.closed.push(id); return "closed"; },
}));

import { toast } from "sonner";
import { OffersSection } from "./DeclutterOffersSection";

const W = "b0000000-0000-4000-8000-000000000001";
const REPLY = {
  offer_id: "o4", item_id: "i1", item_title: "Blue enamel mug", my_side: "buyer", amount_cents: 1200, awaiting: "buyer",
  status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 1, current_price_cents: 1500,
  floor_price_cents: null, updated_at: "2026-10-31", from_wanted: true, open_wanted_id: W,
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><OffersSection side="buyer" /></MemoryRouter></QueryClientProvider>);
}

async function accept() {
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  const sheet = await waitFor(() => {
    const s = document.querySelector<HTMLElement>('[data-confirm-sheet="accept-offer"]');
    expect(s).not.toBeNull();
    return s!;
  });
  fireEvent.click(within(sheet).getByRole("button", { name: "Accept" }));
}

const askSheet = () => document.querySelector<HTMLElement>('[data-confirm-sheet="close-wanted-after-accept"]');

describe("BUY-29: accepting a reply to your Wanted post asks whether to close the post", () => {
  beforeEach(() => { state.offers = []; state.closed = []; state.answer = "accepted"; });

  it("after the accept: 'Close your Wanted post?'; Close it closes that post", async () => {
    state.offers = [REPLY];
    show();
    await accept();
    const sheet = await waitFor(() => { expect(askSheet()).not.toBeNull(); return askSheet()!; });
    expect(sheet.textContent).toContain("Close your Wanted post?");
    expect(sheet.textContent).toContain("Blue enamel mug");
    fireEvent.click(within(sheet).getByRole("button", { name: "Close it" }));
    await waitFor(() => expect(state.closed).toEqual([W]));
  });

  it("Keep it open leaves the post alone", async () => {
    state.offers = [REPLY];
    show();
    await accept();
    const sheet = await waitFor(() => { expect(askSheet()).not.toBeNull(); return askSheet()!; });
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep it open" }));
    // The ask was on screen just above; it goes, and nothing was closed (a positive check: not a first-paint wait).
    await waitFor(() => { expect(askSheet()).toBeNull(); expect(state.closed).toEqual([]); });
    expect(state.closed).toEqual([]);
  });

  it("never asked: an ordinary counter, a reply whose post is already closed, a seller's row, or an answer that is not an accept", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...REPLY, from_wanted: false, open_wanted_id: null }, "accepted"],
      [{ ...REPLY, open_wanted_id: null }, "accepted"],
      [{ ...REPLY, my_side: "seller", awaiting: "seller", floor_price_cents: 1000 }, "accepted"],
      [REPLY, "declined"],
    ];
    expect(cases.length).toBeGreaterThan(3);
    for (const [row, answer] of cases) {
      document.body.innerHTML = "";
      vi.mocked(toast).mockClear();
      state.offers = [row];
      state.answer = answer;
      if (row.my_side === "seller") {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={qc}><MemoryRouter><OffersSection side="seller" /></MemoryRouter></QueryClientProvider>);
      } else show();
      await accept();
      // Wait for the answer to land (its toast), not for an empty screen: onSuccess has then run, ask or no ask.
      await waitFor(() => { expect(document.querySelector('[data-confirm-sheet="accept-offer"]')).toBeNull(); expect(toast).toHaveBeenCalled(); });
      expect(askSheet()).toBeNull();
    }
    expect(state.closed).toEqual([]);
  });
});
