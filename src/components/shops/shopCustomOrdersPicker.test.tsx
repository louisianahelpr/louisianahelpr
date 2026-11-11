/**
 * Custom orders (20261106202917): the shop's setting on its dashboard. Reads shops.custom_orders, shows the open
 * choices with the saved one checked, and saves through shops_set_custom_orders (the caller's own shop only, in SQL:
 * src/test/pglite/shopsCustomRequests.pglite.mjs). A refusal reads in plain words.
 *
 * @mutate src/lib/shops/orders.ts |   const { data, error } = await supabase.rpc("shops_set_custom_orders", { p_mode: mode }); |   const { data, error } = await supabase.rpc("shops_set_custom_orders", { p_mode: "off" });
 * @mutate src/components/shops/ShopCustomOrdersPicker.tsx | onChange={(m) => { if (m !== current && !save.isPending) save.mutate(m as CustomOrderMode); }} | onChange={(m) => { save.mutate(m as CustomOrderMode); }}
 * @mutate src/lib/shops/orders.ts |   return (CUSTOM_ORDER_MODES as readonly string[]).includes(v ?? "") ? (v as CustomOrderMode) : "off"; |   return "off";
 * @mutate src/lib/shops/orders.ts | export const PICKABLE_CUSTOM_ORDER_MODES: readonly CustomOrderMode[] = ["off", "full_hold"]; | export const PICKABLE_CUSTOM_ORDER_MODES: readonly CustomOrderMode[] = CUSTOM_ORDER_MODES;
 * @mutate src/components/shops/ShopCustomOrdersPicker.tsx |   const current = choice.data === "deposit_50" ? "full_hold" : choice.data ?? ""; |   const current = choice.data ?? "";
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({ row: { custom_orders: "full_hold" } as Record<string, unknown> | null, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }) }),
    rpc: db.rpc,
  },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import CustomOrdersPicker from "./ShopCustomOrdersPicker";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CustomOrdersPicker shopId="sh1" /></QueryClientProvider>);
}

beforeEach(() => {
  db.row = { custom_orders: "full_hold" };
  db.rpc.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("the shop's custom orders setting", () => {
  it("shows the two open choices with the saved one checked, and never offers half up front (shops audit 11-08 #1)", async () => {
    show();
    const full = await screen.findByRole("radio", { name: /Custom orders, paid in full/ });
    expect(full.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /No custom orders/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("radio", { name: /half up front/i })).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("a shop still on half up front reads as paid in full, with a plain note", async () => {
    db.row = { custom_orders: "deposit_50" };
    show();
    expect((await screen.findByRole("radio", { name: /Custom orders, paid in full/ })).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("note").textContent).toBe("Half up front isn't open yet, so your custom orders are paid in full for now.");
    expect(screen.queryByRole("radio", { name: /half up front/i })).toBeNull();
  });

  it("a shop with no setting yet reads as off", async () => {
    db.row = null;
    show();
    expect((await screen.findByRole("radio", { name: /No custom orders/ })).getAttribute("aria-checked")).toBe("true");
  });

  it("tapping another choice saves exactly it; tapping the checked one saves nothing", async () => {
    db.row = { custom_orders: "off" };
    db.rpc.mockResolvedValue({ data: "full_hold", error: null });
    show();
    fireEvent.click(await screen.findByRole("radio", { name: /No custom orders/ }));
    expect(db.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Custom orders, paid in full/ }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledTimes(1));
    expect(db.rpc.mock.calls).toEqual([["shops_set_custom_orders", { p_mode: "full_hold" }]]);
  });

  it("a refusal reads in plain words", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "shop_strikes_blocked", code: "42501" } });
    show();
    fireEvent.click(await screen.findByRole("radio", { name: /No custom orders/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(toast.error.mock.calls[0][0])).not.toMatch(/shop_strikes_blocked/);
  });
});
