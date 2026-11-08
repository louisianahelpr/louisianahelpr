/**
 * Audit 2026-10-28 P5-1: /shops/mine said "You need to be 18 or older and have
 * payouts set up", but a member with no payout account opened a shop at once.
 * The server is right: since the owner's 2026-10-27 rule (payout setup only
 * when money is owed, migration 20261027163240) shops_assert_owner_eligible has
 * no payout gate (src/test/payoutSetupOnlyWhenOwed.test.ts pins that). So the
 * COPY changes: 18 or older only, payouts at the first sale.
 *
 * Shops audit 11-08 #9: it also says, before the form, that the ID check comes once before the first item goes live
 * (only while the ID check is on) and that the one-time setup fee comes out of the first payout.
 *
 * @mutate src/components/shops/ShopOpenIntro.tsx |       {" "}Payouts come later, when you make your first sale |       {" "}You need payouts set up first
 * @mutate src/components/shops/ShopOpenIntro.tsx |       {idCheck.on ? " Before your first item goes live you verify your ID once (about 2 minutes)." : ""} |
 * @mutate src/components/shops/ShopOpenIntro.tsx |         ? `, and a one-time ${feeCents ? `${dollars(feeCents)} ` : ""}account setup fee comes out of your first payout.` |         ? "."
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useOnboardingFee", () => ({ useOnboardingFeeCents: () => 200 }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  fetchMyShopId: async () => null,
  fetchShopCategories: async () => [{ slug: "bakery", label: "Bakery", group_label: "Food" }],
}));

import ShopEditPage from "@/pages/shops/ShopEditPage";

describe("/shops/mine intro: who may open a shop", () => {
  it("asks only for 18 or older and says payouts come at the first sale", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/shops/mine"]}>
          <Routes>
            <Route path="/shops/mine" element={<ShopEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Open a shop" })).toBeTruthy();
    const intro = screen.getByText(/Opening a shop is free/);
    const text = intro.textContent ?? "";
    expect(text).toMatch(/18 or older/);
    expect(text).toMatch(/Payouts come later, when you make your first sale/);
    // Shops audit 11-08 #9: the ID check and the setup fee are said before the form.
    expect(text).toMatch(/Before your first item goes live you verify your ID once/);
    expect(text).toMatch(/a one-time \$2 account setup fee comes out of your first payout\./);
    // Never a precondition on payouts before opening.
    expect(text).not.toMatch(/have payouts set up|payouts? (?:must|need)|set up payouts (?:first|before)/i);
  });
});
