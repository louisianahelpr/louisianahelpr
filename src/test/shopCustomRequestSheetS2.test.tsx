/**
 * S2-021 (Shops audit 2, the rest): the request form sends an optional "Need it by" date (the server took one; the form
 * always sent null, so "Wanted by" never showed), and the confirmation links to My orders, where the price shows up.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const sent = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/shops/orders", async (io) => ({ ...(await io<typeof import("@/lib/shops/orders")>()), fetchCustomOrders: async () => "full_hold" }));
vi.mock("@/lib/shops/customRequests", async (io) => ({
  ...(await io<typeof import("@/lib/shops/customRequests")>()),
  sendCustomRequest: async (...a: unknown[]) => { sent.calls.push(a); return "r1"; },
}));

import ShopCustomRequestSheet, { wantedDateBounds } from "@/components/shops/ShopCustomRequestSheet";

describe("S2-021 the request form", () => {
  it("bounds are tomorrow to 180 days, in the member's own day", () => {
    expect(wantedDateBounds(new Date(2026, 10, 12, 23, 30))).toEqual({ min: "2026-11-13", max: "2027-05-11" });
  });
  it("sends the Need-by date and links the confirmation to My orders", async () => {
    render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ShopCustomRequestSheet shopId="s1" /></QueryClientProvider></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("What you'd like"), { target: { value: "A birthday cake" } });
    const { min } = wantedDateBounds();
    fireEvent.change(screen.getByLabelText("Need it by (optional)"), { target: { value: min } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the shop" }));
    await waitFor(() => expect(sent.calls).toHaveLength(1));
    expect(sent.calls[0]).toEqual(["s1", "A birthday cake", min]);
    expect((await screen.findByRole("link", { name: "My orders" })).getAttribute("href")).toBe("/shops/orders");
  });
});
