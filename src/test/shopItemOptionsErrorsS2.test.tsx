/**
 * S2-009 (Shops audit 2): option errors match the server and show under the row.
 *   - a switched-off combination with a price the server would refuse sends the item's own price (it is never sold),
 *     instead of failing the save with a toast naming no row;
 *   - stock is a whole number (2.5 was allowed and refused as "a price" problem), said under that row, Save off.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const saved = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/shops/variants", async (io) => ({
  ...(await io<typeof import("@/lib/shops/variants")>()),
  fetchItemOptions: async () => new Map([["i1", {
    item_id: "i1", option_names: ["Size"],
    variants: [
      { id: "v1", values: ["Small"], price_cents: 1200, stock_count: null, active: true },
      { id: "v2", values: ["Large"], price_cents: 1800, stock_count: null, active: true },
    ],
  }]]),
  saveItemOptions: async (...args: unknown[]) => { saved.calls.push(args); return false; },
}));

import ShopItemOptionsEditor, { optionRowPriceCents, optionStockProblem } from "@/components/shops/ShopItemOptionsEditor";

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ShopItemOptionsEditor shopId="s1" itemId="i1" basePriceCents={1500} />
  </QueryClientProvider>,
);

describe("S2-009 option errors", () => {
  it("the rules", () => {
    expect(optionStockProblem("")).toBeNull();
    expect(optionStockProblem("3")).toBeNull();
    expect(optionStockProblem("2.5")).toMatch(/whole number/);
    expect(optionStockProblem("10000")).toMatch(/whole number/);
    expect(optionRowPriceCents({ price: "0.5", active: false }, 1500)).toBe(1500);
    expect(optionRowPriceCents({ price: "12", active: false }, 1500)).toBe(1200);
    expect(optionRowPriceCents({ price: "12", active: true }, 1500)).toBe(1200);
  });

  it("a decimal stock is named under its row and Save stays off", async () => {
    mount();
    const stock = await screen.findByLabelText("Stock", { selector: "#combo-stock-Small" });
    fireEvent.change(stock, { target: { value: "2.5" } });
    expect(await screen.findByText(/A whole number from 0 to 9999/)).toBeTruthy();
    expect(stock.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Save options" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a switched-off row with a bad price saves with the item's price", async () => {
    saved.calls.length = 0;
    mount();
    const price = await screen.findByLabelText("Price ($)", { selector: "#combo-price-Large" });
    fireEvent.change(price, { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("Large"));
    const save = screen.getByRole("button", { name: "Save options" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(saved.calls.length).toBe(1));
    const rows = saved.calls[0][2] as Array<{ values: string[]; price_cents: number; active: boolean }>;
    expect(rows.find((r) => r.values[0] === "Large")).toMatchObject({ price_cents: 1500, active: false });
  });
});
