/**
 * Audit #35 (Declutter deep audit, 2026-10-28): "I can deliver" showed every
 * field before it was switched on, and Save stayed disabled with no reason.
 * Now: off shows only the switch and one line, and saving off saves only
 * that (with a price the server accepts, since declutter_set_seller_delivery
 * checks it even when off); on shows the fields, and while something is
 * missing a line beside Save says what.
 *
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |       {enabled ? ( |       {true ? (
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |       {missing && <p className="text-xs text-destructive-ink" role="status" data-sd-missing="">{missing}</p>} |
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |   const canSave = !enabled \|\| formOk; |   const canSave = formOk;
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |     return { rate: rules.free_rate_cents, freeOver: null }; |     return { rate: rateCents, freeOver: null };
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MySellerDelivery } from "@/lib/declutter/sellerDelivery";

const state = { mine: null as MySellerDelivery | null, saves: [] as unknown[][], schedules: 0 };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("./DeclutterPickupTimes", () => ({ PickupTimesEditor: () => <div data-testid="times-editor" /> }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchMySellerDelivery: async () => state.mine,
  saveDeliverySchedule: async () => { state.schedules++; return state.mine; },
  saveSellerDelivery: async (...a: unknown[]) => { state.saves.push(a); return { ...state.mine!, enabled: a[0] as boolean }; },
}));

import { SellerDeliveryCard } from "./SellerDeliverySettings";
import { SELLER_DELIVERY_RULES } from "@/lib/declutter/sellerDelivery";

const fresh = (over: Partial<MySellerDelivery> = {}): MySellerDelivery => ({
  enabled: false, rate_cents: null, free_over_cents: null, radius_miles: 10, windows: [], days_off: [], items_off: [], rules: SELLER_DELIVERY_RULES, ...over,
});

async function openCard() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SellerDeliveryCard /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /I can deliver/ }));
}

beforeEach(() => {
  state.mine = fresh();
  state.saves = [];
  state.schedules = 0;
});

describe("I can deliver (audit #35)", () => {
  it("off: no price, distance or times; Save is enabled and saves only 'off', with a price the server accepts", async () => {
    await openCard();
    expect(await screen.findByText(/Turn it on to set your price/)).toBeInTheDocument();
    expect(screen.queryByText("Your delivery price, per order")).toBeNull();
    expect(screen.queryByTestId("times-editor")).toBeNull();
    const save = screen.getByRole("button", { name: "Save delivery" });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(state.saves).toEqual([[false, 0, 10, null]]));
    expect(state.schedules).toBe(0);
  });

  it("turning it off keeps the price already saved", async () => {
    state.mine = fresh({ enabled: true, rate_cents: 2000, free_over_cents: 5000 });
    await openCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Offer delivery to buyers" }));
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(state.saves).toEqual([[false, 2000, 10, 5000]]));
  });

  it("on: the fields appear, and while the price is missing or wrong a line beside Save says so", async () => {
    await openCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Offer delivery to buyers" }));
    expect(screen.getByText("Your delivery price, per order")).toBeInTheDocument();
    expect(screen.getByTestId("times-editor")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save delivery" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Enter your delivery price to save, or choose Free.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Delivery price in dollars"), { target: { value: "3" } });
    expect(screen.getByText("Your delivery price must be whole dollars, $5 to $150.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Delivery price in dollars"), { target: { value: "20" } });
    expect(document.querySelector("[data-sd-missing]")).toBeNull();
    expect(save).not.toBeDisabled();
  });
});
