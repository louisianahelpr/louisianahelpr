/**
 * Custom orders (20261106202917): the buyer's "Ask for a custom order" card on a shop's page. Shown only while the
 * shop takes custom orders; sends the trimmed description through shops_send_custom_request; a refusal reads in the
 * shop's plain words (rpcErrorCopy), never the code.
 *
 * @mutate src/components/shops/ShopCustomRequestSheet.tsx |   if (!mode.data \|\| mode.data === "off") return null; |   if (!mode.data) return null;
 * @mutate src/lib/shops/customRequests.ts |     p_shop_id: shopId, p_description: description.trim(), p_wanted_date: wantedDate \|\| null, |     p_shop_id: shopId, p_description: description, p_wanted_date: wantedDate \|\| null,
 * @mutate src/components/shops/ShopCustomRequestSheet.tsx | disabled={!trimmed \|\| send.isPending \|\| | disabled={send.isPending \|\|
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const db = vi.hoisted(() => ({ row: { custom_orders: "full_hold" } as Record<string, unknown> | null, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }) }),
    rpc: db.rpc,
  },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import ShopCustomRequestSheet from "./ShopCustomRequestSheet";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // S2-021: the confirmation links to My orders, so the sheet sits in a router.
  return render(<MemoryRouter><QueryClientProvider client={qc}><ShopCustomRequestSheet shopId="sh1" /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  db.row = { custom_orders: "full_hold" };
  db.rpc.mockReset();
  toast.error.mockClear();
});

describe("asking a shop for a custom order", () => {
  it("is not offered while the shop has custom orders off", async () => {
    db.row = { custom_orders: "off" };
    const { container } = show();
    await waitFor(() => expect(db.row).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });

  it("sends the trimmed description to this shop, then says what happens next", async () => {
    db.rpc.mockResolvedValue({ data: "req-1", error: null });
    show();
    const box = await screen.findByLabelText("What you'd like");
    const send = screen.getByRole("button", { name: "Send to the shop" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  A blue birthday cake for 12  " } });
    fireEvent.click(send);
    await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === "Sent. The shop will answer with a price in My orders, and you can order it from there.");
    expect(db.rpc.mock.calls).toEqual([["shops_send_custom_request", { p_shop_id: "sh1", p_description: "A blue birthday cake for 12", p_wanted_date: null }]]);
  });

  it("a shop still on the hidden half-up-front choice is paid in full, and never promises a deposit (shops audit 11-08 #1)", async () => {
    db.row = { custom_orders: "deposit_50" };
    const { container } = show();
    expect(await screen.findByText(/it's paid like any other order/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/half/i);
  });

  it("a refusal reads in plain words, never the code", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "custom_orders_off", code: "55000" } });
    show();
    fireEvent.change(await screen.findByLabelText("What you'd like"), { target: { value: "A cake" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the shop" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This shop isn't taking custom orders right now."));
  });
});
