/**
 * LEAD-RESUME-REPOSTS, the Sell a bunch side (owner 2026-10-31 13:56): "Continue where you left off" offered Sell a
 * bunch items she had already posted, and posting them made duplicates. Prod, read-only (B21): c02c2728 and 8c729277
 * were created 18:56:18 and 18:56:20Z, two seconds apart (one run), copies of her live c87b7de4 and 019dd0b3.
 * Three locks, each red on the old code:
 *   1. the page never brings back a kept item the server already has as posted (draft or app id), nor its photos,
 *      and kept work that is all posted is forgotten;
 *   2. the chooser's offer skips kept work whose every item is posted;
 *   3. listing never makes a second copy: each item's draft is asked for with an app id saved first, and an id that is
 *      already posted (status read, or AlreadyPosted from the server) leaves the list unlisted.
 *
 * @mutate src/components/declutter/useBunchSaved.ts |       const fresh = withoutPosted(found.saved.items, found.photos, statuses); |       const fresh = withoutPosted(found.saved.items, found.photos, null);
 * @mutate src/components/declutter/useBunchSaved.ts |       if (back.length === 0 && fresh.posted > 0) { |       if (false) {
 * @mutate src/lib/declutter/bunch.ts |   const kept = items.filter((it) => !isPosted(it.draftId) && !isPosted(it.appId)); |   const kept = items.filter((it) => !isPosted(it.draftId));
 * @mutate src/lib/declutter/bunchSaved.ts |     const kept = mine(bunch) && !(await allPosted(bunch!, itemStatuses)); |     const kept = mine(bunch);
 * @mutate src/lib/declutter/bunchSaved.ts |     const oneKept = mine(one) && !(await onePosted( |     const oneKept = mine(one) \|\| !(await onePosted(
 * @mutate src/lib/declutter/bunch.ts |             : await deps.createDraft(fields, appId); |             : await deps.createDraft(fields);
 * @mutate src/lib/declutter/bunch.ts |     if (byAppId !== undefined && it.appId) { |     if (false) {
 * @mutate src/lib/declutter/bunch.ts |          if (err instanceof AlreadyPosted) { |          if (false) {
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       if (items.every((it) => gone.has(it.key))) saved.clearSaved(); |       void gone;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, waitFor } from "@testing-library/react";
import type { BunchItem } from "@/lib/declutter/bunch";

const h = vi.hoisted(() => ({ disk: new Map<string, unknown>(), statuses: new Map<string, string>() }));

vi.mock("idb-keyval", () => ({
  get: async (k: string) => h.disk.get(k),
  set: async (k: string, v: unknown) => void h.disk.set(k, v),
  del: async (k: string) => void h.disk.delete(k),
  delMany: async (ks: string[]) => ks.forEach((k) => h.disk.delete(k)),
  keys: async () => [...h.disk.keys()],
  createStore: () => ({}),
}));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<object>()), fetchItemStatuses: async (ids: string[]) => new Map(ids.flatMap((id) => (h.statuses.has(id) ? [[id, h.statuses.get(id)!]] : []))) }));
vi.mock("@/lib/declutter/photos", async (orig) => ({ ...(await orig<object>()), cleanListingPhoto: async (f: File) => f }));

const { AlreadyPosted } = await import("@/lib/declutter/api");
const { blankItem, listBunch, withoutPosted } = await import("@/lib/declutter/bunch");
const { savedSellWork } = await import("@/lib/declutter/bunchSaved");
const { useBunchSaved } = await import("@/components/declutter/useBunchSaved");
type ListDeps = import("@/lib/declutter/bunch").ListDeps;

const bag = (key: string, extra: Partial<BunchItem> = {}): BunchItem => ({ ...blankItem([`${key}-p`]), key, title: `Sleeping bag ${key}`, price: "25", sizeUnknown: false, ...extra });

/** The owner's kept work: two bags, both already posted from an earlier run. */
function keepOnDisk(items: BunchItem[]) {
  h.disk.set("lh-bunch-v1", {
    userId: "owner", savedAt: Date.now(), areaLabel: "Delcambre", pickupAddress: "1 Main St", coords: null, moveDate: "", items,
    photos: items.flatMap((it) => it.photoKeys.map((k) => ({ key: k, name: `${k}.jpg`, type: "image/jpeg" }))),
  });
  for (const it of items) for (const k of it.photoKeys) h.disk.set(`lh-bunch-v1-photo:${k}`, new File([k], `${k}.jpg`, { type: "image/jpeg" }));
}

beforeEach(() => {
  h.disk.clear();
  h.statuses.clear();
});

describe("the page never brings back an item that is already posted", () => {
  const snapshot = { areaLabel: "", pickupAddress: "", coords: null, moveDate: "", photos: [], items: [], sorting: false, finished: false };

  it("kept work whose items are all posted offers nothing and is forgotten", async () => {
    keepOnDisk([bag("navy", { draftId: "c87b7de4" }), bag("red", { appId: "019dd0b3" })]);
    h.statuses.set("c87b7de4", "live").set("019dd0b3", "live");
    const onRestore = vi.fn();
    const { result } = renderHook(() => useBunchSaved("owner", snapshot, () => {}, onRestore));
    await waitFor(() => expect(h.disk.has("lh-bunch-v1")).toBe(false));
    expect(onRestore).not.toHaveBeenCalled();
    expect(result.current.restoredCount).toBe(0);
  });

  it("only the posted ones are left out, with the photos only they held; a draft and an unlisted item come back", async () => {
    keepOnDisk([bag("navy", { draftId: "d-live" }), bag("red", { draftId: "d-draft" }), bag("lamp")]);
    h.statuses.set("d-live", "live").set("d-draft", "draft");
    const onRestore = vi.fn();
    const { result } = renderHook(() => useBunchSaved("owner", snapshot, () => {}, onRestore));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    const back = onRestore.mock.calls[0][0] as { items: BunchItem[]; photos: { key: string }[] };
    expect(back.items.map((it) => it.key)).toEqual(["red", "lamp"]);
    expect(back.photos.map((p) => p.key)).toEqual(["red-p", "lamp-p"]);
    expect(result.current.restoredCount).toBe(2);
  });

  it("withoutPosted: any status but draft is posted; a read that failed leaves everything for listing to check", () => {
    const items = [bag("a", { draftId: "x" }), bag("b", { appId: "y" }), bag("c", { draftId: "z" })];
    const photos = items.map((it) => ({ key: it.photoKeys[0] }));
    const out = withoutPosted(items, photos, new Map([["x", "sold"], ["y", "withdrawn"], ["z", "draft"]]));
    expect(out.items.map((it) => it.key)).toEqual(["c"]);
    expect(out.posted).toBe(2);
    expect(withoutPosted(items, photos, null).items).toHaveLength(3);
  });
});

describe("the Sell chooser's Continue where you left off", () => {
  it("is not offered for kept work whose every item is posted; it is for work with one still to list", async () => {
    keepOnDisk([bag("navy", { draftId: "c87b7de4" }), bag("red", { draftId: "019dd0b3" })]);
    const live = async (ids: string[]) => new Map(ids.map((id) => [id, "live"]));
    expect((await savedSellWork("owner", Date.now(), live)).bunch).toBe(false);
    keepOnDisk([bag("navy", { draftId: "c87b7de4" }), bag("lamp")]);
    expect((await savedSellWork("owner", Date.now(), live)).bunch).toBe(true);
    const fails = async () => { throw new Error("offline"); };
    keepOnDisk([bag("navy", { draftId: "c87b7de4" })]);
    expect((await savedSellWork("owner", Date.now(), fails)).bunch).toBe(true);
  });

  it("Continue your listing is not offered for a one-item listing that is already posted", async () => {
    h.disk.set("lh-sell-one-v1", { userId: "owner", savedAt: Date.now(), photos: [], createdId: "c87b7de4", form: { title: "Sleeping bag" } });
    expect((await savedSellWork("owner", Date.now(), async (ids) => new Map(ids.map((id) => [id, "live"])))).one).toBe(false);
    expect((await savedSellWork("owner", Date.now(), async (ids) => new Map(ids.map((id) => [id, "draft"])))).one).toBe(true);
  });
});

describe("listing never posts an item that is already live", () => {
  const place = { areaLabel: "Delcambre", pickupAddress: "1 Main St", pickupLat: 30, pickupLng: -91.9 };
  const files = new Map([["navy-p", new File(["n"], "n.jpg")], ["red-p", new File(["r"], "r.jpg")]]);
  function deps(over: Partial<ListDeps> = {}): ListDeps {
    return {
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async (_f, appId?: string) => appId ?? "fresh"),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async () => "ph"),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async () => new Map()),
      withdrawItem: vi.fn(async () => {}),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setAutoFreeDays: vi.fn(async (_id: string, d: number | null) => d),
      setOfferRules: vi.fn(async () => {}),
      publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
      ...over,
    };
  }

  it("each new draft is asked for with an app id that is saved first", async () => {
    const d = deps();
    const steps: [string, unknown][] = [];
    await listBunch("owner", [bag("navy")], files, place, ["porch"], () => {}, d, (k, p) => steps.push([k, p]));
    const appId = (steps[0][1] as { appId: string }).appId;
    expect(appId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.createDraft).toHaveBeenCalledWith(expect.anything(), appId);
    expect(steps[1]).toEqual(["navy", { draftId: appId }]);
  });

  it("an item whose app id is already posted (its draft id never saved) is reported and leaves the list, never made again", async () => {
    const d = deps({ itemStatuses: vi.fn(async () => new Map([["c87b7de4", "live"]])) });
    const steps: [string, unknown][] = [];
    const out = await listBunch("owner", [bag("navy", { appId: "c87b7de4" })], files, place, ["porch"], () => {}, d, (k, p) => steps.push([k, p]));
    expect(out).toMatchObject([{ key: "navy", status: "live", id: "c87b7de4" }]);
    expect(steps).toContainEqual(["navy", null]);
    expect(d.createDraft).not.toHaveBeenCalled();
    expect(d.publishMany).not.toHaveBeenCalled();
  });

  it("the server saying the id is already posted (status read failed) makes no copy and no publish", async () => {
    const d = deps({
      itemStatuses: vi.fn(async () => { throw new Error("offline"); }),
      createDraft: vi.fn(async (_f, appId?: string) => { throw new AlreadyPosted(appId!); }),
    });
    const steps: [string, unknown][] = [];
    const out = await listBunch("owner", [bag("navy", { appId: "c87b7de4" })], files, place, ["porch"], () => {}, d, (k, p) => steps.push([k, p]));
    expect((out[0] as { error: Error }).error).toBeInstanceOf(AlreadyPosted);
    expect(out[0]).not.toHaveProperty("stays");
    expect(steps).toContainEqual(["navy", null]);
    expect(d.addPhoto).not.toHaveBeenCalled();
    expect(d.publishMany).not.toHaveBeenCalled();
  });
});

describe("the post that leaves nothing on the list clears the kept work at once", () => {
  it("runDone clears the save when every item left the list", () => {
    const src = readFileSync("src/components/declutter/DeclutterBunchView.tsx", "utf8");
    const done = src.slice(src.indexOf("runDone.current = (result) =>"), src.indexOf("function startOver()"));
    expect(done).toMatch(/if \(items\.every\(\(it\) => gone\.has\(it\.key\)\)\) saved\.clearSaved\(\);/);
  });
});
