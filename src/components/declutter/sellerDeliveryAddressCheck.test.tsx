/**
 * Deep audit 2026-10-28 D-1 (#13): the seller-delivery address check returned 503 geocode_unavailable; the screen
 * only ever said "Checking…" (the error was a passing toast) and checkout still went through on a time picked
 * before. Now a failed check says what went wrong UNDER the field (role="alert", tied to the input), clears the
 * picked time and hides the times, so Pay (sdReady needs a time) stays off until the address checks out or is
 * changed. DB-9 (2026-10-30): the times show only for an address checked in this checkout (`checked`), so a
 * failed check hides them by taking the checked address back (onMutate), and editing the address no longer
 * brings them back: a check that works does.
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onError: (err) => setFailed(sellerDeliveryErrorMessage(err)), |     onError: () => undefined,
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onMutate: () => { setFailed(null); onSlot(null); onChecked(null); }, |     onMutate: () => { setFailed(null); onChecked(null); },
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onMutate: () => { setFailed(null); onSlot(null); onChecked(null); }, |     onMutate: () => { setFailed(null); onSlot(null); },
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx | onTyped={(typed) => { setAddress(typed); onTyped?.(typed); setFailed(null); if (checked | onTyped={(typed) => { setAddress(typed); onTyped?.(typed); if (checked
 * The box itself (not its wrapper) carries aria-invalid and the alert's id, so a screen reader hears the failure.
 * @mutate src/components/postjob/AddressAutocomplete.tsx |         aria-invalid={invalid ? true : undefined}\n |
 * @mutate src/components/postjob/AddressAutocomplete.tsx |         aria-describedby={describedBy}\n |
 * BUY-9 (buying audit 10-30 #9): switching between Seller delivers and Helpr delivery showed an empty Deliver to box
 * again. Both boxes now carry what the buyer typed in this checkout (it still has to be checked / priced).
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |   const [address, setAddress] = useState(checked ?? typed); |   const [address, setAddress] = useState(checked ?? "");
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx | onTyped={(typed) => { setAddress(typed); onTyped?.(typed); | onTyped={(typed) => { setAddress(typed);
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |           typed={address} onTyped={(a) => { setAddressTouched(true); setAddress(a); setQuote(null); }} |
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SellerDeliveryOffer } from "@/lib/declutter/sellerDelivery";

const state = { fail: true };
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
// The Deliver to box is the shared address search; with Apple search off it takes a typed address (no token fetch).
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "error" }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  quoteSellerDelivery: async () => {
    if (state.fail) throw new Error("geocode_unavailable");
    return OFFER;
  },
}));

import { SellerDeliveryPicker } from "./SellerDeliveryChoice";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const SLOT = "2026-11-03T15:00:00.000Z";
const OFFER: SellerDeliveryOffer = {
  available: true, reason: null, rate_cents: 0, base_rate_cents: 0, free_over_cents: null, items_cents: 4000,
  radius_miles: 10, dropoff_area: "Mid City, Baton Rouge", slot_minutes: 60, slots: [SLOT], held_slot: null,
};

/** The checkout holds the checked address (DB-9); this one starts with an address already checked here. */
function Picker({ onSlot }: { onSlot: (s: string | null) => void }) {
  const [checked, setChecked] = useState<string | null>("1 Old St, Baton Rouge");
  return (
    <SellerDeliveryPicker sellerId="s1" offer={OFFER} state="pick" slot={SLOT} onSlot={onSlot} onOffer={() => undefined}
      handoff="leave" onHandoff={() => undefined} checked={checked} onChecked={setChecked} />
  );
}

function show(onSlot: (s: string | null) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Picker onSlot={onSlot} />
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
    // Changing the address takes the warning away; the times come back only once that address checks out (DB-9).
    fireEvent.change(input, { target: { value: "125 Nowhere St, Baton Rouge" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
    state.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("radiogroup", { name: "Delivery time" })).toBeInTheDocument();
    expect(document.querySelector("[data-sd-deliver-to]")).toHaveTextContent("Delivering to 125 Nowhere St, Baton Rouge.");
  });

  it("a check that works shows no warning; checking the same address again and failing hides the times", async () => {
    state.fail = false;
    const onSlot = vi.fn();
    show(onSlot);
    fireEvent.change(screen.getByLabelText(/Deliver to/), { target: { value: "123 Main St, Baton Rouge" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-sd-deliver-to]")).toHaveTextContent("Delivering to 123 Main St, Baton Rouge. The seller sees this address only after you pay.");
    expect(screen.getByRole("radiogroup", { name: "Delivery time" })).toBeInTheDocument();
    // Check again without editing, and the lookup fails: the address is no longer checked, so the times go.
    state.fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
  });
});

describe("BUY-9: the Deliver to address is typed once per checkout", () => {
  it("the seller-delivery box opens with what was typed in the Helpr box, and reports its own typing back", () => {
    const onTyped = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SellerDeliveryPicker sellerId="s1" offer={OFFER} state="address" slot={null} onSlot={() => undefined} onOffer={() => undefined}
          handoff={null} onHandoff={() => undefined} checked={null} onChecked={() => undefined} typed="9 Elm St, Lafayette" onTyped={onTyped} />
      </QueryClientProvider>,
    );
    const box = screen.getByLabelText(/Deliver to/) as HTMLInputElement;
    expect(box.value).toBe("9 Elm St, Lafayette");
    fireEvent.change(box, { target: { value: "12 Oak St, Lafayette" } });
    expect(onTyped).toHaveBeenLastCalledWith("12 Oak St, Lafayette");
  });

  it("the cart hands the one typed address to the seller-delivery box and takes its typing back (source)", () => {
    const cart = blankComments(readFileSync(resolve(__dirname, "DeclutterTradeViews.tsx"), "utf8"));
    expect(cart).toContain("typed={address} onTyped={(a) => { setAddressTouched(true); setAddress(a); setQuote(null); }}");
  });
});
