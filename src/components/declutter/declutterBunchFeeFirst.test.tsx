/**
 * Sell a bunch audit finding 1: the setup fee used to appear only after every photo was sorted, uploaded and drafted,
 * and the first publish was refused. Now a seller who owes it is told FIRST, and "List all my drafts" finishes what is
 * already saved, after the same four confirmations. Free items never owe it (declutter_setup_fee_before_list asks no
 * fee at price 0; read on prod 2026-10-30), so they carry on while it is due: T2's finding, lead's decision 10-30.
 *
 * @mutate src/components/declutter/BunchFeeGate.tsx |   if (idCheckOn \|\| !profile \|\| profile.onboarding_fee_paid === true \|\| isAdmin \|\| profile.is_seed === true) return null; |   if (true) return null;
 * @mutate src/components/declutter/BunchFeeGate.tsx |   if (idCheckOn \|\| !profile \|\| profile.onboarding_fee_paid === true \|\| isAdmin \|\| profile.is_seed === true) return null; |   if (idCheckOn \|\| !profile) return null;
 * @mutate src/lib/declutter/bunch.ts |   return items.filter((it) => !bunchItemProblem(it) && (!feeDue \|\| !!it.free)); |   return items.filter((it) => !bunchItemProblem(it));
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   const blocked = busy; |   const blocked = busy \|\| feeDue != null;
 * @mutate src/components/declutter/BunchDraftsSection.tsx |   const drafts = feeDue ? saved.filter((i) => i.current_price_cents === 0) : saved; |   const drafts = saved;
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
vi.mock("@/lib/declutter/setupFee", async (orig) => ({ ...(await orig<object>()), payAccountSetupFee: h.pay }));
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

const addPhotos = () => document.getElementById("bunch-files") as HTMLInputElement;

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

describe("the setup fee comes first", () => {
  it("a seller who owes it is told before adding a photo, at the platform's own price, can pay from there, and can still add free items", async () => {
    renderFlow();
    expect(await screen.findByText("Your first listing needs a one-time $2 setup fee")).toBeTruthy();
    expect(screen.getByText(/tick "Give it away free" on each one/)).toBeTruthy();
    expect(addPhotos().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Pay $2" }));
    await waitFor(() => expect(h.pay).toHaveBeenCalledTimes(1));
  });

  it("it follows the setting, never a constant", async () => {
    h.feeCents = 350;
    renderFlow();
    expect(await screen.findByText("Your first listing needs a one-time $3.50 setup fee")).toBeTruthy();
  });

  it.each([
    ["already paid", () => { h.profile = { onboarding_fee_paid: true, is_seed: false }; }],
    ["an admin (the server's trigger exempts them)", () => { h.isAdmin = true; }],
    ["a seeded test account (the server's trigger exempts them)", () => { h.profile = { onboarding_fee_paid: false, is_seed: true }; }],
    ["no fee set", () => { h.feeCents = null; }],
    ["the fee read failed: the server stays the protection", () => { h.feeFails = true; }],
  ])("not asked: %s", async (_name, arrange) => {
    arrange();
    renderFlow();
    await screen.findByRole("heading", { name: "2. Add photos" });
    // Long enough for the fee read to answer: the gate would have appeared by the time the query settles.
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-bunch-fee-gate]")).toBeNull();
    expect(addPhotos().disabled).toBe(false);
  });

  it("the gate is shown, then a paid profile clears it", async () => {
    const { unmount } = renderFlow();
    await screen.findByText("Your first listing needs a one-time $2 setup fee");
    unmount();
    h.profile = { onboarding_fee_paid: true, is_seed: false };
    renderFlow();
    await screen.findByRole("heading", { name: "2. Add photos" });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-bunch-fee-gate]")).toBeNull();
  });
});

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

  it("is not offered for priced drafts while the fee is due: each would be refused", async () => {
    h.profile = { onboarding_fee_paid: false, is_seed: false };
    h.mine = [{ id: "d1", title: "Oak chair", status: "draft", current_price_cents: 4000 }];
    renderFlow();
    await screen.findByText("Your first listing needs a one-time $2 setup fee");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /List (all )?my/ })).toBeNull();
  });

  it("while the fee is due the free drafts still list together, and the priced one is left out and named", async () => {
    h.profile = { onboarding_fee_paid: false, is_seed: false };
    h.mine = [
      { id: "d1", title: "Oak chair", status: "draft", current_price_cents: 4000 },
      { id: "f1", title: "Old rug", status: "draft", current_price_cents: 0 },
      { id: "f2", title: "Box of books", status: "draft", current_price_cents: 0 },
    ];
    h.publishMany.mockResolvedValue([{ id: "f1", status: "live" }, { id: "f2", status: "live" }]);
    renderFlow();
    const button = await screen.findByRole("button", { name: "List my free drafts" });
    expect(screen.getByText(/1 priced draft waits for the setup fee\./)).toBeTruthy();
    fireEvent.click(document.getElementById("bunch-drafts-tax")!);
    fireEvent.click(button);
    await waitFor(() => expect(h.publishMany).toHaveBeenCalledTimes(1));
    expect(h.publishMany.mock.calls[0][0]).toEqual(["f1", "f2"]);
    expect(await screen.findByText("2 listed.")).toBeTruthy();
  });

  it("is not there with no drafts", async () => {
    h.mine = [{ id: "l1", title: "Already live", status: "live" }];
    renderFlow();
    await screen.findByRole("heading", { name: "2. Add photos" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "List all my drafts" })).toBeNull();
  });
});
