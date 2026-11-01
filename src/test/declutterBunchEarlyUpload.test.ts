/**
 * LEAD-BUNCH-34-SLOW, last part (owner 10-31, URGENT): Sell a bunch sends each sorted item's photos while the seller
 * looks them over, into the folder of the id its draft will be made with (the one-item form's scheme,
 * declutter_create_item_with_id), so List only creates, attaches and publishes, a few items at once.
 *
 * Target (owner, 2026-10-31): 3 items live in under 2 s when their photos are already up. Measured here with every server call held for a
 * realistic phone round trip (RPC_MS) and each photo upload for UPLOAD_MS, on fake timers so the number is exact.
 *
 * @mutate src/lib/declutter/bunch.ts |             const uploadedPath = (await early?.path(draftId, k)) ?? undefined; |             const uploadedPath = undefined;
 * @mutate src/lib/declutter/bunch.ts |         const appId = it.appId ?? early?.idFor(it.key) ?? newBunchItemId(); |         const appId = it.appId ?? newBunchItemId();
 * @mutate src/lib/declutter/bunchStage.ts |       let id = it.draftId ?? it.appId ?? this.ids.get(it.key); |       let id = it.draftId ?? this.ids.get(it.key);
 * @mutate src/lib/declutter/bunchStage.ts |         given.set(it.key, id); |         void given;
 * @mutate src/lib/declutter/bunch.ts |       if ((await prepareOne(i, items[i])) === "already_posted") { |       if ((await prepareOne(i, items[i])) === "never") {
 * @mutate src/lib/declutter/bunch.ts |   await Promise.all(Array.from({ length: Math.min(PREPARE_AT_ONCE, items.length) }, readyWorker)); |   await Promise.all(Array.from({ length: Math.min(1, items.length) }, readyWorker));
 * @mutate src/lib/declutter/bunch.ts |       const [sent, settled, kept, offers] = await Promise.allSettled([sendPhotos(), settle(), keepUp(), offersOff(), autoFree()]); |       const [sent, settled, kept, offers] = [await Promise.allSettled([sendPhotos()]), await Promise.allSettled([settle()]), await Promise.allSettled([keepUp()]), await Promise.allSettled([offersOff()]), await Promise.allSettled([autoFree()])].map((r) => r[0]);
 * @mutate src/lib/declutter/bunch.ts | await Promise.allSettled([sendPhotos(), settle(), keepUp(), offersOff(), autoFree()]); | await Promise.all([sendPhotos(), settle(), keepUp(), offersOff(), autoFree()]);
 * @mutate src/lib/declutter/bunch.ts |       if (failed) throw failed.reason; |       void failed;
 * @mutate src/lib/declutter/bunch.ts |   prepared.sort((a, b) => a.at - b.at); |   prepared.reverse();
 * @mutate src/lib/declutter/bunchStage.ts |         if (!this.staged.has(at)) this.staged.set(at, this.queued(id, file)); |         void at;
 * @mutate src/lib/declutter/bunchStage.ts |     for (const [at] of gone) this.staged.delete(at); |     void gone;
 * @mutate src/lib/declutter/bunchStage.ts |     if (this.running >= this.atOnce) await | if (false) await
 * @mutate src/lib/declutter/bunchStage.ts |     this.staged.delete(slot(itemId, photoKey)); |     void itemId;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankItem, listBunch, type BunchChoices, type BunchItem, type ListDeps } from "@/lib/declutter/bunch";
import { BunchStager } from "@/lib/declutter/bunchStage";

/** One server round trip from a phone (Supabase RPC, us-east, LTE). */
const RPC_MS = 200;
/** One 1600 px listing photo going up on a phone (about 300 KB on a 5 Mbit/s uplink, plus its round trip). */
const UPLOAD_MS = 700;

const lag = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
const CHOICES: BunchChoices = { keepUp: true, drops: true, dropPct: 10, floorPct: 50 };

function item(key: string, photoKeys: string[]): BunchItem {
  return { ...blankItem(photoKeys), key, title: `Item ${key}`, description: "Solid.", category: "furniture", price: "40", sizeUnknown: false };
}

/** Server calls at phone speed. publishMany lists 3 at once, two calls each (attest, publish), as moves.ts does. */
function slowDeps(log: string[]) {
  const addPhoto = vi.fn(async (_s: string, id: string, f: File, o?: { uploadedPath?: string }) => {
    if (!o?.uploadedPath) {
      log.push(`upload ${id} ${f.name}`);
      await lag(UPLOAD_MS);
    }
    await lag(RPC_MS);
    log.push(`attach ${id} ${f.name}${o?.uploadedPath ? " early" : ""}`);
    return `photo-${f.name}`;
  });
  const createDraft = vi.fn(async (_f: unknown, withId?: string) => {
    await lag(RPC_MS);
    return withId ?? `fresh-${createDraft.mock.calls.length}`;
  });
  const d: ListDeps = {
    createMoveDraft: vi.fn(async () => "moved"),
    createDraft: createDraft as unknown as ListDeps["createDraft"],
    updateDraft: vi.fn(async (id: string) => id),
    removePhoto: vi.fn(async () => {}),
    itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
    withdrawItem: vi.fn(async () => {}),
    addPhoto: addPhoto as unknown as ListDeps["addPhoto"],
    setHandovers: vi.fn(async (_id, w) => (await lag(RPC_MS), w)),
    setDropPct: vi.fn(async (_id, p) => (await lag(RPC_MS), p)),
    setKeepUp: vi.fn(async (_id, on) => (await lag(RPC_MS), on)),
    setAutoFreeDays: vi.fn(async (_id: string, d: number | null) => d),
    setOfferRules: vi.fn(async () => {}),
    publishMany: vi.fn(async (ids: string[], onProgress) => {
      let next = 0;
      let done = 0;
      const out: { id: string; status: "live" }[] = new Array(ids.length);
      const worker = async () => {
        while (next < ids.length) {
          const i = next++;
          await lag(RPC_MS * 2);
          out[i] = { id: ids[i], status: "live" };
          onProgress(++done, ids.length, i);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
      return out;
    }),
  };
  return { d, addPhoto, createDraft };
}

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => { done = true; });
  for (let i = 0; i < 10_000 && !done; i++) await vi.advanceTimersByTimeAsync(10);
  return p;
}

const items = [item("a", ["a1", "a2", "a3"]), item("b", ["b1", "b2", "b3"]), item("c", ["c1", "c2", "c3"])];
const photos = new Map(items.flatMap((it) => it.photoKeys).map((k) => [k, new File([k], `${k}.jpg`, { type: "image/jpeg" })]));

let ids = 0;
const stagerFor = (stageOne = vi.fn(async (_s: string, id: string, f: File): Promise<string | null> => `seller/declutter/${id}/${f.name}`), drop = vi.fn(async () => {})) => ({
  stager: new BunchStager("seller", stageOne, drop, () => `early-${++ids}`),
  stageOne,
  drop,
});

beforeEach(() => {
  ids = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("Sell a bunch: 3 items whose photos are already up", () => {
  it("are live in under 2 s at phone speed, each draft made with its early id and each photo only attached", async () => {
    const log: string[] = [];
    const { d, createDraft } = slowDeps(log);
    const { stager } = stagerFor();
    stager.sync(items, photos);
    // The photos went up while the seller looked the items over.
    await settle(Promise.all(items.flatMap((it) => it.photoKeys.map((k) => stager.path(stager.idFor(it.key)!, k)))));
    const start = Date.now();
    const out = await settle(listBunch("seller", items, photos, place, ["porch"], () => {}, d, undefined, CHOICES, undefined, stager));
    const ms = Date.now() - start;
    console.log(`[LEAD-BUNCH-34-SLOW] 3 items, 9 photos already up, ${RPC_MS} ms a call: ${ms} ms to live`);
    expect(out.map((o) => ("status" in o ? o.status : "error"))).toEqual(["live", "live", "live"]);
    expect(ms).toBeLessThan(2_000);
    // Exact on fake timers: the draft (1 call), then its 3 attaches beside its settings (3 calls), then attest and
    // publish (2 calls). Settings after the photos would be 1800 ms; one item at a time, 3000 ms.
    expect(ms).toBe(6 * RPC_MS);
    // Listed in the seller's order.
    expect(vi.mocked(d.publishMany).mock.calls[0][0]).toEqual(["early-1", "early-2", "early-3"]);
    expect(createDraft.mock.calls.map((c) => c[1])).toEqual(["early-1", "early-2", "early-3"]);
    expect(log.filter((l) => l.startsWith("upload"))).toEqual([]);
    expect(log.filter((l) => l.endsWith("early"))).toHaveLength(9);
    // Each item's photos still go on in order (the cover first).
    expect(log.filter((l) => l.startsWith("attach early-1"))).toEqual(["attach early-1 a1.jpg early", "attach early-1 a2.jpg early", "attach early-1 a3.jpg early"]);
  });

  it("a draft that got another id (before the migration is on prod) uploads its photos at listing, as before", async () => {
    const log: string[] = [];
    const { d } = slowDeps(log);
    d.createDraft = vi.fn(async () => "other-id") as unknown as ListDeps["createDraft"];
    const { stager } = stagerFor();
    stager.sync(items.slice(0, 1), photos);
    const out = await settle(listBunch("seller", items.slice(0, 1), photos, place, ["porch"], () => {}, d, undefined, CHOICES, undefined, stager));
    expect(out[0]).toMatchObject({ status: "live", id: "other-id" });
    expect(log.filter((l) => l.startsWith("upload"))).toEqual(["upload other-id a1.jpg", "upload other-id a2.jpg", "upload other-id a3.jpg"]);
  });

  it("an early upload that failed goes up at listing; the rest are only attached", async () => {
    const log: string[] = [];
    const { d } = slowDeps(log);
    const { stager } = stagerFor(vi.fn(async (_s: string, id: string, f: File) => (f.name === "a2.jpg" ? null : `seller/declutter/${id}/${f.name}`)));
    stager.sync(items.slice(0, 1), photos);
    await settle(listBunch("seller", items.slice(0, 1), photos, place, ["porch"], () => {}, d, undefined, CHOICES, undefined, stager));
    expect(log.filter((l) => l.startsWith("attach"))).toEqual(["attach early-1 a1.jpg early", "attach early-1 a2.jpg", "attach early-1 a3.jpg early"]);
  });

  it("before this change the same 3 items took more than twice as long (every photo went up at listing, one item at a time)", async () => {
    const log: string[] = [];
    const { d } = slowDeps(log);
    const start = Date.now();
    await settle(listBunch("seller", items, photos, place, ["porch"], () => {}, d, undefined, CHOICES));
    const ms = Date.now() - start;
    console.log(`[LEAD-BUNCH-34-SLOW] the same 3 items with no early uploads: ${ms} ms`);
    // Still uploads every photo when there were no early copies.
    expect(log.filter((l) => l.startsWith("upload"))).toHaveLength(9);
  });
});

describe("BunchStager", () => {
  it("sends at most 3 photos at once", async () => {
    let running = 0;
    let most = 0;
    const { stager } = stagerFor(vi.fn(async (_s: string, id: string, f: File) => {
      running += 1;
      most = Math.max(most, running);
      await lag(UPLOAD_MS);
      running -= 1;
      return `${id}/${f.name}`;
    }));
    stager.sync(items, photos);
    await settle(Promise.all(items.flatMap((it) => it.photoKeys.map((k) => stager.path(stager.idFor(it.key)!, k)))));
    expect(most).toBe(3);
  });

  it("a photo moved to another item goes up again in that item's folder, and its old copy is removed", async () => {
    const { stager, stageOne, drop } = stagerFor();
    const before = [item("a", ["a1", "a2"]), item("b", ["b1"])];
    stager.sync(before, photos);
    await settle(Promise.resolve());
    const after = [item("a", ["a1"]), item("b", ["b1", "a2"])];
    stager.sync(after, photos);
    await settle(Promise.resolve());
    expect(stageOne).toHaveBeenCalledTimes(4);
    expect(stageOne.mock.calls[3].slice(1, 2)).toEqual(["early-2"]);
    expect(drop).toHaveBeenCalledWith(["seller/declutter/early-1/a2.jpg"]);
    expect(await stager.path("early-1", "a2")).toBeNull();
    expect(await stager.path("early-2", "a2")).toBe("seller/declutter/early-2/a2.jpg");
  });

  it("photos still waiting to be sorted, or already on the draft, are not sent", () => {
    const { stager, stageOne } = stagerFor();
    stager.sync([{ ...item("p", ["a1"]), notSorted: true }, { ...item("d", ["a2", "a3"]), draftId: "draft-1", uploaded: { a2: "ph" } }], photos);
    expect(stageOne).toHaveBeenCalledTimes(1);
    expect(stageOne.mock.calls[0].slice(1, 2)).toEqual(["draft-1"]);
  });

  it("an attached copy is never handed out again", async () => {
    const { stager } = stagerFor();
    stager.sync(items.slice(0, 1), photos);
    expect(await stager.path("early-1", "a1")).toBe("seller/declutter/early-1/a1.jpg");
    stager.used("early-1", "a1");
    expect(await stager.path("early-1", "a1")).toBeNull();
  });
});

describe("Sell a bunch: a setting that fails while the photos are still being attached", () => {
  it("ends the item only once its photos are done, so a quick Try again attaches no photo twice", async () => {
    const log: string[] = [];
    const { d, addPhoto } = slowDeps(log);
    let handoverTries = 0;
    d.setHandovers = vi.fn(async (_id: string, w: string[]) => {
      await lag(RPC_MS);
      // The first try is refused at once, while the first photo is still going up.
      if ((handoverTries += 1) === 1) throw new Error("network_error");
      return w;
    }) as unknown as ListDeps["setHandovers"];
    // The screen's copy of the item, kept up to date by each lasting step, as DeclutterBunchView does.
    let shown = item("a", ["a1", "a2", "a3"]);
    const onStep = (_key: string, patch: Partial<BunchItem> | null) => { if (patch) shown = { ...shown, ...patch }; };
    const first = await settle(listBunch("seller", [shown], photos, place, ["porch"], () => {}, d, onStep, CHOICES));
    expect("error" in first[0]).toBe(true);
    // Try again at once, from what the screen holds the moment the first run says it stopped.
    const second = await settle(listBunch("seller", [shown], photos, place, ["porch"], () => {}, d, onStep, CHOICES));
    await settle(lag(10_000));
    expect(second.map((o) => ("status" in o ? o.status : "error"))).toEqual(["live"]);
    const attached = addPhoto.mock.calls.map((c) => (c[2] as File).name).sort();
    expect(attached).toEqual(["a1.jpg", "a2.jpg", "a3.jpg"]);
    expect(Object.keys(shown.uploaded ?? {}).sort()).toEqual(["a1", "a2", "a3"]);
  });
});

describe("ONE id per item (lead 10-31): the saved app id is the early folder and the draft's id", () => {
  it("an item formed without an app id is given one by sync, to save; one that has it keeps it as its folder", async () => {
    const { stager } = stagerFor();
    const saved = { ...item("s", ["s1"]), appId: "app-saved" };
    const given = stager.sync([item("n", ["n1"]), saved], photos.set("s1", new File(["s1"], "s1.jpg")).set("n1", new File(["n1"], "n1.jpg")));
    expect([...given.entries()]).toEqual([["n", "early-1"]]);
    expect(stager.idFor("s")).toBe("app-saved");
    await settle(Promise.resolve());
    expect(await settle(stager.path("app-saved", "s1"))).toBe("seller/declutter/app-saved/s1.jpg");
  });

  it("listing makes the draft with that same id, so the photos already up are only attached", async () => {
    const log: string[] = [];
    const { d, createDraft } = slowDeps(log);
    // No draft has that id yet: the server has no row for it.
    d.itemStatuses = vi.fn(async () => new Map());
    const { stager } = stagerFor();
    const it1 = { ...item("a", ["a1", "a2"]), appId: "app-a" };
    stager.sync([it1], photos);
    await settle(Promise.all(it1.photoKeys.map((k) => stager.path("app-a", k))));
    const steps: Partial<BunchItem>[] = [];
    const out = await settle(listBunch("seller", [it1], photos, place, ["porch"], () => {}, d, (_k, p) => { if (p) steps.push(p); }, CHOICES, undefined, stager));
    expect(out.map((o) => ("status" in o ? o.status : "error"))).toEqual(["live"]);
    expect(createDraft.mock.calls.map((c) => c[1])).toEqual(["app-a"]);
    expect(log.filter((l) => l.startsWith("upload"))).toEqual([]);
    // Already saved: no second app id is written.
    expect(steps.some((p) => "appId" in p)).toBe(false);
  });

  it("an item whose app id is already posted is counted done and cleared, never listed again", async () => {
    const { AlreadyPosted } = await import("@/lib/declutter/api");
    const { d } = slowDeps([]);
    // The status read failed, so only the ask with the app id finds it posted (createDraft's AlreadyPosted path).
    d.itemStatuses = vi.fn(async () => { throw new Error("network_error"); });
    d.createDraft = vi.fn(async () => { throw new AlreadyPosted("app-a"); }) as unknown as ListDeps["createDraft"];
    const progress: number[] = [];
    const cleared: string[] = [];
    const out = await settle(listBunch("seller", [{ ...item("a", ["a1"]), appId: "app-a" }], photos, place, ["porch"], (n) => progress.push(n), d, (k, p) => { if (p === null) cleared.push(k); }, CHOICES));
    expect(out[0] && "error" in out[0] && out[0].error).toBeInstanceOf(AlreadyPosted);
    expect(cleared).toEqual(["a"]);
    expect(progress[progress.length - 1]).toBe(2);
    expect(progress).toContain(1);
    expect(d.publishMany).not.toHaveBeenCalled();
  });
});
