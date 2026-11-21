/**
 * Audit 11-20 night #11: the Buying tab shows its bones while the orders read
 * loads and an error with a retry when it fails (it was blank in both cases).
 *
 * @mutate src/components/declutter/DeclutterBuyingViews.tsx | if (trk.failed) { | if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const trk = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const EMPTY = { ready: false, views: new Map(), checkouts: 0, ended: [], counts: { needs_you: 0, in_progress: 0, done: 0, cancelled: 0 }, live: [], bookings: undefined, pickupsSettled: true };

vi.mock("./BuyingOrders", () => ({ useBuyingTracker: () => trk.value, bucketChips: () => [], EndedLine: () => null }));
vi.mock("./DeclutterTradeViews", () => ({ CartView: () => null, OffersSection: () => null, PaidOrders: () => null, SectionHeading: () => null }));
vi.mock("./DeclutterPickupDayCard", () => ({ PickupDayCard: () => null }));
vi.mock("./DeclutterSkeletons", () => ({ DeclutterTabBones: () => <p>bones</p> }));
vi.mock("./DeclutterPaySettling", () => ({ usePaySettling: () => ({ settling: false }) }));
vi.mock("./DeclutterFreeClaim", () => ({ FreePauseLine: () => null, MyFreeAsks: () => null, useMyFreeAsks: () => ({ data: [] }) }));
vi.mock("./DeclutterWatching", () => ({ WatchingList: () => <p>saved</p> }));
vi.mock("./DeclutterBundleRequests", () => ({ BundleRequestsSection: () => null }));
vi.mock("./DeclutterTradeOffers", () => ({ TradeOffersSection: () => null }));
vi.mock("./useMyTrades", () => ({ useMyTrades: () => ({ isLoading: false, data: [] }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyOffers: async () => [] }));

import { BuyingDash } from "./DeclutterBuyingViews";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><BuyingDash todo={null} /></QueryClientProvider></MemoryRouter>);
}

describe("Buying tab: loading and failed orders read", () => {
  beforeEach(() => { trk.value = { ...EMPTY }; });

  it("shows the bones while the read loads", () => {
    trk.value = { ...EMPTY, loading: true };
    show();
    expect(screen.getByText("bones")).toBeTruthy();
  });

  it("shows an error and a retry that reads again when the read fails", () => {
    const retry = vi.fn();
    trk.value = { ...EMPTY, failed: true, error: new Error("network"), retry };
    show();
    expect(screen.getByText("We couldn't load your orders.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
