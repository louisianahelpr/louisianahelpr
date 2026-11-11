/**
 * LEAD-OFFERS-CHOICE (3), owner 2026-10-31: Listing defaults' "Listings already up" row turns offers off or on for
 * every listing that is up, and says how many changed. Audit 11-10 F345: one line says how many listings have offers
 * on; the buttons are "Turn all on" / "Turn all off".
 *
 * @mutate src/components/declutter/DeclutterOffersForAll.tsx |    mutationFn: (on: boolean) => setOffersForAll(items, on), |    mutationFn: async (on: boolean) => ({ changed: 0, failed: 0, on }),
 * @mutate src/components/declutter/DeclutterOffersForAll.tsx |        {toOn > 0 && ( |        {false && (
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ calls: [] as [string, boolean, boolean][] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyItems: async () => [
    { id: "a", status: "live", accepts_offers: true },
    { id: "b", status: "paused", accepts_offers: true },
    { id: "c", status: "live", accepts_offers: false },
    { id: "d", status: "sold", accepts_offers: true },
  ],
  setOfferRules: async (id: string, on: boolean, auto: boolean) => {
    h.calls.push([id, on, auto]);
  },
}));

import { toast } from "sonner";
import { OffersForAllListings } from "./DeclutterOffersForAll";

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OffersForAllListings userId="u1" />
    </QueryClientProvider>,
  );

describe("Turn offers off / on for all my listings", () => {
  it("counts the listings each button changes, and off changes only the listings up that take offers", async () => {
    mount();
    const off = await screen.findByRole("button", { name: "Turn all off" });
    expect(screen.getByRole("button", { name: "Turn all on" })).toBeInTheDocument();
    expect(screen.getByText("Offers are on for 2 of 3 listings.")).toBeInTheDocument();
    fireEvent.click(off);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Offers turned off for 2 listings."));
    expect(h.calls).toEqual([["a", false, false], ["b", false, false]]);
  });
});
