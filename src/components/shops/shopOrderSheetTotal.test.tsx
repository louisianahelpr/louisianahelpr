/**
 * Shops audit 11-08 #8: the order sheet's total matched the card charge only for members who had paid the one-time
 * account setup fee. shop-checkout adds that fee as its own line (20261105181603 B), so the sheet now shows it when it
 * is owed and calls the sum "Total before tax" (tax is added at checkout). Declutter's BuyerTotal rule, same hook.
 *
 * @mutate src/components/shops/ShopOrderSheet.tsx |   const setupFeeCents = itemsCents > 0 ? setupFeeOwed : 0; |   const setupFeeCents = 0;
 * @mutate src/components/shops/ShopOrderSheet.tsx | <dt>Total before tax</dt> | <dt>Total</dt>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("2026-10-21")}>day 2026-10-21</button>
  ),
}));
const fee = vi.hoisted(() => ({ cents: 200, known: true }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => fee.cents, useFirstPayoutFeeKnown: () => fee.known }));
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({ fetchOrderTerms: vi.fn(), requestOrder: vi.fn() }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), fetchItemOptions: async () => new Map() }));
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), fetchItemPreorders: async () => new Map() }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), fetchHandoverMode: async () => "in_person" }));
vi.mock("@/lib/shops/delivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/delivery")>()),
  fetchDeliveryOffer: async () => ({ delivers: false, fee_cents: 0, radius_miles: 0 }),
}));

import ShopOrderSheet from "./ShopOrderSheet";

const ITEM = {
  id: "p1", kind: "made", subtype: "candles", status: "live", title: "Fig candle", description: "", price_cents: 2000,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [],
} as unknown as ShopItem;
const TERMS: OrderTerms = {
  cancel_policy: "until_accept", paused: false, open_weekdays: [2, 3, 4, 5, 6], daily_order_cap: null,
  today: "2026-10-19", last_day: "2027-01-17", full_days: [],
};

async function pick() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ShopOrderSheet shopId="s1" /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "One more Fig candle" }));
  fireEvent.click(screen.getByText("day 2026-10-21"));
}

beforeEach(() => {
  fee.cents = 200;
  fee.known = true;
  items.fetchShopItems.mockResolvedValue([ITEM]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
});

describe("the order sheet's total", () => {
  it("a first-time buyer sees the setup fee and a total that matches the card before tax", async () => {
    await pick();
    expect(screen.getByTestId("shop-order-setup-fee").textContent).toBe("$2.00");
    // $20 + fee $1.70 + setup $2 = $23.70.
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$23.70");
    expect(screen.getByText("Total before tax")).toBeTruthy();
  });

  it("a buyer who already paid it sees no fee line", async () => {
    fee.cents = 0;
    await pick();
    expect(screen.queryByTestId("shop-order-setup-fee")).toBeNull();
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$21.70");
  });

  it("while the answer loads, the sheet says the fee may be added", async () => {
    fee.cents = 0;
    fee.known = false;
    await pick();
    expect(screen.getByTestId("shop-order-fee-words").textContent).toBe("Includes a small Louisiana Helpr service fee. Sales tax and any one-time setup fee are added at checkout.");
  });
});
