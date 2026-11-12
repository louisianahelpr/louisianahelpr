/**
 * Shops variants (owner 11-05, answer 4; 20261106165310), the two screens:
 *
 *  1. The order sheet: an item with option lists shows one dropdown per list; the picked combination's own price is
 *     shown and totalled; a sold-out combination has no stepper; two combinations of one item go in one order, and
 *     each line sent names its variant_id (the server prices it again).
 *  2. The owner's Options section: the combinations of the lists are listed, each with a price (the item's price to
 *     start), a stock and on/off, and Save sends the lists and every combination.
 *
 * @mutate src/components/shops/ShopOrderSheet.tsx |         lines: chosen.map((l) => (l.variantId ? { item_id: l.item.id, variant_id: l.variantId, quantity: l.n } : { item_id: l.item.id, quantity: l.n })), |         lines: chosen.map((l) => ({ item_id: l.item.id, quantity: l.n })),
 * @mutate src/components/shops/ShopOrderSheet.tsx |       .map((v) => ({ item: i, variantId: v.id as string \| null, unit: v.price_cents, n: qty[lineKey(i.id, v.id)] })); |       .map((v) => ({ item: i, variantId: v.id as string \| null, unit: i.price_cents, n: qty[lineKey(i.id, v.id)] }));
 * @mutate src/components/shops/ShopOrderOptions.tsx |         {variant && inStock && ( |         {variant && (
 * @mutate src/components/shops/ShopProfile.tsx | {withOptions?.has(item.id) ? `From ${formatItemPrice(item.price_cents)}` : formatItemPrice(item.price_cents)} | {formatItemPrice(item.price_cents)}
 * @mutate src/components/shops/ShopItemsList.tsx | withOptions={options.data} preorders={preorders.data} onOrder= | preorders={preorders.data} onOrder=
 * @mutate src/components/shops/ShopItemOptionsEditor.tsx |       if (held) toast( |       if (false) toast(
 * @mutate src/lib/shops/variants.ts |   return (data as { held_for_review?: boolean } \| null)?.held_for_review === true; |   return false;
 * @mutate src/components/shops/ShopItemOptionsEditor.tsx |     rows[variantLabel(values)] ?? { price: String(basePriceCents / 100), stock: "", active: true }; |     rows[variantLabel(values)] ?? { price: "", stock: "", active: true };
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopItem } from "@/lib/shops/items";
import type { OrderTerms } from "@/lib/shops/orders";
import type { ShopItemOptions } from "@/lib/shops/variants";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
// toast() itself renders (src/lib/toastPolicy.ts makes toast.success / toast.info no-ops), so the mock is callable.
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("2026-10-21")}>day 2026-10-21</button>
  ),
}));
const ext = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string, _onReturn?: () => void) => undefined) }));
vi.mock("@/lib/openExternalUrl", () => ext);
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
const orders = vi.hoisted(() => ({ fetchOrderTerms: vi.fn(), requestOrder: vi.fn() }));
vi.mock("@/lib/shops/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/orders")>()), ...orders }));
const variants = vi.hoisted(() => ({ fetchItemOptions: vi.fn(), saveItemOptions: vi.fn() }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), ...variants }));
// Preorders (20261108184654): none here (shopOrderScreens.test.tsx covers them).
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), fetchItemPreorders: async () => new Map() }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), fetchHandoverMode: async () => "in_person" }));

import ShopOrderSheet from "./ShopOrderSheet";
import ShopItemsList from "./ShopItemsList";
import ShopItemOptionsEditor, { splitChoices } from "./ShopItemOptionsEditor";

const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "i1", kind: "made", subtype: "candles", status: "live", title: "Candle", description: "", price_cents: 1000,
  lead_time_days: 0, stock_count: null, home_kitchen: false, photos: [], ...over,
});
const TERMS: OrderTerms = {
  cancel_policy: "until_accept", paused: false, open_weekdays: [2, 3, 4, 5, 6], daily_order_cap: null,
  today: "2026-10-19", last_day: "2027-01-17", full_days: [],
};
const OPTIONS: ShopItemOptions = {
  item_id: "c1",
  option_names: ["Size", "Scent"],
  variants: [
    { id: "v-sf", values: ["Small", "Fig"], price_cents: 1500, stock_count: 3, active: true },
    { id: "v-sv", values: ["Small", "Vanilla"], price_cents: 1600, stock_count: null, active: true },
    { id: "v-lf", values: ["Large", "Fig"], price_cents: 2400, stock_count: 0, active: true },
    { id: "v-lv", values: ["Large", "Vanilla"], price_cents: 2600, stock_count: 5, active: true },
  ],
};

function renderIt(el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  items.fetchShopItems.mockResolvedValue([item({ id: "c1", title: "Soy candle", price_cents: 1500, stock_count: 8 }), item({ id: "p1", title: "Plain mug", price_cents: 1200 })]);
  orders.fetchOrderTerms.mockResolvedValue(TERMS);
  orders.requestOrder.mockResolvedValue("https://checkout.stripe.com/c/pay/test");
  variants.fetchItemOptions.mockResolvedValue(new Map([["c1", OPTIONS]]));
  variants.saveItemOptions.mockResolvedValue(undefined);
});

describe("the order sheet with option lists", () => {
  it("prices the picked combination, hides a sold-out one, and sends each line's variant", async () => {
    renderIt(<ShopOrderSheet shopId="s1" />);
    const size = (await screen.findByRole("combobox", { name: "Size for Soy candle" })) as HTMLSelectElement;
    const scent = screen.getByRole("combobox", { name: "Scent for Soy candle" }) as HTMLSelectElement;
    expect([...size.options].map((o) => o.value)).toEqual(["Small", "Large"]);
    expect(screen.getByText("$15 each")).toBeTruthy();

    // Two Small / Fig.
    fireEvent.click(screen.getByRole("button", { name: "One more Soy candle (Small / Fig)" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Soy candle (Small / Fig)" }));
    // Large / Fig is sold out: no stepper.
    fireEvent.change(size, { target: { value: "Large" } });
    expect(screen.getByText("Sold out.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "One more Soy candle (Large / Fig)" })).toBeNull();
    expect(screen.getByText("Also in this order: Small / Fig × 2")).toBeTruthy();
    // One Large / Vanilla at its own price.
    fireEvent.change(scent, { target: { value: "Vanilla" } });
    expect(screen.getByText("$26 each")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "One more Soy candle (Large / Vanilla)" }));
    // A plain item still orders as before.
    fireEvent.click(screen.getByRole("button", { name: "One more Plain mug" }));
    // 2 x $15 + $26 + $12 = $68; fee 5% ($3.40) + $0.70.
    expect(screen.getByTestId("shop-order-total").textContent).toBe("$72.10");

    fireEvent.click(screen.getByRole("button", { name: "day 2026-10-21" }));
    fireEvent.click(screen.getByRole("button", { name: "Hold my card and send the order" }));
    await waitFor(() => expect(ext.openExternalUrl).toHaveBeenCalled());
    expect(orders.requestOrder.mock.calls[0][0].lines).toEqual([
      { item_id: "c1", variant_id: "v-sf", quantity: 2 },
      { item_id: "c1", variant_id: "v-lv", quantity: 1 },
      { item_id: "p1", quantity: 1 },
    ]);
  });
});

// Variants follow-up (11-06): an item with option lists shows "From" its lowest combination's price on its card.
describe("the item cards", () => {
  it("say From $X for an item with options, and the plain price otherwise", async () => {
    renderIt(<ShopItemsList shopId="s1" />);
    expect(await screen.findByText("From $15")).toBeTruthy();
    expect(screen.getByText("$12")).toBeTruthy();
    expect(screen.queryByText("From $12")).toBeNull();
  });
});

describe("the owner's Options section", () => {
  it("lists every combination with the item's price to start, and saves the lists and each row", async () => {
    variants.fetchItemOptions.mockResolvedValue(new Map());
    renderIt(<ShopItemOptionsEditor shopId="s1" itemId="c1" basePriceCents={1500} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add an option list" }));
    fireEvent.change(screen.getByLabelText("Option name"), { target: { value: "Size" } });
    fireEvent.change(screen.getByLabelText("Choices, separated by commas"), { target: { value: "Small, Large, small" } });
    expect(screen.getAllByLabelText("Price ($)").map((x) => (x as HTMLInputElement).value)).toEqual(["15", "15"]);
    fireEvent.change(screen.getAllByLabelText("Price ($)")[1], { target: { value: "24" } });
    fireEvent.change(screen.getAllByLabelText("Stock")[1], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save options" }));
    await waitFor(() => expect(variants.saveItemOptions).toHaveBeenCalled());
    expect(variants.saveItemOptions).toHaveBeenCalledWith("c1", ["Size"], [
      { values: ["Small"], price_cents: 1500, stock_count: null, active: true },
      { values: ["Large"], price_cents: 2400, stock_count: 2, active: true },
    ]);
  });

  it("says so when a word in the options sends the item to a check (20261106194243 held_for_review)", async () => {
    variants.fetchItemOptions.mockResolvedValue(new Map());
    variants.saveItemOptions.mockResolvedValueOnce(true);
    renderIt(<ShopItemOptionsEditor shopId="s1" itemId="c1" basePriceCents={1500} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add an option list" }));
    fireEvent.change(screen.getByLabelText("Option name"), { target: { value: "Fill" } });
    fireEvent.change(screen.getByLabelText("Choices, separated by commas"), { target: { value: "Plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Save options" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/needs a quick check/)));
    expect(toast.info).not.toHaveBeenCalled(); // a no-op channel: the seller would never see it
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reads held_for_review from the save (the server's word, not a guess)", async () => {
    const real = await vi.importActual<typeof import("@/lib/shops/variants")>("@/lib/shops/variants");
    rpc.mockResolvedValueOnce({ data: { item_id: "c1", held_for_review: true }, error: null });
    expect(await real.saveItemOptions("c1", ["Fill"], [])).toBe(true);
    rpc.mockResolvedValueOnce({ data: { item_id: "c1", held_for_review: false }, error: null });
    expect(await real.saveItemOptions("c1", ["Fill"], [])).toBe(false);
  });

  it("splits choices on commas, trimmed, without blanks or repeats", () => {
    expect(splitChoices(" Small, Large ,, small,XL ")).toEqual(["Small", "Large", "XL"]);
  });
});
