/**
 * #3889: when the item page's pickup places read failed, ItemHandoverTimes mounted ItemPickupPlaces to say so, and
 * its own useQuery refetched on mount. That put the query back to pending (no data yet), which unmounted it; the next
 * failure mounted it again. An endless request loop: 44,033 refused requests in one test run, until the worker died.
 * A failed read now asks once (no retry here) and shows the error with its Retry button; Retry asks once more.
 * @mutate src/components/declutter/SellPorchPlaces.tsx | queryFn: () => fetchItemPickupPlaces(itemId), retryOnMount: false }); | queryFn: () => fetchItemPickupPlaces(itemId) });
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { calls: 0 };

vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()),
  fetchItemPickupPlaces: async () => {
    state.calls += 1;
    throw new Error("network down");
  },
}));
vi.mock("./DeclutterPickupWindows", () => ({ ItemPickupTimes: () => null }));

import { ItemHandoverTimes } from "./ItemHandoverTimes";

describe("#3889: a failed item places read is asked once, not in a loop", () => {
  it("one request, the error with Retry; Retry asks once more", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ItemHandoverTimes itemId="i1" handovers={["porch"]} /></QueryClientProvider>);
    expect(await screen.findByText("We couldn't load the pickup places.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(state.calls).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("We couldn't load the pickup places.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(state.calls).toBeGreaterThan(1);
    expect(state.calls).toBeLessThan(4);
  });
});
