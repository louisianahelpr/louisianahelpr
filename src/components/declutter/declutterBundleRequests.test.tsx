/**
 * Q2268 bundle requests (Board 161): the seller answers one ask with Accept all (null), Pick some (the ticked
 * items) or Decline ([]); the buyer asks for 2+ of one seller's live items and sees what became of each ask.
 *
 * @mutate src/components/declutter/DeclutterBundleRequests.tsx | onClick={() => answer.mutate(null)} | onClick={() => answer.mutate([...pick])}
 * @mutate src/components/declutter/DeclutterBundleRequests.tsx | onClick={() => answer.mutate([])} | onClick={() => answer.mutate(null)}
 * @mutate src/components/declutter/DeclutterBundleRequests.tsx | disabled={pickedItems.length < BUNDLE_MIN_ITEMS \|\| ask.isPending} | disabled={ask.isPending}
 * @mutate src/components/declutter/DeclutterBundleRequests.tsx | return it.status === "live" && it.current_price_cents >= 100; | return it.status === "live";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeclutterItem } from "@/lib/declutter/api";
import type { BundleRequest } from "@/lib/declutter/bundleRequest";

const h = vi.hoisted(() => ({
  rows: [] as BundleRequest[] | null,
  answered: [] as (string[] | null)[],
  asked: [] as string[][],
}));

vi.mock("@/lib/declutter/bundleRequest", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundleRequest")>()),
  fetchBundleRequests: async () => h.rows,
  answerBundle: async (_id: string, ids: string[] | null) => { h.answered.push(ids); return ids === null ? 3 : ids.length; },
  requestBundle: async (ids: string[]) => { h.asked.push(ids); return "r-new"; },
  withdrawBundle: async () => undefined,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { BundleAsk, BundleRequestsSection } from "./DeclutterBundleRequests";

const soon = new Date(Date.now() + 3600_000).toISOString();
const req = (over: Partial<BundleRequest> = {}): BundleRequest => ({
  id: "r1", buyer_id: "b1", seller_id: "s1", status: "open", respond_by: soon, created_at: soon, closed_at: null,
  items: [
    { item_id: "i1", price_cents: 2000, outcome: null, title: "Lamp" },
    { item_id: "i2", price_cents: 1500, outcome: null, title: "Rug" },
    { item_id: "i3", price_cents: 500, outcome: null, title: "Vase" },
  ],
  ...over,
});
const item = (id: string, title: string, cents: number, status = "live") =>
  ({ id, title, seller_id: "s1", status, current_price_cents: cents }) as unknown as DeclutterItem;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Q2268 bundle requests", () => {
  beforeEach(() => { h.rows = []; h.answered = []; h.asked = []; });

  it("the seller's Accept all sends null (every item)", async () => {
    h.rows = [req()];
    wrap(<BundleRequestsSection side="seller" userId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept all" }));
    await waitFor(() => expect(h.answered).toEqual([null]));
  });

  it("Pick some: untick one, Accept 2 picked sends just those two", async () => {
    h.rows = [req()];
    wrap(<BundleRequestsSection side="seller" userId="s1" />);
    const picked = await screen.findByRole("button", { name: "Pick some" });
    expect(picked).toBeDisabled(); // all ticked = Accept all, never a second button for the same thing
    fireEvent.click(screen.getByRole("checkbox", { name: "Vase" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept 2 picked" }));
    await waitFor(() => expect(h.answered).toEqual([["i1", "i2"]]));
  });

  it("Decline sends an empty list", async () => {
    h.rows = [req()];
    wrap(<BundleRequestsSection side="seller" userId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(h.answered).toEqual([[]]));
  });

  it("the buyer reads what became of an answered ask, item by item", async () => {
    h.rows = [req({ status: "answered", items: [
      { item_id: "i1", price_cents: 2000, outcome: "accepted", title: "Lamp" },
      { item_id: "i2", price_cents: 1500, outcome: "unavailable", title: "Rug" },
      { item_id: "i3", price_cents: 500, outcome: "not_picked", title: "Vase" },
    ] })];
    wrap(<BundleRequestsSection side="buyer" userId="b1" />);
    expect(await screen.findByText(/accepted 1 of 3 \(1 sold meanwhile\)\. They are in your cart: pay within 24 hours/)).toBeInTheDocument();
    expect(screen.getByText("In your cart")).toBeInTheDocument();
    expect(screen.getByText("Sold meanwhile")).toBeInTheDocument();
    expect(screen.getByText("Not picked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take it back" })).toBeNull();
  });

  it("nothing shows before the tables are on the server (null read)", async () => {
    h.rows = null;
    const { container } = wrap(<BundleRequestsSection side="seller" userId="s1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-bundle-requests]")).toBeNull();
  });

  it("the buyer's ask needs 2+ priced live items and sends the ticked ones", async () => {
    wrap(<BundleAsk item={item("i1", "Lamp", 2000)} others={[item("i2", "Rug", 1500), item("i4", "Free box", 0), item("i5", "Sold chair", 900, "reserved")]} viewerId="b1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Want several\?/ }));
    expect(screen.queryByRole("checkbox", { name: "Free box" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Sold chair" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pick 2 or more" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Rug" }));
    fireEvent.click(screen.getByRole("button", { name: /Ask for these 2/ }));
    await waitFor(() => expect(h.asked).toEqual([["i1", "i2"]]));
  });

  it("no ask on an item with only free or sold neighbours", async () => {
    const { container } = wrap(<BundleAsk item={item("i1", "Lamp", 2000)} others={[item("i4", "Free box", 0)]} viewerId="b1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-bundle-ask-start]")).toBeNull();
  });
});
