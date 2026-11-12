/**
 * Shops audit 2 (11-12): the custom request list.
 *   S2-024: a failed read says so with Try again (it showed nothing); closed requests fold under "Earlier".
 *   S2-021: an unanswered request shows its 7-day deadline to both sides.
 *   S2-020 (part): the shop's "Price sent" toast says it still accepts the order within 24 hours.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const fetchMyCustomRequests = vi.fn();
vi.mock("@/lib/shops/customRequests", () => ({ fetchMyCustomRequests: () => fetchMyCustomRequests() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import ShopCustomRequestsList, { answerByText } from "@/components/shops/ShopCustomRequestsList";

const base = { shop_id: "s1", shop_name: "TEST shop", role: "shop", wanted_date: null, payment_plan: "full_hold",
  quote_cents: null, quote_note: null, quoted_at: null, expires_at: null };
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // S2-018: the request's Message button reads the URL (?talk=), so the list sits in a router.
  return render(<MemoryRouter><QueryClientProvider client={qc}><ShopCustomRequestsList side="shop" /></QueryClientProvider></MemoryRouter>);
};

describe("S2-024 / S2-021 custom request list", () => {
  beforeEach(() => fetchMyCustomRequests.mockReset());
  it("a failed read shows an error with Try again", async () => {
    fetchMyCustomRequests.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    mount();
    expect(await screen.findByTestId("shop-custom-requests-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
  it("open requests show their deadline; closed ones fold under Earlier", async () => {
    fetchMyCustomRequests.mockResolvedValue([
      { ...base, id: "a", description: "Old ask", status: "declined", created_at: "2026-10-01T15:00:00Z" },
      { ...base, id: "b", description: "New ask", status: "requested", created_at: "2026-11-10T15:00:00Z" },
    ]);
    mount();
    expect(await screen.findByText("New ask")).toBeTruthy();
    expect(screen.getByText(/New request, answer by November 17/)).toBeTruthy();
    const earlier = screen.getByTestId("shop-custom-requests-earlier");
    expect(earlier.textContent).toContain("Earlier (1)");
    expect(earlier.textContent).toContain("Old ask");
    expect(earlier.hasAttribute("open")).toBe(false);
  });
  it("the buyer reads the shop's deadline", () => {
    expect(answerByText("2026-11-10T15:00:00Z", "buyer")).toBe(", the shop has until November 17");
  });
  it("S2-020: the Price sent toast names the 24-hour accept", () => {
    const src = readFileSync(resolve(__dirname, "../components/shops/ShopCustomQuoteForm.tsx"), "utf8");
    expect(src).toContain("you then accept the order within 24 hours");
  });
});
