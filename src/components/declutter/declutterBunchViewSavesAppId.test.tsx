/**
 * B26 handoff, open: no view-level test proved DeclutterBunchView SAVES the app id BunchStager.sync hands it
 * (LEAD-BUNCH-34-SLOW, one id per item: the early-upload folder and the draft must share it, or a photo is staged
 * under one id and the draft is made under another). Here the real screen sorts two items; the stager is faked so
 * each id it gives is known; listing must send each item with the FIRST id given for it, and no item is given two.
 *
 * @mutate src/components/declutter/useBunchStager.ts |     if (given.size > 0) setItems( |     if (false) setItems(
 * @mutate src/components/declutter/useBunchStager.ts | given.has(it.key) ? { ...it, appId: given.get(it.key) } : it | given.has(it.key) ? { ...it } : it
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem } from "@/lib/declutter/bunch";

const calls = { listed: [] as string[][] };
// The stager is faked as BunchStager.sync behaves: an item with no app id, draft id or id of its own yet is handed a new
// one (remembered by item key, so it is handed once); every id handed out is recorded.
const given = vi.hoisted(() => ({ ids: [] as string[], n: 0 }));
vi.mock("@/lib/declutter/bunchStage", () => ({
  BunchStager: class {
    private readonly mine = new Map<string, string>();
    sync(items: readonly { key: string; appId?: string; draftId?: string; notSorted?: boolean }[]) {
      const out = new Map<string, string>();
      for (const it of items) {
        if (it.notSorted || it.appId || it.draftId || this.mine.has(it.key)) continue;
        const id = `app-${it.key}-${++given.n}`;
        given.ids.push(id);
        this.mine.set(it.key, id);
        out.set(it.key, id);
      }
      return out;
    }
    idFor() { return undefined; }
    path() { return Promise.resolve(null); }
    used() {}
  },
}));

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
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
const lookupAnswer = vi.hoisted(() => ({ value: { status: "exact", lat: 30.4, lng: -91.1 } as Record<string, unknown> }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => lookupAnswer.value }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => [],
  fetchHasAgreedSales: async () => false,
  fetchMyPickupWindows: async () => [],
  setPickupWindows: async () => 1,
  requestAiDraftFromPhotos: async () => { throw new Error("ai_unavailable"); },
}));
const thumbCalls: File[] = [];
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  bunchThumbnail: async (f: File) => { thumbCalls.push(f); return new Blob(["small"], { type: "image/jpeg" }); },
}));
const sort = { hold: null as Promise<void> | null };
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  const card = (key: string, photoKeys: string[], extra: Partial<BunchItem>): BunchItem => ({
    key, photoKeys, title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "", ...extra,
  });
  return {
    ...real,
    groupPhotos: async (photos: { key: string; file: File }[], onProgress: (d: number, t: number, made: BunchItem[]) => void) => {
      const first = [card("i1", [photos[0].key, photos[1].key], { title: "Oak chair" })];
      onProgress(1, 2, first);
      await sort.hold;
      const second = [card("i2", [photos[2].key], { title: "Hunting knife", flagged: true })];
      onProgress(2, 2, second);
      const bad = photos.slice(3).map((p) => ({ key: p.key, name: p.file.name, error: new Error("x") }));
      return { items: [...first, ...second], failed: [], unusable: bad };
    },
    listBunch: async (_s: string, items: BunchItem[]) => {
      calls.listed.push(items.map((i) => `${i.key}=${i.appId ?? "none"}`));
      return [];
    },
  };
});

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

describe("Sell a bunch saves the app id the stager hands it", () => {
  it("each item is listed with the one id given for it, never a second", async () => {
    calls.listed = [];
    given.ids = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/declutter/sell?mode=bunch"]}><DeclutterSellPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("heading", { level: 1, name: "Sell a bunch" }, { timeout: 15_000 });
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
    await waitFor(() => expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2));
    document.querySelectorAll<HTMLElement>('[data-bunch-expand][aria-expanded="false"]').forEach((b) => fireEvent.click(b));
    const cards = document.querySelectorAll<HTMLElement>("[data-bunch-item]");
    // Edits re-run the stager's sync: an item that kept its id is given no other.
    fireEvent.change(within(cards[0]).getByLabelText("Price ($)"), { target: { value: "40" } });
    fireEvent.change(within(cards[1]).getByLabelText("Price ($)"), { target: { value: "30" } });
    fireEvent.change(within(cards[1]).getByLabelText("Title"), { target: { value: "Butter knife" } });
    expect(given.ids).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "2 Main St, Baton Rouge" } });
    fireEvent.click(document.getElementById("bunch-tax")!);
    const list = await screen.findByRole("button", { name: "List 2 items" });
    await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(list);
    await waitFor(() => expect(calls.listed).toHaveLength(1));
    expect(given.ids).toHaveLength(2);
    expect(calls.listed[0]).toEqual([`i1=${given.ids[0]}`, `i2=${given.ids[1]}`]);
  });
});
