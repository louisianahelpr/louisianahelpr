/**
 * @mutate src/lib/declutter/bunchSaved.ts |         await set(photoPrefix + photo.key, await photo.file.arrayBuffer()); |         throw blobRefused;
 * @mutate src/components/declutter/useDeviceSaved.ts |     window.addEventListener("pagehide", now); |     void now;
 * @mutate src/components/declutter/useDeviceSaved.ts |       if (document.visibilityState === "hidden") flush(); |       void 0;
 * @mutate src/lib/declutter/bunchSaved.ts |     return { bunch: kept, moving: kept && | return { bunch: false, moving: kept &&
 * Sell a bunch audit finding 2: reload, the back link, a killed tab or a crash lost every photo and every word, with no
 * warning. The store is mocked with an in-memory idb-keyval (jsdom has no IndexedDB); the real one is a browser check.
 *
 * @mutate src/components/declutter/useDeviceSaved.ts |     window.addEventListener("beforeunload", warnNow); |     void warnNow;
 * @mutate src/components/declutter/useDeviceSaved.ts |     const t = setTimeout(flush, SAVE_DELAY_MS); |     const t = setTimeout(() => {}, SAVE_DELAY_MS);
 * @mutate src/components/declutter/useBunchSaved.ts |   if (s.sorting) return s.photos;\n | \n
 * @mutate src/components/declutter/useBunchSaved.ts |   return s.photos.filter((p) => held.has(p.key));\n}\n\n/** Items and | \n  return s.photos;\n}\n\n/** Items and
 * @mutate src/lib/declutter/bunch.ts |     else unusable.push({ key: p.key, name: p.file.name, error: r.error });\n  }\n  return { photos: kept, unusable }; |     else kept.push(p);\n  }\n  return { photos: kept, unusable };
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       setSortNote(unusablePhotosNote(back.unusable)); |       void back.unusable;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     for (const { id, item } of draftsLeftBehind(items, next)) void takeDownDraft(id, item); |     void next;
 * @mutate src/components/declutter/DeclutterBunchView.tsx | with their photos{items.some((it) => it.price.trim() !== "") ? " and prices" : ""}. | with their photos and prices.
 * @mutate src/lib/declutter/bunchSaved.ts |   if (saved.userId !== userId \|\| now - saved.savedAt > MAX_AGE_MS) { |   if (false) {
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |   const continueTo = kept.data?.bunch && kept.data.one ? { to: undefined } : kept.data?.bunch ? { to: bunchTo } |   const continueTo = kept.data?.bunch && kept.data.one ? { to: bunchTo } : kept.data?.bunch ? { to: bunchTo }
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | onClick={continueTo.to ? undefined : () => setChoosingKept(true)} | onClick={undefined}
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <ChoiceCard compact data-kept-choice="one" to={SELL_ONE_PATH} | <ChoiceCard compact data-kept-choice="one" to={SELL_BUNCH_PATH}
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem, BunchPhoto } from "@/lib/declutter/bunch";

const { ListingPhotoError } = await vi.hoisted(async () => await import("@/lib/declutter/errors"));
const h = vi.hoisted(() => ({ refuseBlobs: false,
  /** The sort never answers: the seller is still mid-sort when the page goes. */
  hang: false,
  withdrawn: [] as string[],
  statuses: new Map<string, string>(),
  disk: new Map<string, unknown>(),
  failWrites: false,
  /** LEAD-BUNCH-34-SLOW: photo writes after this many never finish (a phone still writing big photos when the page goes). */
  photoWritesFinish: Infinity,
  user: "u1",
}));

// LEAD-BUNCH-34-SLOW: no early photo uploads here (they would reach prod storage); declutterBunchEarlyUpload.test.ts pins them.
vi.mock("@/lib/declutter/bunchStage", () => ({
  BunchStager: class {
    idFor() { return undefined; }
    path() { return Promise.resolve(null); }
    used() {}
    sync() { return new Map(); }
  },
}));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.disk.get(k),
  set: async (k: string, v: unknown) => {
    if (h.failWrites) throw new Error("quota");
    if (k.includes("-photo:") && [...h.disk.keys()].filter((x) => x.includes("-photo:")).length >= h.photoWritesFinish) await new Promise(() => {});
    if (h.refuseBlobs && v instanceof Blob) throw new Error("UnknownError: blobs aren't stored in this session");
    h.disk.set(k, v);
  },
  del: async (k: string) => void h.disk.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => h.disk.delete(k)),
  keys: async () => [...h.disk.keys()],
  createStore: () => ({}),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: h.user }, profile: { onboarding_fee_paid: true }, isAdmin: false, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.4, lng: -91.1 }) }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchMyItems: async () => [], fetchMyPickupWindows: async () => [], fetchHasAgreedSales: async () => false, fetchItemStatuses: async () => h.statuses, withdrawItem: async (id: string) => void h.withdrawn.push(id) }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  bunchThumbnail: async (f: File) => f,
  cleanListingPhoto: async (f: File) => {
    if (f.name.startsWith("bad")) throw new ListingPhotoError("This photo can't be used. Try another one.");
    return f;
  },
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[], onProgress: (done: number, total: number, made: BunchItem[]) => void) => {
      if (h.hang) await new Promise(() => {});
      const items = [
        { key: "i1", photoKeys: [photos[0].key], title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "" } as BunchItem,
        { key: "i2", photoKeys: [photos[1].key], title: "Floor lamp", description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "" } as BunchItem,
      ];
      onProgress(1, 1, items);
      return { items, failed: [], unusable: [] };
    },
  };
});

import BunchFlow from "./DeclutterBunchView";
import SellChooser from "./DeclutterSellChooser";
import { clearSavedBunch, loadSavedBunch } from "@/lib/declutter/bunchSaved";
import { photosToSave } from "./useBunchSaved";

const openRows = () => document.querySelectorAll<HTMLElement>('[data-bunch-expand][aria-expanded="false"]').forEach((b) => fireEvent.click(b));
function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
}

const META = "lh-bunch-v1";
const savedMeta = () => h.disk.get(META) as { items: BunchItem[]; photos: { key: string }[]; pickupAddress: string } | undefined;
const photoEntries = () => [...h.disk.keys()].filter((k) => k.startsWith("lh-bunch-v1-photo:"));

async function pickTwoPhotos() {
  await new Promise((r) => setTimeout(r, 0));
  const files = ["a", "b"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
  await screen.findByRole("heading", { name: /^3\. Check each item/ });
}

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  h.disk.clear();
  h.failWrites = false;
  h.photoWritesFinish = Infinity;
  h.hang = false;
  h.user = "u1";
  h.withdrawn = [];
  h.statuses = new Map();
});
afterEach(cleanup);

describe("a session that refuses a File stores the photo's bytes (WebKit's throwaway session, measured 10-30)", () => {
  it("the photo comes back whole, as a file with its name and type, and no one is told it wasn't saved", async () => {
    const { deviceStore } = await import("@/lib/declutter/bunchSaved");
    h.refuseBlobs = true;
    try {
      const store = deviceStore<{ userId: string; savedAt: number; photos: { key: string; name: string; type: string }[] }>("lh-test-bytes");
      await store.savePhoto({ key: "k1", file: new File(["photo-bytes"], "a.jpg", { type: "image/jpeg" }) });
      expect(h.disk.get("lh-test-bytes-photo:k1")).toBeInstanceOf(ArrayBuffer);
      await store.saveMeta({ userId: "u1", savedAt: Date.now(), photos: [{ key: "k1", name: "a.jpg", type: "image/jpeg" }] });
      const back = await store.load("u1");
      expect(back?.photos[0].file.name).toBe("a.jpg");
      expect(back?.photos[0].file.type).toBe("image/jpeg");
      expect(await back?.photos[0].file.text()).toBe("photo-bytes");
      await store.clearNow();
    } finally {
      h.refuseBlobs = false;
    }
  });
});

describe("which photos a saved bunch keeps", () => {
  const photo = (key: string) => ({ key }) as unknown as BunchPhoto;
  const item = (photoKeys: string[]) => ({ photoKeys }) as unknown as BunchItem;
  const keys = (s: Parameters<typeof photosToSave>[0]) => photosToSave(s).map((p) => p.key);

  it("mid-sort, no item holds a photo yet: every one is kept, so a crash loses none of the seller's photos", () => {
    expect(keys({ photos: [photo("a"), photo("b")], items: [], sorting: true })).toEqual(["a", "b"]);
    expect(keys({ photos: [photo("a"), photo("b")], items: [item(["a"])], sorting: true })).toEqual(["a", "b"]);
  });

  it("sorted: each photo an item holds is kept, and one no item holds is not", () => {
    expect(keys({ photos: [photo("a"), photo("b"), photo("gone")], items: [item(["a"]), item(["b"])], sorting: false })).toEqual(["a", "b"]);
  });
});

describe("Sell a bunch survives leaving", () => {
  it("photos, the written words, prices and the address come back after the page goes away", async () => {
    const first = renderFlow();
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    await pickTwoPhotos();
    const cards = document.querySelectorAll("[data-bunch-item]");
    fireEvent.change(within(cards[0] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    await waitFor(() => expect(savedMeta()?.items[0]?.price).toBe("40"));
    expect(photoEntries()).toHaveLength(2);
    first.unmount();

    renderFlow();
    expect((await screen.findByText(/We kept your work from last time: 2 items/)).textContent).toContain("with their photos and prices.");
    const back = document.querySelectorAll("[data-bunch-item]");
    expect(back).toHaveLength(2);
    openRows();
    expect((within(back[0] as HTMLElement).getByLabelText("Title") as HTMLInputElement).value).toBe("Oak chair");
    expect((within(back[0] as HTMLElement).getByLabelText("Price ($)") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Pickup address") as HTMLInputElement).value).toBe("1 Main St, Baton Rouge");
    await waitFor(() => expect(back[0].querySelectorAll("[data-bunch-thumb]")).toHaveLength(1));
  });

  // LEAD-BUNCH-DRAFT-KEEP (owner 10-31): 3 photos in, then shake-to-report loaded another page; back, all work was gone.
  async function pickThreeMidSort() {
    h.hang = true;
    await new Promise((r) => setTimeout(r, 0));
    const files = ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
    await new Promise((r) => setTimeout(r, 0));
  }
  async function threeComeBack() {
    h.hang = false;
    renderFlow();
    expect(await screen.findByRole("heading", { name: "3 photos not sorted yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sort again" })).toBeTruthy();
  }

  it("3 photos mid-sort, the screen goes (unmount) before the save delay: coming back brings all 3 back", async () => {
    const first = renderFlow();
    await pickThreeMidSort();
    first.unmount();
    await waitFor(() => expect(photoEntries()).toHaveLength(3));
    await threeComeBack();
  });

  it("3 photos mid-sort, a full page load (pagehide, no React cleanup): saved at once, before the save delay", async () => {
    const first = renderFlow();
    await pickThreeMidSort();
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(photoEntries()).toHaveLength(3), { timeout: 150 });
    expect(savedMeta()?.photos).toHaveLength(3);
    first.unmount();
    await threeComeBack();
  });

  // LEAD-BUNCH-34-SLOW (owner 10-31: "every time you close the website you lose what you did"): the small record was
  // written once, after EVERY photo, so a page closed while the phone was still writing big photos kept none of them.
  // @mutate src/components/declutter/useDeviceSaved.ts |         onDisk.current.add(x.key);\n        await saveMeta();\n |         onDisk.current.add(x.key);\n
  it("5 photos, the page closes while the 4th is still being written: the 3 written come back", async () => {
    const first = renderFlow();
    h.photoWritesFinish = 3;
    h.hang = true;
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["a", "b", "c", "d", "e"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(savedMeta()?.photos).toHaveLength(3), { timeout: 300 });
    first.unmount();
    h.hang = false;
    h.photoWritesFinish = Infinity;
    renderFlow();
    expect(await screen.findByRole("heading", { name: "3 photos not sorted yet" })).toBeTruthy();
  });

  it("5 photos added, the page closes, reopened: all 5 are back", async () => {
    const first = renderFlow();
    h.hang = true;
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["a", "b", "c", "d", "e"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(savedMeta()?.photos).toHaveLength(5), { timeout: 300 });
    first.unmount();
    h.hang = false;
    renderFlow();
    expect(await screen.findByRole("heading", { name: "5 photos not sorted yet" })).toBeTruthy();
  });

  it("the app goes to the background mid-sort (hidden): saved at once", async () => {
    const first = renderFlow();
    await pickThreeMidSort();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(photoEntries()).toHaveLength(3), { timeout: 150 });
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
    first.unmount();
  });

  it("the Sell chooser offers Continue where you left off for this member's kept work, and only theirs", async () => {
    const chooser = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SellChooser /></MemoryRouter></QueryClientProvider>);
    const view = chooser();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Continue where you left off")).toBeNull();
    view.unmount();
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, items: [], photos: [{ key: "a", name: "a.jpg", type: "image/jpeg" }] });
    const again = chooser();
    expect((await screen.findByText("Continue where you left off")).closest("a")).toHaveAttribute("href", "/declutter/sell?mode=bunch");
    again.unmount();
    h.disk.set(META, { ...(h.disk.get(META) as object), moveDate: "2026-11-20" });
    const moving = chooser();
    expect((await screen.findByText("Continue where you left off")).closest("a")).toHaveAttribute("href", "/declutter/sell?mode=moving");
    moving.unmount();
    h.disk.set("lh-sell-one-v1", { userId: "u1", savedAt: Date.now(), photos: [] });
    h.disk.set(META, { ...(h.disk.get(META) as object), userId: "someone-else" });
    const one = chooser();
    expect((await screen.findByText("Continue where you left off")).closest("a")).toHaveAttribute("href", "/declutter/sell");
    one.unmount();
    // LEAD chooser fit (10-31): both kinds kept is still ONE row (the chooser must fit 375x812); it opens a small choice.
    h.disk.set(META, { ...(h.disk.get(META) as object), userId: "u1" });
    chooser();
    const row = await screen.findByText("Continue where you left off");
    expect(screen.getAllByText("Continue where you left off")).toHaveLength(1);
    expect(document.querySelectorAll('[data-sell-choice^="continue"]')).toHaveLength(1);
    expect(row.closest("a")).toBeNull();
    fireEvent.click(row.closest("button")!);
    const sheet = await waitFor(() => { const el = document.querySelector("[data-kept-work]"); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect([...sheet.querySelectorAll("[data-kept-choice]")].map((a) => a.getAttribute("href"))).toEqual(["/declutter/sell?mode=moving", "/declutter/sell"]);
  });

  it("leaving before the save delay still saves (the back link)", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(savedMeta()?.items).toHaveLength(2));
    const cards = document.querySelectorAll("[data-bunch-item]");
    fireEvent.change(within(cards[1] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "15" } });
    first.unmount();
    await waitFor(() => expect(savedMeta()?.items[1]?.price).toBe("15"));
  });

  it("warns before the tab closes only while there is work to lose", async () => {
    renderFlow();
    await new Promise((r) => setTimeout(r, 0));
    const empty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    await pickTwoPhotos();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("a dropped item's photo is removed, so it never comes back", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(photoEntries()).toHaveLength(2));
    openRows();
    fireEvent.click(within(document.querySelectorAll("[data-bunch-item]")[1] as HTMLElement).getByRole("button", { name: /^Don't sell/ }));
    await waitFor(() => expect(photoEntries()).toHaveLength(1));
    first.unmount();
    renderFlow();
    await screen.findByText(/We kept your work from last time: 1 item,/);
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
  });

  it("a photo mid-sort at a crash that can't be cleaned is named and left out, never a blank item that fails at listing", async () => {
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, items: [], photos: [{ key: "ok", name: "ok.jpg", type: "image/jpeg" }, { key: "x", name: "bad.jpg", type: "image/jpeg" }] });
    h.disk.set("lh-bunch-v1-photo:ok", new File(["o"], "ok.jpg", { type: "image/jpeg" }));
    h.disk.set("lh-bunch-v1-photo:x", new File(["x"], "bad.jpg", { type: "image/jpeg" }));
    renderFlow();
    expect((await screen.findByText(/This photo wasn't added \(bad\.jpg\)/)).textContent).toContain("can't be used");
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
    // Nothing was priced mid-sort, so the banner doesn't promise prices (T3, 10-30).
    expect((await screen.findByText(/We kept your work from last time: 1 item,/)).textContent).toContain("with their photos.");
    await waitFor(() => expect(photoEntries()).toEqual(["lh-bunch-v1-photo:ok"]));
  });

  // The owner's bug, the way a page iOS closed mid-sort reached it: one wordless item per photo, and no word about why.
  // @mutate src/components/declutter/useBunchSaved.ts |   return orphans.length > 0 ? addSorted(kept, [notSortedPile(orphans, PILE_PAGE_CLOSED)]) : kept; |   return [...kept, ...orphans.map((k) => ({ ...notSortedPile([k], ""), notSorted: false }))];
  it("photos mid-sort when the page closed come back together with why, not as an item each", async () => {
    const names = ["a", "b", "c"];
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, items: [], photos: names.map((n) => ({ key: n, name: `${n}.jpg`, type: "image/jpeg" })) });
    for (const n of names) h.disk.set(`lh-bunch-v1-photo:${n}`, new File([n], `${n}.jpg`, { type: "image/jpeg" }));
    renderFlow();
    expect(await screen.findByRole("heading", { name: "3 photos not sorted yet" })).toBeTruthy();
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
    expect(document.querySelector("[data-bunch-not-sorted-reason]")?.textContent).toContain("page closed");
    expect(screen.getByRole("button", { name: "Sort again" })).toBeTruthy();
  });

  // @mutate src/components/declutter/DeclutterBunchView.tsx |     setItems((its) => its.filter((it) => it.key !== key));\n    await sortPhotos(batch); |     await sortPhotos(batch);
  it("Sort again replaces the pile with the sorted items", async () => {
    const names = ["a", "b"];
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, items: [], photos: names.map((n) => ({ key: n, name: `${n}.jpg`, type: "image/jpeg" })) });
    for (const n of names) h.disk.set(`lh-bunch-v1-photo:${n}`, new File([n], `${n}.jpg`, { type: "image/jpeg" }));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Sort again" }));
    await screen.findByRole("button", { name: /Oak chair/ });
    expect(screen.queryByRole("heading", { name: /not sorted yet/ })).toBeNull();
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2);
  });

  // @mutate src/components/declutter/DeclutterBunchView.tsx | onOneItem={() => { setOpenRows((m) => new Map(m).set(it.key, true)); setItems((its) => editBunchItem(its, it.key, { notSorted: false, sortReason: undefined })); }} | onOneItem={() => {}}
  it("These are one item makes one item with no words yet, offering to write it", async () => {
    const names = ["a", "b"];
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, items: [], photos: names.map((n) => ({ key: n, name: `${n}.jpg`, type: "image/jpeg" })) });
    for (const n of names) h.disk.set(`lh-bunch-v1-photo:${n}`, new File([n], `${n}.jpg`, { type: "image/jpeg" }));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "These are one item" }));
    expect(await screen.findByRole("button", { name: /^Write it with AI/ })).toBeTruthy();
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
    expect(document.querySelector("[data-bunch-not-sorted]")).toBeNull();
  });

  it("Don't sell this on an item with a draft takes the draft off the server; an item without one asks nothing", async () => {
    h.statuses = new Map([["d1", "draft"]]);
    const base = { description: "", category: "other", deliverySize: "large", conditionStars: 3, flagged: false, price: "40" };
    h.disk.set(META, { userId: "u1", savedAt: Date.now(), areaLabel: "", pickupAddress: "", coords: null, photos: [{ key: "a", name: "a.jpg", type: "image/jpeg" }, { key: "b", name: "b.jpg", type: "image/jpeg" }], items: [{ ...base, key: "plain", photoKeys: ["a"], title: "No draft" }, { ...base, key: "made", photoKeys: ["b"], title: "Has draft", draftId: "d1", uploaded: { b: "pb" } }] });
    h.disk.set("lh-bunch-v1-photo:a", new File(["a"], "a.jpg", { type: "image/jpeg" }));
    h.disk.set("lh-bunch-v1-photo:b", new File(["b"], "b.jpg", { type: "image/jpeg" }));
    renderFlow();
    await screen.findByText(/We kept your work from last time: 2 items/);
    const cards = () => [...document.querySelectorAll("[data-bunch-item]")] as HTMLElement[];
    openRows();
    fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Don't sell/ }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(h.withdrawn).toEqual([]);
    fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Don't sell/ }));
    await waitFor(() => expect(h.withdrawn).toEqual(["d1"]));
  });

  it("Start over asks first, then removes it from the device", async () => {
    const first = renderFlow();
    await pickTwoPhotos();
    await waitFor(() => expect(photoEntries()).toHaveLength(2));
    first.unmount();
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Start over" }));
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(h.disk.size).toBe(0));
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(0);
  });

  it("says so when it can't save, and the work on screen is untouched", async () => {
    h.failWrites = true;
    renderFlow();
    await pickTwoPhotos();
    expect(await screen.findByText(/We couldn't save your work on this device/)).toBeTruthy();
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2);
  });

  it("another member never gets it, and it is removed", async () => {
    h.disk.set(META, { userId: "someone-else", savedAt: Date.now(), areaLabel: "", pickupAddress: "Their street", coords: null, photos: [], items: [] });
    expect(await loadSavedBunch("u1")).toBeNull();
    expect(h.disk.has(META)).toBe(false);
  });

  it("an old one is removed after 7 days", async () => {
    h.disk.set(META, { userId: "u1", savedAt: 0, areaLabel: "", pickupAddress: "Old", coords: null, photos: [], items: [] });
    expect(await loadSavedBunch("u1", 8 * 24 * 3_600_000)).toBeNull();
    expect(h.disk.has(META)).toBe(false);
  });

  it("sign-out's clear removes every entry", async () => {
    h.disk.set(META, {});
    h.disk.set("lh-bunch-v1-photo:p1", new Blob(["x"]));
    h.disk.set("unrelated", 1);
    await clearSavedBunch();
    expect([...h.disk.keys()]).toEqual(["unrelated"]);
  });
});
