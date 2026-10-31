/**
 * Sell a bunch, the leftovers of the 10-30 bulk audit: unready items come first (15), one tick for the drafts and the
 * list (14), photos dragged at desktop width with a keyboard way too, and each item's buyer card (22).
 *
 * @mutate src/lib/declutter/bunch.ts |   return [...items.filter((it) => bunchItemNeed(it)), ...items.filter((it) => !bunchItemNeed(it))]; |   return items;
 * @mutate src/components/declutter/DeclutterBunchView.tsx | onNeeds={firstUnready ? () => { setItems(unreadyFirst); jumpTo(firstUnready.key); } : null} | onNeeds={firstUnready ? () => { jumpTo(firstUnready.key); } : null}
 * @mutate src/components/declutter/BunchDraftsSection.tsx |           {!listStepShown && <TaxStatementsCheck | {<TaxStatementsCheck
 * @mutate src/components/declutter/DeclutterBunchListStep.tsx | free={items.every((it) => it.free) && !pricedDraftsOffered} | free={items.every((it) => it.free)}
 * @mutate src/lib/declutter/bunch.ts |   while (n < stay.length && it.photoKeys[n] === stay[n]) n += 1; |   n = stay.length;
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx |             <li key={k} draggable={canDrag} | <li key={k} draggable={false}
 * @mutate src/components/declutter/DeclutterBunchRow.tsx |         if (!canDrop \|\| !from \|\| from.item === item.key) return;\n        e.preventDefault();\n        bunchPhotoDrag.end(); |         return;\n        e.preventDefault();\n        bunchPhotoDrag.end();
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |       <BuyerPreviewCard | <BuyerPreviewCardOff
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx |                 onReorder(from.photo, dropBeforeKey(item.photoKeys, from.photo, k)); |                 onReorder(from.photo, k);
 * @mutate src/lib/declutter/bunch.ts |   return keys.indexOf(photoKey) < to ? keys[to + 1] ?? null : targetKey; |   return targetKey;
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem, ListDeps } from "@/lib/declutter/bunch";

const state = vi.hoisted(() => ({
  desktop: true,
  mine: [] as { id: string; status: string; title: string; current_price_cents: number }[],
  withPhotos: [] as string[],
  published: [] as string[][],
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
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/declutter/BunchFeeGate", () => ({ BunchFeeGate: () => null, useSetupFeeDueCents: () => null }));
vi.mock("@/components/declutter/useBunchSaved", () => ({
  useBunchSaved: () => ({ note: null, restoredCount: 0, dismissRestored: () => {}, applyStep: () => {}, clearSaved: () => {} }),
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => ({ state: "idle" }), useMapKitTokenSource: () => "none" }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.4, lng: -91.1 }) }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => state.withPhotos.map((id) => ({ item_id: id })),
  fetchMyPickupWindows: async () => [],
  setPickupWindows: async () => 1,
  requestAiDraftFromPhotos: vi.fn(),
}));
vi.mock("@/lib/declutter/moves", async (orig) => ({
  ...(await orig<object>()),
  fetchMyMoveItems: async () => [],
  fetchMyMoveOutDate: async () => null,
  fetchMyMovingSale: async () => null,
  louisianaToday: () => "2026-10-30",
  publishMany: async (ids: string[]) => { state.published.push(ids); return ids.map((id) => ({ id, status: "live" })); },
}));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  bunchThumbnail: async () => new Blob(["small"], { type: "image/jpeg" }),
  cleanListingPhoto: async (f: File) => f,
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  const sorted = (key: string, photoKeys: string[], extra: Partial<BunchItem>): BunchItem => ({ ...real.blankItem(photoKeys), key, sizeUnknown: false, description: "Solid.", category: "furniture", conditionStars: 4, ...extra });
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[], onProgress: (d: number, t: number, made: BunchItem[]) => void) => {
      const made = [
        sorted("i1", photos.slice(0, 3).map((p) => p.key), { title: "Oak chair", price: "40", aiPrice: "40" }),
        sorted("i2", photos.slice(3, 4).map((p) => p.key), { title: "Brass lamp", price: "15" }),
        sorted("i3", photos.slice(4, 5).map((p) => p.key), { title: "Side table", price: "" }),
      ];
      onProgress(1, 1, made);
      return { items: made, failed: [], unusable: [] };
    },
  };
});

import BunchFlow from "./DeclutterBunchView";
import { blankItem, dropBeforeKey, listBunch, movePhotoWithin, sentPhotosToTakeOff, unreadyFirst } from "@/lib/declutter/bunch";

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  state.desktop = true;
  state.mine = [];
  state.withPhotos = [];
  state.published = [];
});
afterEach(cleanup);

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow moving={false} /></MemoryRouter></QueryClientProvider>);
}
async function open() {
  renderFlow();
  const files = Array.from({ length: 5 }, (_, i) => new File([`${i}`], `${i}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
  await screen.findByRole("heading", { name: /^\d\. Check each item/ });
}
const rowKeys = () => [...document.querySelectorAll<HTMLElement>("[data-bunch-row]")].map((r) => r.getAttribute("data-bunch-row"));
const row = (key: string) => document.querySelector(`[data-bunch-row="${key}"]`) as HTMLElement;
const openRow = (key: string) => fireEvent.click(row(key).querySelector("[data-bunch-expand]")!);
const photoOrder = (key: string) => [...row(key).querySelectorAll("[data-bunch-photo]")].map((b) => b.getAttribute("data-bunch-photo"));
const slot = (key: string, photo: string | null) => row(key).querySelector(`[data-bunch-photo-slot="${photo}"]`)!;
const drag = { dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } };

describe("finding 15: what's left comes first", () => {
  it("unreadyFirst keeps each group's order and puts what needs something on top", () => {
    const a = { ...blankItem(["1"]), key: "a", title: "Alpha chair", price: "5", sizeUnknown: false };
    const b = { ...blankItem(["2"]), key: "b", title: "", price: "5", sizeUnknown: false };
    const c = { ...blankItem(["3"]), key: "c", title: "Cedar chest", price: "", sizeUnknown: false };
    expect(unreadyFirst([a, b, c]).map((i) => i.key)).toEqual(["b", "c", "a"]);
    expect(unreadyFirst([a]).map((i) => i.key)).toEqual(["a"]);
  });

  it("tapping what's left lifts that item to the top; typing a price doesn't move a row", async () => {
    await open();
    expect(rowKeys()).toEqual(["i1", "i2", "i3"]);
    fireEvent.change(row("i2").querySelector("input[aria-label='Price ($)']")!, { target: { value: "16" } });
    expect(rowKeys()).toEqual(["i1", "i2", "i3"]);
    fireEvent.click(document.querySelector("[data-bunch-needs]")!);
    await waitFor(() => expect(rowKeys()).toEqual(["i3", "i1", "i2"]));
  });
});

describe("finding 14: one tick on the page", () => {
  const twoDrafts = () => {
    state.mine = [
      { id: "d1", status: "draft", title: "Saved mirror", current_price_cents: 3000 },
      { id: "d2", status: "draft", title: "Saved rug", current_price_cents: 2000 },
    ];
    state.withPhotos = ["d1", "d2"];
  };
  const section = () => waitFor(() => {
    const s = document.querySelector("[data-bunch-drafts]") as HTMLElement | null;
    expect(s).toBeTruthy();
    return s!;
  });

  it("with items on the list there's one tick set, in the last step, and it covers the drafts too", async () => {
    twoDrafts();
    await open();
    const drafts = await section();
    expect(document.getElementById("bunch-drafts-tax")).toBeNull();
    expect(document.querySelectorAll("[data-tax-statements]")).toHaveLength(1);

    const list = () => within(drafts).getByRole("button", { name: "List all my drafts" }) as HTMLButtonElement;
    await waitFor(() => expect(list().disabled).toBe(false));
    fireEvent.click(list());
    expect(drafts.textContent).toContain("Tick the box");
    expect(document.activeElement?.id).toBe("bunch-tax");
    expect(state.published).toEqual([]);

    fireEvent.click(document.getElementById("bunch-tax")!);
    fireEvent.click(list());
    await waitFor(() => expect(state.published).toEqual([["d1", "d2"]]));
  });

  it("with no items on the list, the drafts carry the tick themselves", async () => {
    twoDrafts();
    renderFlow();
    await waitFor(() => expect(document.getElementById("bunch-drafts-tax")).toBeTruthy());
    expect(document.querySelectorAll("[data-tax-statements]")).toHaveLength(1);
  });

  it("all free items but a priced draft on offer: the four statements show, not the free wording", async () => {
    twoDrafts();
    await open();
    await section();
    for (const key of rowKeys()) {
      openRow(key!);
      fireEvent.click(within(row(key!)).getByRole("checkbox", { name: /^Give .* away free$/ }));
    }
    await waitFor(() => expect(document.querySelector("[data-tax-statements='']")).toBeTruthy());
    expect(document.querySelector("[data-tax-statements='free']")).toBeNull();
  });
});

describe("moving photos at desktop width, and a way without a mouse", () => {
  it("a forward drag takes the target's place, not the place before it", () => {
    const keys = ["a", "b", "c", "d"];
    const moved = (photo: string, target: string) => movePhotoWithin([{ ...blankItem(keys), key: "x" }], "x", photo, dropBeforeKey(keys, photo, target))[0].photoKeys;
    expect(moved("a", "b")).toEqual(["b", "a", "c", "d"]);
    expect(moved("a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moved("a", "d")).toEqual(["b", "c", "d", "a"]);
    expect(moved("b", "c")).toEqual(["a", "c", "b", "d"]);
    // Back, unchanged.
    expect(moved("d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(moved("c", "b")).toEqual(["a", "c", "b", "d"]);
    expect(moved("b", "b")).toEqual(keys);
  });

  it("movePhotoWithin puts a photo before another, or last", () => {
    const one = { ...blankItem(["a", "b", "c"]), key: "x" };
    expect(movePhotoWithin([one], "x", "c", "a")[0].photoKeys).toEqual(["c", "a", "b"]);
    expect(movePhotoWithin([one], "x", "a", "c")[0].photoKeys).toEqual(["b", "a", "c"]);
    expect(movePhotoWithin([one], "x", "a", null)[0].photoKeys).toEqual(["b", "c", "a"]);
    expect(movePhotoWithin([one], "x", "nope", "a")[0].photoKeys).toEqual(["a", "b", "c"]);
    expect(movePhotoWithin([one], "other", "a", null)[0].photoKeys).toEqual(["a", "b", "c"]);
  });

  it("dropping a photo on another of the same item reorders it, so the cover changes", async () => {
    await open();
    openRow("i1");
    const before = photoOrder("i1");
    expect(slot("i1", before[2]).getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(slot("i1", before[2]), drag);
    fireEvent.dragOver(slot("i1", before[0]), drag);
    fireEvent.drop(slot("i1", before[0]), drag);
    expect(photoOrder("i1")).toEqual([before[2], before[0], before[1]]);
  });

  it("dropping the first photo on the last puts it last, not one short", async () => {
    await open();
    openRow("i1");
    const before = photoOrder("i1");
    fireEvent.dragStart(slot("i1", before[0]), drag);
    fireEvent.dragOver(slot("i1", before[2]), drag);
    fireEvent.drop(slot("i1", before[2]), drag);
    expect(photoOrder("i1")).toEqual([before[1], before[2], before[0]]);
  });

  it("dropping a photo on another item's row moves it there, and Undo brings it back", async () => {
    await open();
    openRow("i1");
    const before = photoOrder("i1");
    fireEvent.dragStart(slot("i1", before[1]), drag);
    fireEvent.dragOver(row("i2"), drag);
    expect(row("i2").getAttribute("data-bunch-drop-on")).toBe("");
    fireEvent.drop(row("i2"), drag);
    expect(row("i2").getAttribute("data-bunch-drop-on")).toBeNull();
    expect(photoOrder("i1")).toEqual([before[0], before[2]]);
    openRow("i2");
    expect(photoOrder("i2")).toContain(before[1]);
    fireEvent.click(within(document.querySelector("[data-bunch-undo]") as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(photoOrder("i1")).toEqual(before);
  });

  it("a file dragged in from the computer moves nothing", async () => {
    await open();
    openRow("i1");
    const before = photoOrder("i1");
    fireEvent.dragOver(row("i2"), drag);
    expect(row("i2").getAttribute("data-bunch-drop-on")).toBeNull();
    fireEvent.drop(row("i2"), drag);
    expect(photoOrder("i1")).toEqual(before);
  });

  it("on a phone nothing is draggable, and the photo's sheet moves it earlier and later instead", async () => {
    state.desktop = false;
    await open();
    openRow("i1");
    const before = photoOrder("i1");
    expect(slot("i1", before[0]).getAttribute("draggable")).not.toBe("true");
    fireEvent.click(row("i1").querySelector(`[data-bunch-photo="${before[1]}"]`)!);
    const sheet = () => document.querySelector("[data-bunch-photo-sheet]") as HTMLElement;
    await waitFor(() => expect(sheet()).toBeTruthy());
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move earlier" }));
    expect(photoOrder("i1")).toEqual([before[1], before[0], before[2]]);
    expect(within(sheet()).queryByRole("button", { name: "Move earlier" })).toBeNull();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move later" }));
    expect(photoOrder("i1")).toEqual(before);
  });
});

describe("a new photo order reaches a draft that already has photos", () => {
  const f = (k: string) => new File([k], `${k}.jpg`);
  const files = new Map(["a", "b", "c", "d"].map((k) => [k, f(k)]));
  const withSent = (photoKeys: string[]) => ({ ...blankItem(photoKeys), uploaded: { a: "pa", b: "pb", c: "pc" } });

  it("sentPhotosToTakeOff: only what moved off or lost its place", () => {
    expect(sentPhotosToTakeOff(withSent(["a", "b", "c"]), files)).toEqual([]);
    expect(sentPhotosToTakeOff(withSent(["a", "b", "c", "d"]), files)).toEqual([]);
    expect(sentPhotosToTakeOff(withSent(["a", "c"]), files)).toEqual(["b"]);
    expect(sentPhotosToTakeOff(withSent(["c", "a", "b"]), files)).toEqual(["a", "b", "c"]);
    expect(sentPhotosToTakeOff(withSent(["a", "c", "b"]), files)).toEqual(["b", "c"]);
    expect(sentPhotosToTakeOff(withSent(["d", "a", "b", "c"]), files)).toEqual(["a", "b", "c"]);
  });

  it("a photo whose file is gone isn't taken off: the old order beats losing it", () => {
    const missing = new Map([["a", f("a")], ["b", f("b")]]);
    expect(sentPhotosToTakeOff(withSent(["c", "a", "b"]), missing)).toEqual([]);
  });

  it("listBunch sends a new cover first on a retried draft", async () => {
    const real = (await vi.importActual<typeof import("@/lib/declutter/bunch")>("@/lib/declutter/bunch")).listBunch as typeof listBunch;
    const order: string[] = [];
    const removed: string[] = [];
    const deps = {
      createDraft: async () => "new",
      createMoveDraft: async () => "new",
      updateDraft: async () => {},
      addPhoto: async (_s: string, _i: string, file: File) => {
        order.push(file.name);
        return `sent-${file.name}`;
      },
      removePhoto: async (id: string) => {
        removed.push(id);
      },
      itemStatuses: async () => new Map([["draft-1", "draft"]]),
      withdrawItem: async () => {},
      setHandovers: async () => {},
      setDropPct: async () => {},
      setKeepUp: async () => {},
      publishMany: async (ids: string[]) => ids.map((id) => ({ id, status: "live" })),
    } as unknown as ListDeps;
    const item: BunchItem = { ...blankItem(["c", "a", "b"]), key: "x", title: "Chair", price: "40", description: "Solid.", category: "furniture", sizeUnknown: false, draftId: "draft-1", uploaded: { a: "pa", b: "pb", c: "pc" } };
    const progress: { photo: number; of: number }[] = [];
    await real("s", [item], files, { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30, pickupLng: -91 }, ["porch"], () => {}, deps, undefined, undefined, (p) => progress.push(p));
    expect(removed).toEqual(["pa", "pb", "pc"]);
    expect(order).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
    expect(progress[progress.length - 1]).toMatchObject({ photo: 3, of: 3 });
  });
});

describe("finding 22: what buyers see, in the row", () => {
  it("an open row with a name and a price shows the buyer's card; a free one says Free", async () => {
    await open();
    openRow("i1");
    const card = () => row("i1").querySelector("[data-sell-preview]") as HTMLElement | null;
    expect(card()?.textContent).toContain("What buyers see");
    expect(card()?.textContent).toContain("Oak chair");
    expect(card()?.textContent).toContain("$40");
    fireEvent.click(within(row("i1")).getByRole("checkbox", { name: "Give Oak chair away free" }));
    expect(card()?.textContent).toContain("Free");
  });

  it("no price: no card, so it never shows a half-made listing", async () => {
    await open();
    openRow("i3");
    expect(row("i3").querySelector("[data-sell-preview]")).toBeNull();
  });
});
