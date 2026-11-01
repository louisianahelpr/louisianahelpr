/**
 * Audit posting 1030 #1: a leave or reload threw away a new listing's photos, the written listing and every edit, with
 * no warning. The store is an in-memory idb-keyval (jsdom has no IndexedDB); the real one is a browser check. The API is
 * stubbed: this checks what the client keeps and brings back, not the server.
 *
 * @mutate src/components/declutter/useSellFlowState.ts |     setHeld((h) => [...back.held, ...h]); |     void back.held;
 * @mutate src/components/declutter/useSellFlowState.ts |     setBroughtBack(back.form.title.trim() ? "written" : "unwritten"); |     setBroughtBack("unwritten");
 * @mutate src/components/declutter/useSellFlowState.ts |       void keptWork.finish();\n      if (!urlItemId) void prefs.rememberChoices | void 0;\n      if (!urlItemId) void prefs.rememberChoices
 * @mutate src/components/declutter/useSellFlowState.ts |         void keptWork.finish();\n        toast(String( |         void 0;\n        toast(String(
 * @mutate src/components/declutter/useSellFlowState.ts |       setCreatedId(back.createdId); |       void setCreatedId;
 * @mutate src/components/declutter/useSellSaved.ts |     warn: hasWork && !finished.current, |     warn: false,
 * @mutate src/components/declutter/useSellSaved.ts |           if (!row) draftId = null; |           void row;
 * @mutate src/lib/authSignOut.ts |     clearSavedSellOne(), |     Promise.resolve(),
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NEW_ID = "0f0e0d0c-0b0a-4908-8706-0504030201ff";
const h = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  calls: [] as string[],
  aiCalls: 0,
  onDraft: [] as { id: string; storage_path: string }[],
  publishFails: false,
  // LEAD-RESUME-REPOSTS: Post's create answers "already posted" (the app's id is the seller's live listing).
  alreadyPosted: false,
  draftRow: { id: "", status: "draft" } as { id: string; status: string } | null,
  // LEAD-BUNCH-DROPS-IGNORED: the seller's saved Settings row, and what Post saved.
  defaults: null as unknown,
  drops: [] as number[],
  floors: [] as [number, number][],
}));

vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.disk.get(k),
  set: async (k: string, v: unknown) => void h.disk.set(k, v),
  del: async (k: string) => void h.disk.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => h.disk.delete(k)),
  keys: async () => [...h.disk.keys()],
  createStore: () => ({}),
}));
// Whether a photo can be prepared is a browser matter (jsdom has no canvas): "bad*" can't.
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  cleanListingPhoto: async (f: File) => {
    if (f.name.startsWith("bad")) throw new (await import("@/lib/declutter/errors")).ListingPhotoError("We couldn't prepare this photo.");
    return f;
  },
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }), getCachedUserLocation: () => null, deriveFallbackLocation: async () => null }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.45, longitude: -91.15 }) }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => h.defaults, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [{ id: "pl", position: 1, label: "Home", address: "100 Main Street, Baton Rouge, LA 70802", area: "Mid-City, Baton Rouge", lat: 30.45, lng: -91.15, weekdays: [6] }] }));
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async () => h.draftRow,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => h.onDraft,
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  createDraft: async (f: { priceCents: number; floorPriceCents: number }) => { h.calls.push("createDraft");
    if (h.alreadyPosted) throw Object.assign(new Error("already_posted"), { itemId: "live-1", userMessage: "Already posted. It's under Selling." }); h.floors.push([f.priceCents, f.floorPriceCents]); return NEW_ID; },
  setDropPct: async (_id: string, pct: number) => { h.drops.push(pct); return pct; },
  fetchItemDropState: async () => null,
  updateDraft: async () => { h.calls.push("updateDraft"); return "ok"; },
  setPorchOk: async () => true,
  setKeepUp: async () => true,
  setHandovers: async (_id: string, ways: string[]) => ways,
  fetchItemHandovers: async () => null,
  addPhotoSteadily: async (_u: string, _id: string, f: File) => { h.onDraft.push({ id: `p-${f.name}`, storage_path: f.name }); return "p"; },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  requestAiDraftFromPhotos: async () => {
    h.aiCalls += 1;
    return { title: "Walnut dresser", description: "Six drawers.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, priceDollars: 45 };
  },
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => 1,
  attestItem: async () => {},
  publishItem: async () => {
    if (h.publishFails) throw new Error("declutter_not_ready");
    h.calls.push("publish");
    return "live";
  },
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

/** A settings row's value in the listing summary (owner 2026-11-01): "drops", "free" or "pickup". */
const settingsValue = (id: string) => document.querySelector(`[data-settings-row="${id}"] [data-settings-value]`)?.textContent ?? null;

function open(entry = "/declutter/sell") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          <Route path="/declutter" element={<p>Selling tab</p>} />
          <Route path="/declutter/item/:id" element={<p>Item page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const addPhotos = (...names: string[]) => fireEvent.change(document.getElementById("sell-files")!, { target: { files: names.map(jpg) } });
const rowValue = (field: string) => document.querySelector(`[data-summary-row="${field}"] [data-summary-value]`)?.textContent ?? null;
const savedMeta = () => h.disk.get("lh-sell-one-v1") as { form: { title: string }; createdId: string | null } | undefined;

async function startAndEdit() {
  open();
  await screen.findByRole("heading", { name: "Show it off" });
  addPhotos("a.jpg", "b.jpg");
  await screen.findByText("We wrote your listing. Check it before you post");
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Grandma's dresser" } });
  await waitFor(() => expect(savedMeta()?.form.title).toBe("Grandma's dresser"));
}

describe("a new listing is kept on this device", () => {
  beforeEach(() => {
    h.disk.clear();
    h.calls.length = 0;
    h.onDraft.length = 0;
    h.aiCalls = 0;
    h.publishFails = false;
    h.alreadyPosted = false;
    h.draftRow = { id: NEW_ID, status: "draft" };
    h.defaults = null;
    h.drops.length = 0;
    h.floors.length = 0;
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(cleanup);

  it("a reload brings back the photos and the seller's edit, says so, and doesn't ask the AI again", async () => {
    await startAndEdit();
    expect(h.aiCalls).toBe(1);
    cleanup();
    open();
    expect(await screen.findByText("We kept your listing from last time.")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-count]")?.textContent).toContain("2 of 12");
    expect(rowValue("title")).toBe("Grandma's dresser");
    expect(rowValue("price")).toBe("$45");
    expect(h.aiCalls).toBe(1);
  });

  it("after a reload, Write it again still keeps the seller's edit", async () => {
    await startAndEdit();
    cleanup();
    open();
    await screen.findByText("We kept your listing from last time.");
    fireEvent.click(screen.getByRole("button", { name: "Write my listing" }));
    await waitFor(() => expect(h.aiCalls).toBe(2));
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(rowValue("title")).toBe("Grandma's dresser");
  });

  it("nothing to keep before there is a photo or a word", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    await new Promise((r) => setTimeout(r, 450));
    expect(savedMeta()).toBeUndefined();
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  it("closing the tab with work asks first", async () => {
    await startAndEdit();
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it("posting clears what was kept, so nothing comes back", async () => {
    await startAndEdit();
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByText("Selling tab");
    await waitFor(() => expect(h.disk.size).toBe(0));
  });

  // LEAD-RESUME-REPOSTS (owner 2026-10-31, prod duplicates c87b7de4 / 019dd0b3): Post again on a listing that is
  // already live makes no second copy: no publish, the kept work is cleared, and the posted listing opens.
  // @mutate src/components/declutter/useSellFlowState.ts |       if (posted?.message === "already_posted" && typeof posted.itemId === "string") { |       if (false) {
  it("post, then Post again on the same listing: nothing is made twice, the kept work goes, the listing opens", async () => {
    await startAndEdit();
    h.alreadyPosted = true;
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByText("Item page");
    expect(h.calls).toEqual(["createDraft"]);
    await waitFor(() => expect(h.disk.size).toBe(0));
    h.alreadyPosted = false;
  });

  it("a failed publish then a reload updates the same draft, never a second one", async () => {
    await startAndEdit();
    h.publishFails = true;
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(savedMeta()?.createdId).toBe(NEW_ID));
    await waitFor(() => expect(screen.getByRole("button", { name: "Post it" })).toBeEnabled());
    cleanup();
    h.publishFails = false;
    h.alreadyPosted = false;
    h.calls.length = 0;
    open();
    await screen.findByText("We kept your listing from last time.");
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByText("Selling tab");
    expect(h.calls).toEqual(["updateDraft", "publish"]);
  });

  it("a draft that has gone away isn't reopened; one that went live clears what was kept", async () => {
    await startAndEdit();
    h.disk.set("lh-sell-one-v1", { ...savedMeta(), createdId: NEW_ID });
    cleanup();
    h.draftRow = { id: NEW_ID, status: "live" };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    await waitFor(() => expect(h.disk.has("lh-sell-one-v1")).toBe(false));
    expect(screen.queryByText("We kept your listing from last time.")).toBeNull();
    expect(document.querySelector("[data-photo-count]")?.textContent).toContain("0 of 12");
  });

  it("Start over clears it and gives a fresh form", async () => {
    await startAndEdit();
    cleanup();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Start over" }));
    await waitFor(() => expect(document.querySelector("[data-photo-count]")?.textContent).toContain("0 of 12"));
    expect(screen.queryByText("We kept your listing from last time.")).toBeNull();
    expect(rowValue("title")).toBe("Add a title");
    await waitFor(() => expect(h.disk.has("lh-sell-one-v1")).toBe(false));
  });
  // LEAD-BUNCH-DROPS-IGNORED (owner 2026-10-31, prod c87b7de4): the owner turned price drops off in Settings at
  // 14:38:20Z while a listing was kept on the phone with drops on; the kept listing was posted at 14:38:41Z with
  // drop_pct 5 and a lowest price under the price, and the live sheet promised drops. Settings win over what was kept.
  // @mutate src/components/declutter/useSellFlowState.ts | keptFor: !urlItemId && broughtBack !== "no" ? user?.id : undefined | keptFor: undefined
  it("LEAD-BUNCH-DROPS-IGNORED: a kept listing posts with the drops choice in Settings now, not the one it was kept with", async () => {
    h.defaults = { keepUp: true, drops: true, dropPct: 5, floorPct: 78, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
    await startAndEdit();
    await waitFor(() => expect(settingsValue("drops")).toMatch(/^5% each evening, lowest \$\d+$/));
    cleanup();
    // Settings: drops off. Then back to the kept listing.
    h.defaults = { keepUp: true, drops: false, dropPct: 5, floorPct: 78, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
    open();
    await screen.findByText("We kept your listing from last time.");
    await waitFor(() => expect(settingsValue("drops")).toBe("Off"));
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByText("Selling tab");
    // What the server stores: step 0 and the lowest price at the price, so it never drops and the live sheet says none.
    expect(h.drops).toEqual([0]);
    expect(h.floors).toEqual([[4500, 4500]]);
  });
});
