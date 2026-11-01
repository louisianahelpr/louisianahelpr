/**
 * Owner on their iPhone, 2026-10-30: "it took so long to load that some pictures timed out and didn't upload." This
 * pins: a photo's steps try again by themselves with backoff; a lost answer never stores or attaches a photo twice; a
 * run shows each photo as it goes, one at a time and in order; a photo out of tries stays on its item, marked, with the
 * rest of the run carrying on; trying again resumes from it.
 *
 * @mutate src/lib/declutter/steadyUpload.ts |       const found = await steps.findAttached();\n      if (found) return found; |       await steps.findAttached();
 * @mutate src/lib/declutter/steadyUpload.ts |   const retry = { delays: UPLOAD_RETRY_DELAYS_MS, worthIt, ...hooks }; |   const retry = { delays: [] as number[], worthIt, ...hooks };
 * @mutate src/lib/declutter/steadyUpload.ts |   await withRetries(() => steps.store(stored++ > 0), retry); |   await withRetries(() => steps.store(false), retry);
 * @mutate src/lib/declutter/steadyUpload.ts | const worthIt = (error: unknown) => !(error instanceof PhotoUploadRefused) && worthTryingAgain(error); | const worthIt = (error: unknown) => worthTryingAgain(error) \|\| error instanceof PhotoUploadRefused;
 * @mutate src/lib/declutter/bunch.ts |           onStep(it.key, { failedPhoto: k }); |           void k;
 * @mutate src/lib/declutter/bunch.ts |             if (!uploadedPath && !endTurn) endTurn = await uploadTurn(); |             void uploadTurn;
 * @mutate src/lib/declutter/bunch.ts |         onPhoto?.({ ...progress, retrying: false }); |         void progress;
 * @mutate src/lib/declutter/bunch.ts |         onStep(it.key, { uploaded: { ...uploaded }, ...(it.failedPhoto ? { failedPhoto: undefined } : {}) }); |         onStep(it.key, { uploaded: { ...uploaded } });
 */
import { describe, expect, it, vi } from "vitest";
import { blankItem, listBunch, type BunchItem, type ListDeps, type PhotoProgress } from "@/lib/declutter/bunch";
import { PhotoUploadRefused, UPLOAD_RETRY_DELAYS_MS, uploadSteadily } from "@/lib/declutter/steadyUpload";

const noWait = async () => {};
const quiet = { pause: noWait, whenBack: noWait, awayCount: () => 0 };
const loadFailed = () => new TypeError("Load failed");

describe("one photo on a weak connection", () => {
  it("backs off between tries of the file", async () => {
    const waits: number[] = [];
    const store = vi.fn(async () => {
      if (store.mock.calls.length <= 3) throw new Error("photo_not_uploaded");
    });
    const id = await uploadSteadily({ store, attach: async () => "ph", findAttached: async () => null }, { ...quiet, pause: async (ms) => { waits.push(ms); } });
    expect(id).toBe("ph");
    expect(store).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([...UPLOAD_RETRY_DELAYS_MS]);
  });

  it("tells the store when an earlier try may have landed, so 'already there' counts as done", async () => {
    const seen: boolean[] = [];
    const store = async (again: boolean) => {
      seen.push(again);
      if (seen.length === 1) throw loadFailed();
    };
    await uploadSteadily({ store, attach: async () => "ph", findAttached: async () => null }, quiet);
    expect(seen).toEqual([false, true]);
  });

  it("a lost answer from attaching doesn't add a second photo: it asks first", async () => {
    const attach = vi.fn(async () => { throw loadFailed(); });
    const id = await uploadSteadily({ store: async () => {}, attach, findAttached: async () => "already" }, quiet);
    expect(id).toBe("already");
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("attaches again when the first try really didn't land", async () => {
    const attach = vi.fn(async () => {
      if (attach.mock.calls.length === 1) throw loadFailed();
      return "ph";
    });
    expect(await uploadSteadily({ store: async () => {}, attach, findAttached: async () => null }, quiet)).toBe("ph");
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("a refusal isn't tried again", async () => {
    const attach = vi.fn(async () => { throw new PhotoUploadRefused("item_not_editable"); });
    await expect(uploadSteadily({ store: async () => {}, attach, findAttached: async () => null }, quiet)).rejects.toThrow("item_not_editable");
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("storage refusing the file isn't tried again, though a dropped upload has the same words", async () => {
    const store = vi.fn(async () => { throw new PhotoUploadRefused("photo_not_uploaded"); });
    await expect(uploadSteadily({ store, attach: async () => "x", findAttached: async () => null }, quiet)).rejects.toThrow("photo_not_uploaded");
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("gives up after its tries, with the reason", async () => {
    const store = vi.fn(async () => { throw new Error("photo_not_uploaded"); });
    await expect(uploadSteadily({ store, attach: async () => "x", findAttached: async () => null }, quiet)).rejects.toThrow("photo_not_uploaded");
    expect(store).toHaveBeenCalledTimes(UPLOAD_RETRY_DELAYS_MS.length + 1);
  });
});

describe("a run on a weak connection", () => {
  const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30, pickupLng: -91 };
  const named = (key: string, photoKeys: string[], extra: Partial<BunchItem> = {}): BunchItem => ({ ...blankItem(photoKeys), key, title: `Thing ${key}`, price: "20", sizeUnknown: false, ...extra });
  const filesFor = (keys: string[]) => new Map(keys.map((k) => [k, new File([k], `${k}.jpg`, { type: "image/jpeg" })]));
  const deps = (addPhoto: ListDeps["addPhoto"]): ListDeps => ({
    createDraft: vi.fn(async (f: { title: string }) => `draft-${f.title}`) as unknown as ListDeps["createDraft"],
    createMoveDraft: vi.fn(async () => "draft-move") as unknown as ListDeps["createMoveDraft"],
    updateDraft: vi.fn(async () => {}) as unknown as ListDeps["updateDraft"],
    addPhoto,
    removePhoto: vi.fn(async () => {}),
    itemStatuses: vi.fn(async () => new Map([["d1", "draft"]])) as unknown as ListDeps["itemStatuses"],
    withdrawItem: vi.fn(async () => {}),
    setHandovers: vi.fn(async () => {}) as unknown as ListDeps["setHandovers"],
    setDropPct: vi.fn(async () => {}) as unknown as ListDeps["setDropPct"],
    setKeepUp: vi.fn(async () => {}) as unknown as ListDeps["setKeepUp"],
    setAutoFreeDays: vi.fn(async (_id: string, d: number | null) => d),
    setOfferRules: vi.fn(async () => {}) as unknown as ListDeps["setOfferRules"],
    publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
  });

  it("shows each photo in order, one at a time, across the items", async () => {
    let going = 0;
    let most = 0;
    const sentOrder: string[] = [];
    const addPhoto = vi.fn(async (_s: string, _i: string, f: File) => {
      going += 1;
      most = Math.max(most, going);
      await Promise.resolve();
      going -= 1;
      sentOrder.push(f.name);
      return `id-${f.name}`;
    }) as unknown as ListDeps["addPhoto"];
    const seen: PhotoProgress[] = [];
    await listBunch("s", [named("one", ["a", "b"]), named("two", ["c"])], filesFor(["a", "b", "c"]), place, ["porch"], () => {}, deps(addPhoto), () => {}, undefined, (p) => seen.push(p));
    expect(most).toBe(1);
    expect(sentOrder).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(seen).toEqual([
      { itemName: "Thing one", photo: 1, of: 3, retrying: false },
      { itemName: "Thing one", photo: 2, of: 3, retrying: false },
      { itemName: "Thing two", photo: 3, of: 3, retrying: false },
    ]);
  });

  it("a try again shows on the same photo", async () => {
    const addPhoto = (async (_s: string, _i: string, _f: File, hooks?: { onRetry?: (e: unknown) => void }) => {
      hooks?.onRetry?.(loadFailed());
      return "ph";
    }) as unknown as ListDeps["addPhoto"];
    const seen: PhotoProgress[] = [];
    await listBunch("s", [named("one", ["a"])], filesFor(["a"]), place, ["porch"], () => {}, deps(addPhoto), () => {}, undefined, (p) => seen.push(p));
    expect(seen.map((p) => [p.photo, p.retrying])).toEqual([[1, false], [1, true]]);
  });

  it("a photo out of tries stays on its item, marked; nothing after it goes on that item; the next item still lists", async () => {
    const steps: [string, Partial<BunchItem> | null][] = [];
    const addPhoto = vi.fn(async (_s: string, _i: string, f: File) => {
      if (f.name === "b.jpg") throw new Error("photo_not_uploaded");
      return `id-${f.name}`;
    }) as unknown as ListDeps["addPhoto"];
    const out = await listBunch("s", [named("one", ["a", "b", "c"]), named("two", ["d"])], filesFor(["a", "b", "c", "d"]), place, ["porch"], () => {}, deps(addPhoto), (k, p) => steps.push([k, p]));
    expect(vi.mocked(addPhoto).mock.calls.map((c) => c[2].name)).toEqual(["a.jpg", "b.jpg", "d.jpg"]);
    expect(steps).toContainEqual(["one", { failedPhoto: "b" }]);
    expect(out.find((o) => o.key === "one")).toMatchObject({ stays: true });
    expect(out.find((o) => o.key === "two")).toMatchObject({ status: "live" });
  });

  it("trying again sends only what's left, in order, and clears the mark", async () => {
    const steps: [string, Partial<BunchItem> | null][] = [];
    const addPhoto = vi.fn(async (_s: string, _i: string, f: File) => `id-${f.name}`) as unknown as ListDeps["addPhoto"];
    await listBunch("s", [named("one", ["a", "b", "c"], { draftId: "d1", uploaded: { a: "id-a" }, failedPhoto: "b" })], filesFor(["a", "b", "c"]), place, ["porch"], () => {}, deps(addPhoto), (k, p) => steps.push([k, p]));
    expect(vi.mocked(addPhoto).mock.calls.map((c) => c[2].name)).toEqual(["b.jpg", "c.jpg"]);
    // Strict: an undefined failedPhoto is how the mark is cleared, and a plain toEqual can't see it.
    expect(steps[0]).toStrictEqual(["one", { uploaded: { a: "id-a", b: "id-b.jpg" }, failedPhoto: undefined }]);
  });
});
