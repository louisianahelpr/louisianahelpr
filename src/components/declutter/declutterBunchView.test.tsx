/**
 * "Sell a bunch" screen (owner 2026-10-29: "upload all pictures for everything
 * they want to sell, ai does the forms and they review all at once before
 * submission"). /declutter/sell?mode=bunch:
 *   - the photos picked go to the photo tool's grouping, and each item comes
 *     back as an editable card; a flagged item is marked and not counted ready;
 *   - the four confirmations are needed once, then only the ready items are
 *     listed, and an item that failed is named with its reason.
 *   - "A bunch of things" is a choice in "What do you want to sell?" (DeclutterSellChooser, owner 2026-10-30).
 *
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   const ready = items.filter((it) => !bunchItemProblem(it)); |   const ready = items;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       ?? (checks.some((c) => !c) ? "All four statements need a check before you can list these items." : null) |       ?? null
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |       {item.flagged && ( |       {false && (
 * @mutate src/pages/declutter/DeclutterSellPage.tsx |       ) : params.get("mode") === "bunch" ? ( |       ) : false ? (
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem } from "@/lib/declutter/bunch";

const calls = { listed: [] as string[][] };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/declutter/DeclutterSellView", () => ({ default: () => <p>one item form</p> }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.4, longitude: -91.1 }) }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => [],
  fetchHasAgreedSales: async () => false,
  fetchMyPickupWindows: async () => [],
  setPickupWindows: async () => 1,
  requestAiDraftFromPhotos: async () => { throw new Error("ai_unavailable"); },
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  const card = (key: string, photoKeys: string[], extra: Partial<BunchItem>): BunchItem => ({
    key, photoKeys, title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "", ...extra,
  });
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[]) => ({
      items: [
        card("i1", [photos[0].key, photos[1].key], { title: "Oak chair" }),
        card("i2", [photos[2].key], { title: "Hunting knife", flagged: true }),
      ],
      failed: [],
    }),
    listBunch: async (_s: string, items: BunchItem[]) => {
      calls.listed.push(items.map((i) => i.key));
      return [{ key: "i1", title: "Oak chair", error: Object.assign(new Error("x"), { userMessage: "Refused for a test reason." }), draftId: null }];
    },
  };
});

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterSellChooser from "./DeclutterSellChooser";

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/declutter/sell?mode=bunch"]}><DeclutterSellPage /></MemoryRouter></QueryClientProvider>,
  );
}

describe("Sell a bunch", () => {
  it("photos become editable item cards; a flagged one is marked and not ready; listing needs the confirmations once", async () => {
    calls.listed = [];
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Sell a bunch" })).toBeTruthy();
    expect(screen.queryByText("one item form")).toBeNull();
    const files = ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });

    await screen.findByRole("heading", { name: /^3\. Check each item/ });
    const cards = document.querySelectorAll("[data-bunch-item]");
    expect(cards).toHaveLength(2);
    expect(cards[1].hasAttribute("data-flagged")).toBe(true);
    expect(within(cards[1] as HTMLElement).getByText(/can't be listed from here/)).toBeTruthy();
    // Nothing is ready until it has a price; the flagged item never is.
    expect(screen.getByRole("heading", { name: "3. Check each item (0 of 2 ready)" })).toBeTruthy();
    fireEvent.change(within(cards[0] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    fireEvent.change(within(cards[1] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    expect(screen.getByRole("heading", { name: "3. Check each item (1 of 2 ready)" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    const list = await screen.findByRole("button", { name: "List 1 item" });
    await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(list);
    expect(await screen.findByText("All four statements need a check before you can list these items.")).toBeTruthy();
    expect(calls.listed).toEqual([]);

    for (let i = 0; i < 4; i++) fireEvent.click(document.getElementById(`bunch-tax-${i}`)!);
    fireEvent.click(list);
    await waitFor(() => expect(calls.listed).toEqual([["i1"]]));
    const failed = await screen.findByText(/wasn't listed: Refused for a test reason\./);
    expect(failed.textContent).toContain("still above, to fix and list again");
  });

  it("is a choice in What do you want to sell?", () => {
    render(<MemoryRouter><DeclutterSellChooser /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /A bunch of things/ }).getAttribute("href")).toBe("/declutter/sell?mode=bunch");
  });
});
