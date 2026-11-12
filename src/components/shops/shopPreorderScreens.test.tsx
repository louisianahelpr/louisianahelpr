/**
 * @mutate src/components/shops/ShopHandoverActions.tsx |     : !service ? addDays(order.ready_date, -1) : null; |     : null;
 * Shops preorder screens (migration 20261108184654; owner 11-08):
 *
 *  1. The shop's settings: "Sell as a preorder" sends ready-by, goal + goal date and limit to shops_set_item_preorder
 *     (NULL for the parts left off); a running preorder shows its progress and the one date push.
 *  2. The item card: "Preorder · ready by Dec 15" and "12 of 20 ordered · ends Dec 1" in place of the ready time.
 *  3. The buyer's order: "Cancel preorder" says what comes back, and sends shop-checkout's preorder_cancel.
 *  4. The shop's ready tap waits until 14 days before ready-by: "You can mark it ready from <date>".
 *
 * @mutate src/components/shops/ShopItemPreorderEditor.tsx |       goal: f.withGoal ? whole(f.goal, "preorder_goal") : null, |       goal: null,
 * @mutate src/components/shops/ShopProfile.tsx |                {preorders?.get(item.id) ? ( |                {false ? (
 * @mutate src/lib/shops/preorders.ts |   const data = await invokeShopCheckoutAction({ action: "preorder_cancel", order_id: orderId }); |   const data = await invokeShopCheckoutAction({ action: "buyer_cancel", order_id: orderId });
 * @mutate src/components/shops/ShopMyOrdersView.tsx | (o.preorder_item_id ? <BuyerCancelPreorder order={o} /> : <BuyerCancelOrder order={o} />) | <BuyerCancelOrder order={o} />
 * @mutate src/components/shops/ShopHandoverActions.tsx |   const tooEarly = readyFrom !== null && today < readyFrom; |   const tooEarly = false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";
import type { ShopItem } from "@/lib/shops/items";
import type { ItemPreorder } from "@/lib/shops/preorders";

const invoke = vi.hoisted(() => vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }) =>
  ({ data: { result: "cancelled", refund_cents: 2081 } as Record<string, unknown>, error: null as unknown })));
const rpc = vi.hoisted(() => vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null as unknown, error: null as unknown })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, rpc } }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, description, primaryLabel, onPrimary }: {
    open: boolean; title: string; description?: string; primaryLabel: string; onPrimary: (e: { preventDefault: () => void }) => void;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      <p>{description}</p>
      <button type="button" onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, onChange }: { id?: string; onChange: (v: string) => void }) => (
    <input aria-label={`date ${id ?? ""}`} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const handover = vi.hoisted(() => ({ fetchHandovers: vi.fn(async () => new Map()) }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));
const pre = vi.hoisted(() => ({ fetchItemPreorders: vi.fn(async () => new Map<string, ItemPreorder>()) }));
vi.mock("@/lib/shops/preorders", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/preorders")>()), ...pre }));

import ShopItemPreorderEditor from "./ShopItemPreorderEditor";
import { ShopItemsGrid } from "./ShopProfile";
import { BuyerCancelPreorder } from "./ShopOrderCancel";
import { ShopHandoverActions } from "./ShopHandoverActions";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const ITEM = {
  id: "i1", kind: "made", subtype: "crafts", status: "live", title: "King cake", description: "", price_cents: 2000,
  lead_time_days: 1, stock_count: null, home_kitchen: false, photos: [],
} as unknown as ShopItem;
const PRE: ItemPreorder = {
  item_id: "i1", ready_by: "2026-12-15", goal: 20, goal_by: "2026-12-01", cap: 30, ordered: 12,
  goal_met: false, goal_missed: false, moved: false, open: true,
};
const order = (o: Partial<ShopOrder> = {}) => ({
  id: "o1", buyer_id: "b1", seller_id: "s1", shop_id: "sh1", status: "accepted", close_reason: null, ready_date: "2099-12-15",
  cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", note: "", decline_reason: null, items_cents: 2000,
  premium_cents: 170, tax_cents: 0, total_cents: 2170, created_at: "", held_at: null, accept_by: null, accepted_at: "",
  captured_at: "2026-11-08T00:00:00Z", closed_at: null, handover_mode: "in_person", handed_over_at: null,
  shop_order_lines: [], preorder_item_id: "i1", preorder_moved_at: null, ...o,
}) as ShopOrder;

beforeEach(() => {
  vi.clearAllMocks();
  pre.fetchItemPreorders.mockResolvedValue(new Map());
  handover.fetchHandovers.mockResolvedValue(new Map());
});

describe("the shop's preorder settings", () => {
  it("sends ready-by, the goal and the limit; parts left off are NULL", async () => {
    wrap(<ShopItemPreorderEditor shopId="sh1" item={ITEM} hasOptions={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sell as a preorder" }));
    expect(screen.getByTestId("shop-item-preorder-rules").textContent).toContain("Buyers are charged in full when they order.");
    fireEvent.change(screen.getAllByLabelText(/^date /)[0], { target: { value: "2026-12-15" } });
    fireEvent.click(screen.getByLabelText("Only make it if enough people order (a goal)"));
    fireEvent.change(screen.getByLabelText("How many need to be ordered"), { target: { value: "20" } });
    fireEvent.change(screen.getAllByLabelText(/^date /)[1], { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preorder" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("shops_set_item_preorder", {
      p_item_id: "i1", p_ready_by: "2026-12-15", p_goal: 20, p_goal_by: "2026-12-01", p_cap: null,
    }));
  });

  it("a running preorder shows its progress and the one date push", async () => {
    pre.fetchItemPreorders.mockResolvedValue(new Map([["i1", PRE]]));
    wrap(<ShopItemPreorderEditor shopId="sh1" item={ITEM} hasOptions={false} />);
    expect(await screen.findByText("Preorder · ready by Dec 15")).toBeTruthy();
    expect(screen.getByText("12 of 20 ordered · ends Dec 1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^date .*-push$/), { target: { value: "2026-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Move the date" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm Save the new date" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("shops_push_preorder_date", { p_item_id: "i1", p_new_ready_by: "2026-12-20" }));
  });

  it("items with a ready-now count or options say why they can't be preordered; services show nothing", async () => {
    const { unmount } = wrap(<ShopItemPreorderEditor shopId="sh1" item={{ ...ITEM, stock_count: 4 }} hasOptions={false} />);
    expect((await screen.findByTestId("shop-item-preorder-blocked")).textContent).toContain("I have some ready now");
    unmount();
    wrap(<ShopItemPreorderEditor shopId="sh1" item={{ ...ITEM, kind: "service" } as ShopItem} hasOptions={false} />);
    expect(screen.queryByTestId("shop-item-preorder")).toBeNull();
  });
});

describe("the item card", () => {
  it("says Preorder, ready by, and the goal progress in place of the ready time", () => {
    render(<ShopItemsGrid items={[ITEM]} preorders={new Map([["i1", PRE]])} />);
    expect(screen.getByText("Preorder · ready by Dec 15")).toBeTruthy();
    expect(screen.getByText("12 of 20 ordered · ends Dec 1")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Preorder goal" }).getAttribute("aria-valuenow")).toBe("12");
    expect(screen.queryByText(/Ready in 1 day/)).toBeNull();
  });
});

describe("the buyer's preorder", () => {
  it("Cancel preorder says what comes back and sends preorder_cancel", async () => {
    wrap(<BuyerCancelPreorder order={order()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel preorder" }));
    expect(screen.getByText("You get back $21.70, less the card-processing cost and the sales tax on it. The shop is told.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "confirm Cancel preorder" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("shop-checkout", { body: { action: "preorder_cancel", order_id: "o1", native: false } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Preorder cancelled. $20.81 is on its way back to your card.")); // bare toast(): a confirmation always renders
  });

  it("after the shop moved the date: everything back; marked ready: no cancel", async () => {
    const { unmount } = wrap(<BuyerCancelPreorder order={order({ preorder_moved_at: "2026-11-09T00:00:00Z" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel preorder" }));
    expect(screen.getByText("You get everything you paid back: $21.70. The shop is told.")).toBeTruthy();
    unmount();
    handover.fetchHandovers.mockResolvedValue(new Map([["o1", { ready_at: "2026-11-09T00:00:00Z" }]]));
    wrap(<BuyerCancelPreorder order={order()} />);
    await waitFor(() => expect(handover.fetchHandovers).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Cancel preorder" })).toBeNull();
  });

  it("the buyer's orders page mounts the preorder cancel for a preorder", () => {
    const src = readFileSync("src/components/shops/ShopMyOrdersView.tsx", "utf8");
    expect(src).toContain("(o.preorder_item_id ? <BuyerCancelPreorder order={o} /> : <BuyerCancelOrder order={o} />)");
  });
});

describe("the shop's ready tap on a preorder", () => {
  it("waits until 14 days before ready-by", async () => {
    wrap(<ShopHandoverActions order={order({ ready_date: "2099-12-15" })} side="shop" userId="s1" />);
    expect((await screen.findByTestId("shop-preorder-ready-from")).textContent).toBe("This is a preorder. You can mark it ready from Dec 1.");
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull();
  });
  it("S032: a regular order's ready tap waits until the day before its ready date", async () => {
    wrap(<ShopHandoverActions order={order({ ready_date: "2099-12-15", preorder_item_id: null })} side="shop" userId="s1" />);
    expect((await screen.findByTestId("shop-preorder-ready-from")).textContent).toBe("You can mark it ready from Dec 14, the day before it's due.");
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull();
  });
});
