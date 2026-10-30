/**
 * Board 117 / Q2267: "Wanted near you" and "I have this". A post shows First L., "Up to" in money ink and whole
 * miles, never an address; one you answered says so. The sheet answers with one of YOUR live listings, the price
 * starts at the lower of their Wanted price and your listing's price, can't go over it, and says you keep the
 * whole price. No pronouns.
 *
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |   const tooHigh = cents !== null && limit !== null && cents > limit; |   const tooHigh = false;
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     if (post && it) setPrice(String(Math.min(post.max_price_cents, it.current_price_cents) / 100)); |     if (post && it) setPrice(String(it.current_price_cents / 100));
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     mutationFn: () => replyToWanted(post!.id, itemId!, cents!), |     mutationFn: () => replyToWanted(post!.id, itemId!, limit!),
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |             {w.replied ? ( |             {false ? (
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |                 <Link to={quickListHref(post)}> |                 <Link to="/declutter/sell">
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |               <div className="min-w-0 space-y-2"> |               <div className="space-y-2">
 *
 * Audit W1 (the sheet slid sideways on WebKit): the listings are the shared RadioCardList inside a min-w-0 box.
 * Quick-list (owner 2026-10-30): "List it now" opens the shared sell flow with the post to answer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  near: [] as unknown[],
  listings: [] as { id: string; title: string; current_price_cents: number }[],
  sent: [] as unknown[][],
};
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/wanted", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/wanted")>()),
  fetchWantedNear: async () => state.near,
  fetchMyReplyListings: async () => state.listings,
  replyToWanted: async (...a: unknown[]) => { state.sent.push(a); return "o1"; },
}));

import { WantedNearSection } from "./DeclutterWantedReplies";

const POST = { id: "w1", what: "Kids bike, 16 inch", category: "baby_kids", max_price_cents: 3000, poster_name: "Lexi L.", miles: 4, expires_at: "2026-11-20", replied: false };

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><WantedNearSection at={{ lat: 30, lng: -92 }} userId="s1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.near = [POST, { ...POST, id: "w2", what: "Crib", replied: true }];
  state.listings = [{ id: "i1", title: "Blue kids bike", current_price_cents: 4000 }, { id: "i2", title: "Trike", current_price_cents: 2000 }];
  state.sent = [];
});

describe("board 117: Wanted near you and I have this", () => {
  it("lists posts with First L., money-ink 'Up to' and miles; an answered one says so", async () => {
    renderIt();
    expect(await screen.findByRole("heading", { name: "Wanted near you" })).toBeInTheDocument();
    // The heading stands from the start now (the hub, owner 2026-10-30); the rows arrive with the answer.
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0].textContent).toContain("Up to $30 · Lexi L. · 4 mi");
    expect(within(rows[0]).getByText("$30").className).toContain("--burnt-sienna");
    expect(within(rows[1]).getByText("Answered")).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("button", { name: "I have this" })).toBeNull();
  });

  it("answers with your listing at the lower of the two prices, never above it, and you keep the whole price", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Kids bike, 16 inch")).toBeInTheDocument();
    // W1: the shared radio cards, in a box that can shrink below its content (min-w-0), so a long title wraps.
    const card = await within(sheet).findByRole("radio", { name: /Blue kids bike/ });
    expect(card.closest("[role=radiogroup]")?.parentElement?.className).toContain("min-w-0");
    expect(within(sheet).getByRole("link", { name: "List something new for this" })).toHaveAttribute("href", "/declutter/sell?answer=w1&max=3000&what=Kids+bike%2C+16+inch");
    fireEvent.click(card);
    const price = within(sheet).getByLabelText("Your price");
    expect(price).toHaveValue("30");
    expect(within(sheet).getByText(/You keep the whole/).textContent).toBe("You keep the whole $30. If Lexi accepts, Lexi pays and you're paid after the handover.");
    expect(sheet.textContent).not.toMatch(/\b(he|she|his|her)\b/);
    fireEvent.change(price, { target: { value: "31" } });
    expect(within(sheet).getByRole("alert").textContent).toContain("Up to $30, the lower of their Wanted price and your listing's price.");
    expect(within(sheet).getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(price, { target: { value: "25" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send to Lexi · $25" }));
    await waitFor(() => expect(state.sent).toEqual([["w1", "i1", 2500]]));
  });

  it("no listing that can answer: List it now opens the sell flow with this post to answer", async () => {
    state.listings = [];
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    expect(await screen.findByRole("link", { name: "List it now" })).toHaveAttribute("href", "/declutter/sell?answer=w1&max=3000&what=Kids+bike%2C+16+inch");
    expect(screen.getByText(/it answers Lexi as soon as it's live/)).toBeInTheDocument();
  });

  // Owner 2026-10-30: the Wanted tab is a hub, so "Wanted near you" always stands and says when it has nothing.
  it("nothing near you: the section says so, with no I have this", async () => {
    state.near = [];
    renderIt();
    expect(await screen.findByText(/No one near you has posted a Wanted yet/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wanted near you" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I have this" })).toBeNull();
  });
});
