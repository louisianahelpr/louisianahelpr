/**
 * Audit 2026-10-28 P5-9: pressing "Open my shop" opened the shop and showed no
 * confirmation. The call site said `toast.success("Your shop is open.")`, but
 * the boot toast policy (src/lib/toastPolicy.ts, applyToastPolicy) turns
 * toast.success into a no-op, so the line was dead. Opening a shop puts it in
 * front of every member, so it is confirmed through confirmConsequential, the
 * one success channel the policy lets render.
 *
 * Drives the REAL sonner store with the policy applied, as main.tsx does at
 * boot, so a confirmation that cannot render fails here.
 *
 * @mutate src/components/shops/ShopEditView.tsx |       else confirmConsequential("Your shop is open."); |       else toast.success("Your shop is open.");
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { applyToastPolicy } from "@/lib/toastPolicy";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.15, longitude: -91.96 }) }));
const api = vi.hoisted(() => ({ saveMyShop: vi.fn(async () => "s1"), setShopHours: vi.fn(async () => undefined) }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  fetchMyShopId: async () => null,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
}));

import ShopEditPage from "@/pages/shops/ShopEditPage";

const titles = () =>
  toast
    .getToasts()
    .filter((t): t is Extract<typeof t, { title?: unknown }> => "title" in t)
    .map((t) => String(t.title ?? ""));

describe("Open my shop confirms", () => {
  beforeAll(() => applyToastPolicy());
  afterEach(() => toast.dismiss());

  it("a new shop shows 'Your shop is open.' with the toast policy on", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/shops/mine"]}>
          <Routes>
            <Route path="/shops/mine" element={<ShopEditPage />} />
            <Route path="/shops/:id" element={<p>Shop page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const button = await screen.findByRole("button", { name: "Open my shop" });
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(await screen.findByText("Shop page")).toBeTruthy();
    expect(api.saveMyShop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(titles()).toContain("Your shop is open."));
  });
});
