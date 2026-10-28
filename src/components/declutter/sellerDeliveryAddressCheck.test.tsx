/**
 * Deep audit 2026-10-28 D-1 (#13): the seller-delivery address check returned 503 geocode_unavailable; the screen
 * only ever said "Checking…" (the error was a passing toast) and checkout still went through on a time picked
 * before. Now a failed check says what went wrong UNDER the field (role="alert", tied to the input), clears the
 * picked time and hides the times, so Pay (sdReady needs a time) stays off until the address checks out or is
 * changed.
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onError: (err) => setFailed(sellerDeliveryErrorMessage(err)), |     onError: () => undefined,
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onMutate: () => { setFailed(null); onSlot(null); }, |     onMutate: () => { setFailed(null); },
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |       {state === "pick" && shownDay && !failed && ( |       {state === "pick" && shownDay && (
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx | onChange={(e) => { setAddress(e.target.value); setFailed(null); }} | onChange={(e) => { setAddress(e.target.value); }}
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SellerDeliveryOffer } from "@/lib/declutter/sellerDelivery";

const state = { fail: true };
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  quoteSellerDelivery: async () => {
    if (state.fail) throw new Error("geocode_unavailable");
    return OFFER;
  },
}));

import { SellerDeliveryPicker } from "./SellerDeliveryChoice";

const SLOT = "2026-11-03T15:00:00.000Z";
const OFFER: SellerDeliveryOffer = {
  available: true, reason: null, rate_cents: 0, base_rate_cents: 0, free_over_cents: null, items_cents: 4000,
  radius_miles: 10, dropoff_area: "Mid City, Baton Rouge", slot_minutes: 60, slots: [SLOT], held_slot: null,
};

function show(onSlot: (s: string | null) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SellerDeliveryPicker sellerId="s1" offer={OFFER} state="pick" slot={SLOT} onSlot={onSlot} onOffer={() => undefined}
        handoff="leave" onHandoff={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("a failed delivery address check is said, and never lets checkout through (#13)", () => {
  it("503 geocode_unavailable: the words under the field, the picked time cleared, the times hidden until the address changes", async () => {
    state.fail = true;
    const onSlot = vi.fn();
    show(onSlot);
    expect(screen.getByRole("radiogroup", { name: "Delivery time" })).toBeInTheDocument();
    const input = screen.getByLabelText(/Deliver to/);
    fireEvent.change(input, { target: { value: "123 Nowhere St, Baton Rouge" } });
    onSlot.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't look up addresses just now. Try again in a minute.");
    expect(alert).toHaveTextContent("Delivery can't be booked until the address checks out.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    // The last word on the slot is "none": Pay needs a time, so it stays off.
    await waitFor(() => expect(onSlot).toHaveBeenLastCalledWith(null));
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check" })).toBeEnabled();
    // Changing the address takes the warning away and offers the times again.
    fireEvent.change(input, { target: { value: "125 Nowhere St, Baton Rouge" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Delivery time" })).toBeInTheDocument();
  });

  it("a check that works shows no warning", async () => {
    state.fail = false;
    const onSlot = vi.fn();
    show(onSlot);
    fireEvent.change(screen.getByLabelText(/Deliver to/), { target: { value: "123 Main St, Baton Rouge" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("The seller sees your address only after you pay.")).toBeInTheDocument();
  });
});
