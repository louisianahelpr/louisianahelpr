/**
 * Sell a bunch audit finding 1: "List all my drafts" finishes what is already saved, after the same four
 * confirmations. Owner 2026-11-20: no setup fee in Declutter, so nothing holds a priced draft back (the fee gate that
 * came first from 10-30 is gone; src/test/declutterNoIdNoSetupFee.test.ts).
 *
 * @mutate src/components/declutter/BunchDraftsSection.tsx |     if (!attested) { |     if (false) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  profile: { onboarding_fee_paid: false, is_seed: false } as Record<string, unknown>,
  isAdmin: false,
  feeCents: 200 as number | null,
  feeFails: false,
  mine: [] as { id: string; title: string; status: string; current_price_cents?: number }[],
  pay: vi.fn(async () => "opened"),
  publishMany: vi.fn(),
}));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: h.profile, isAdmin: h.isAdmin, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...(await orig<object>()),
    useOnboardingFeeQuery: () => useQuery({
      queryKey: ["fee"],
      queryFn: async () => {
        if (h.feeFails) throw new Error("read failed");
        return h.feeCents;
      },
    }),
  };
});
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/declutter/moves", async (orig) => ({ ...(await orig<object>()), publishMany: h.publishMany }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => h.mine,
  fetchPhotos: async (ids: string[]) => ids.map((id) => ({ item_id: id })),
  fetchMyPickupWindows: async () => [],
}));

import BunchFlow from "./DeclutterBunchView";

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
}


beforeEach(() => {
  h.profile = { onboarding_fee_paid: false, is_seed: false };
  h.isAdmin = false;
  h.feeCents = 200;
  h.feeFails = false;
  h.mine = [];
  h.pay.mockClear();
  h.publishMany.mockReset();
});
afterEach(cleanup);

describe("List all my drafts", () => {
  beforeEach(() => {
    h.profile = { onboarding_fee_paid: true, is_seed: false };
    h.mine = [
      { id: "d1", title: "Oak chair", status: "draft" },
      { id: "d2", title: "Floor lamp", status: "draft" },
      { id: "l1", title: "Already live", status: "live" },
    ];
  });

  it("needs the four confirmations, lists only the drafts, and names each refusal", async () => {
    h.publishMany.mockResolvedValue([{ id: "d1", status: "live" }, { id: "d2", error: Object.assign(new Error("x"), { userMessage: "Refused for a test reason." }) }]);
    renderFlow();
    const button = await screen.findByRole("button", { name: "List all my drafts" });
    fireEvent.click(button);
    expect(await screen.findByText("Tick the box under the four statements before you list your drafts.")).toBeTruthy();
    expect(h.publishMany).not.toHaveBeenCalled();

    fireEvent.click(document.getElementById("bunch-drafts-tax")!);
    fireEvent.click(button);
    await waitFor(() => expect(h.publishMany).toHaveBeenCalledTimes(1));
    expect(h.publishMany.mock.calls[0][0]).toEqual(["d1", "d2"]);
    expect((await screen.findByText(/wasn't listed: Refused for a test reason\./)).textContent).toContain("Floor lamp");
    expect(screen.getByText("1 listed.")).toBeTruthy();
  });

  it("a paid-up seller's list counts priced and free drafts alike", async () => {
    h.mine = [
      { id: "d1", title: "Oak chair", status: "draft", current_price_cents: 4000 },
      { id: "f1", title: "Old rug", status: "draft", current_price_cents: 0 },
    ];
    renderFlow();
    expect(await screen.findByRole("button", { name: "List all my drafts" })).toBeTruthy();
    expect(screen.queryByText(/waits? for the setup fee/)).toBeNull();
  });

  it("owner 2026-11-20: a member who never paid any setup fee lists priced and free drafts together", async () => {
    h.profile = { onboarding_fee_paid: false, is_seed: false };
    h.mine = [
      { id: "d1", title: "Oak chair", status: "draft", current_price_cents: 4000 },
      { id: "f1", title: "Old rug", status: "draft", current_price_cents: 0 },
    ];
    h.publishMany.mockResolvedValue([{ id: "d1", status: "live" }, { id: "f1", status: "live" }]);
    renderFlow();
    const button = await screen.findByRole("button", { name: "List all my drafts" });
    expect(screen.queryByText(/setup fee/i)).toBeNull();
    expect(document.querySelector("[data-bunch-fee-gate]")).toBeNull();
    fireEvent.click(document.getElementById("bunch-drafts-tax")!);
    fireEvent.click(button);
    await waitFor(() => expect(h.publishMany).toHaveBeenCalledTimes(1));
    expect(h.publishMany.mock.calls[0][0]).toEqual(["d1", "f1"]);
  });

  it("is not there with no drafts", async () => {
    h.mine = [{ id: "l1", title: "Already live", status: "live" }];
    renderFlow();
    await screen.findByRole("heading", { name: "2. Add photos" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "List all my drafts" })).toBeNull();
  });
});
