/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"; pop-up: the photo tool groups, the seller fixes the grouping).
 * src/lib/declutter/bunch.ts:
 *   - no photo is ever lost: unplaced photos and a failed batch's photos stay
 *     as items to name; fixing the grouping only moves photos between items;
 *   - a split never clears a possible banned item, and a flagged item can still
 *     be listed (the photo check at listing decides); editing its words clears
 *     the mark; an unready item is never made (bunchItemProblem, checked again
 *     inside listBunch);
 *   - each batch's items reach the screen as it finishes, one photo that can't
 *     be cleaned costs only itself and is named, and the cap counts only the
 *     photos some item still holds;
 *   - listBunch: one item failing never stops the rest, and each failure keeps
 *     its own reason and whether its draft exists.
 *
 * @mutate src/lib/declutter/bunch.ts |     if (!placed.has(i)) out.push(blankItem([p.key])); |     if (false) out.push(blankItem([p.key]));
 * @mutate src/lib/declutter/bunch.ts |         made = good.map((p) => blankItem([p.key])); |         void good;
 * @mutate src/lib/declutter/bunch.ts |     onProgress(i + 1, batches.length, made); |     onProgress(i + 1, batches.length, []);
 * @mutate src/lib/declutter/bunch.ts |         made = itemsFromAnswer(await ask(cleaned), good); |         made = itemsFromAnswer(await ask(batch.map((p) => p.file)), batch);
 * @mutate src/lib/declutter/bunch.ts |         unusable.push({ key: p.key, name: p.file.name, error }); |         throw error;
 * @mutate src/lib/declutter/bunch.ts |   const reworded = "title" in patch \|\| "description" in patch; |   const reworded = false;
 * @mutate src/lib/declutter/bunch.ts |   const kept = photos.filter((p) => held.has(p.key)); |   const kept = photos;
 * @mutate src/lib/declutter/bunch.ts |   const next = { ...blankItem(take), flagged: src.flagged }; |   const next = blankItem(take);
 * @mutate src/lib/declutter/bunch.ts |       if (problem) throw Object.assign(new Error("bunch_item_not_ready"), { userMessage: problem }); |       void problem;
 * @mutate src/lib/declutter/bunch.ts |       out.set(it.key, { key: it.key, title: it.title, error, draftId: id, stays: true }); |       throw error;
 */
import { describe, expect, it, vi } from "vitest";
import { ListingPhotoError } from "@/lib/declutter/errors";
import {
  bunchItemProblem, dropItem, editBunchItem, groupPhotos, itemsFromAnswer, listBunch, mergeItems, movePhoto, photosInItems, splitItem, unusablePhotosNote,
  type BunchItem, type BunchPhoto, type GroupAnswer, type ListDeps,
} from "@/lib/declutter/bunch";

const photo = (key: string): BunchPhoto => ({ key, file: new File([key], `${key}.jpg`, { type: "image/jpeg" }) });
const drafted = (photos: number[], extra: Partial<GroupAnswer["items"][number]> = {}) => ({
  photos, title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large" as const, conditionStars: 4, flagged: false, ...extra,
});
const item = (key: string, photoKeys: string[], extra: Partial<BunchItem> = {}): BunchItem => ({
  key, photoKeys, title: "Oak chair", description: "", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "40", ...extra,
});
const allPhotos = (items: BunchItem[]) => items.flatMap((i) => i.photoKeys).sort();

describe("grouping keeps every photo", () => {
  it("unplaced photos become their own items; a photo is placed once", () => {
    const batch = ["a", "b", "c"].map(photo);
    const items = itemsFromAnswer({ items: [drafted([0, 0, 2]), drafted([2, 9])], leftover: [1] }, batch);
    expect(items.map((i) => i.photoKeys)).toEqual([["a", "c"], ["b"]]);
    expect(items[1].title).toBe("");
  });

  it("a flag the tool left out counts as flagged", () => {
    const items = itemsFromAnswer({ items: [drafted([0], { flagged: undefined as unknown as boolean })], leftover: [] }, [photo("a")]);
    expect(items[0].flagged).toBe(true);
  });

  it("batches of 8, spaced, and a failed batch keeps its photos and says why", async () => {
    const photos = Array.from({ length: 17 }, (_, i) => photo(`p${i}`));
    const ask = vi.fn(async (files: File[]): Promise<GroupAnswer> => {
      if (ask.mock.calls.length === 2) throw new Error("ai_rate_limited");
      return { items: [drafted(files.map((_, i) => i))], leftover: [] };
    });
    let now = 0;
    const waits: number[] = [];
    const res = await groupPhotos(photos, () => {}, ask, async (ms) => { waits.push(ms); now += ms; }, () => now, async (f) => f);
    expect(ask.mock.calls.map((c) => c[0].length)).toEqual([8, 8, 1]);
    expect(waits).toEqual([10_500, 10_500]);
    expect(res.failed).toEqual([{ photos: 8, error: new Error("ai_rate_limited") }]);
    expect(allPhotos(res.items)).toEqual(photos.map((p) => p.key).sort());
  });
});

describe("sorting shows as it goes, and one bad photo costs only itself", () => {
  const noWait = async () => {};
  const askAll = async (files: File[]): Promise<GroupAnswer> => ({ items: [drafted(files.map((_, i) => i))], leftover: [] });

  it("each batch's items reach the screen when that batch finishes, not at the end", async () => {
    const photos = Array.from({ length: 9 }, (_, i) => photo(`p${i}`));
    const seen: [number, number, string[]][] = [];
    const res = await groupPhotos(photos, (done, total, made) => seen.push([done, total, made.flatMap((m) => m.photoKeys)]), askAll, noWait, () => 0, async (f) => f);
    expect(seen).toEqual([
      [1, 2, ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]],
      [2, 2, ["p8"]],
    ]);
    expect(allPhotos(res.items)).toEqual(photos.map((p) => p.key).sort());
  });

  it("a failed batch's items reach the screen too", async () => {
    const seen: string[][] = [];
    await groupPhotos([photo("a")], (_d, _t, made) => seen.push(made.flatMap((m) => m.photoKeys)), async () => { throw new Error("ai_unavailable"); }, noWait, () => 0, async (f) => f);
    expect(seen).toEqual([["a"]]);
  });

  it("a photo that can't be cleaned is named; the rest of its batch is sent, cleaned, and placed by their own numbers", async () => {
    const bad = new ListingPhotoError("We couldn't prepare this photo.");
    const clean = async (f: File) => {
      if (f.name === "b.jpg") throw bad;
      return new File([f.name], `clean-${f.name}`, { type: "image/jpeg" });
    };
    const sent: string[][] = [];
    const ask = async (files: File[]): Promise<GroupAnswer> => {
      sent.push(files.map((f) => f.name));
      return { items: [drafted([1])], leftover: [0] };
    };
    const res = await groupPhotos(["a", "b", "c"].map(photo), () => {}, ask, noWait, () => 0, clean);
    expect(sent).toEqual([["clean-a.jpg", "clean-c.jpg"]]);
    // Number 1 of what was sent is c, not b.
    expect(res.items.map((i) => i.photoKeys)).toEqual([["c"], ["a"]]);
    expect(res.failed).toEqual([]);
    expect(res.unusable).toEqual([{ key: "b", name: "b.jpg", error: bad }]);
    expect(unusablePhotosNote(res.unusable)).toBe("This photo wasn't added (b.jpg): We couldn't prepare this photo.");
  });

  it("a batch of only bad photos spends no call on the photo tool", async () => {
    const ask = vi.fn(askAll);
    const waits: number[] = [];
    const seen: number[] = [];
    const res = await groupPhotos(["a", "b"].map(photo), (d) => seen.push(d), ask, async (ms) => { waits.push(ms); }, () => 0, async () => { throw new ListingPhotoError("No."); });
    expect(ask).not.toHaveBeenCalled();
    expect(waits).toEqual([]);
    expect(seen).toEqual([1]);
    expect(res.items).toEqual([]);
    expect(res.unusable.map((u) => u.key)).toEqual(["a", "b"]);
  });

  it("the note says how many and names at most five", () => {
    const error = new ListingPhotoError("No.");
    const many = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, name: `${i}.heic`, error }));
    expect(unusablePhotosNote([])).toBeNull();
    expect(unusablePhotosNote(many)).toBe("7 photos weren't added (0.heic, 1.heic, 2.heic, 3.heic, 4.heic and 2 more): No.");
  });
});

describe("the cap counts only photos still in an item", () => {
  it("photos of listed or dropped items leave; nothing changes when all are held", () => {
    const photos = ["a", "b", "c"].map(photo);
    expect(photosInItems(photos, [item("i", ["a", "c"])]).map((p) => p.key)).toEqual(["a", "c"]);
    expect(photosInItems(photos, [])).toEqual([]);
    expect(photosInItems(photos, [item("i", ["a", "b", "c"])])).toBe(photos);
  });
});

describe("the seller fixes the grouping", () => {
  const base = [item("i1", ["a", "b"]), item("i2", ["c"], { flagged: true }), item("i3", ["d"])];

  it("move a photo; an item left empty goes", () => {
    const moved = movePhoto(base, "c", "i1");
    expect(moved.map((i) => [i.key, i.photoKeys])).toEqual([["i1", ["a", "b", "c"]], ["i3", ["d"]]]);
    expect(movePhoto(base, "a", "nope")).toBe(base);
  });

  it("merge keeps both items' photos and a flag", () => {
    const merged = mergeItems(base, "i2", "i3");
    expect(merged.map((i) => [i.key, i.photoKeys, i.flagged])).toEqual([["i1", ["a", "b"], false], ["i3", ["d", "c"], true]]);
  });

  it("split makes a new item after it, keeping the flag", () => {
    const flaggedPair = [item("i1", ["a", "b"], { flagged: true })];
    const split = splitItem(flaggedPair, "i1", ["b"]);
    expect(split.map((i) => i.photoKeys)).toEqual([["a"], ["b"]]);
    expect(split.every((i) => i.flagged)).toBe(true);
    // Splitting off every photo (or none) changes nothing.
    expect(splitItem(flaggedPair, "i1", ["a", "b"])).toBe(flaggedPair);
  });

  it("drop removes the item", () => {
    expect(dropItem(base, "i2").map((i) => i.key)).toEqual(["i1", "i3"]);
  });

  it("editing the name or details clears the flag; other edits keep it", () => {
    expect(editBunchItem(base, "i2", { title: "Oak bench" })[1]).toMatchObject({ title: "Oak bench", flagged: false });
    expect(editBunchItem(base, "i2", { description: "Solid." })[1].flagged).toBe(false);
    expect(editBunchItem(base, "i2", { price: "12" })[1]).toMatchObject({ price: "12", flagged: true });
    expect(editBunchItem(base, "i2", { title: "Oak bench" })[0]).toBe(base[0]);
  });

  it("says what stops an item; a flag isn't one", () => {
    expect(bunchItemProblem(item("x", ["a"]))).toBeNull();
    expect(bunchItemProblem(item("x", ["a"], { flagged: true }))).toBeNull();
    expect(bunchItemProblem(item("x", []))).toBe("Add at least 1 photo.");
    expect(bunchItemProblem(item("x", Array.from({ length: 13 }, (_, i) => `p${i}`)))).toMatch(/at most 12 photos/);
    expect(bunchItemProblem(item("x", ["a"], { price: "" }))).toMatch(/^Give it a price/);
    expect(bunchItemProblem(item("x", ["a"], { title: "ab" }))).toMatch(/^Give it a name/);
  });
});

describe("listBunch", () => {
  const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
  const files = new Map(["a", "b", "c", "d"].map((k) => [k, new File([k], k)]));

  it("one item failing never stops the rest; each keeps its reason", async () => {
    let n = 0;
    const deps: ListDeps = {
      createDraft: vi.fn(async (f) => {
        if (f.title === "Bad") throw new Error("invalid_items");
        return `id${++n}`;
      }),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async (_s, id) => {
        if (id === "id2") throw new Error("photo_not_uploaded");
        return "ph";
      }),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      publishMany: vi.fn(async (ids: string[]) => ids.map((id: string) => (id === "id3" ? { id, error: new Error("setup_fee_required") } : { id, status: "live" as const }))),
    };
    const items = [
      item("ok", ["a"]),
      item("bad", ["b"], { title: "Bad" }),
      item("photo", ["c"]),
      item("pub", ["d"]),
      item("flag", ["a"], { flagged: true }),
      item("noprice", ["a"], { price: "" }),
    ];
    const out = await listBunch("seller", items, files, place, ["porch"], () => {}, deps);
    expect(out.map((o) => [o.key, "status" in o ? o.status : (o.error as Error).message, "draftId" in o ? o.draftId : "-"])).toEqual([
      ["ok", "live", "-"],
      ["bad", "invalid_items", null],
      ["photo", "photo_not_uploaded", "id2"],
      ["pub", "setup_fee_required", "id3"],
      ["flag", "live", "-"],
      ["noprice", "bunch_item_not_ready", null],
    ]);
    // Only the items that got their photos and ways are listed. A flagged item goes too (the photo check and the
    // server decide its status); an unready one never reaches the server.
    expect(deps.publishMany).toHaveBeenCalledWith(["id1", "id3", "id4"], expect.any(Function));
    expect(deps.createDraft).toHaveBeenCalledTimes(5);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 4000, floorPriceCents: 4000, areaLabel: "Mid-City" }));
  });

  // Audit finding 2: a run cut off part way (crash, reload) resumes; nothing is made or uploaded twice.
  // @mutate src/lib/declutter/bunch.ts |     let id: string \| null = it.draftId ?? null; |     let id: string \| null = null;
  // @mutate src/lib/declutter/bunch.ts |         if (uploaded.includes(k)) continue; |         void uploaded;
  // @mutate src/lib/declutter/bunch.ts |         onStep(it.key, { draftId: id }); |         void onStep;
  it("trying again finishes the same draft: its edits go on it, and only the photos still missing go up", async () => {
    const deps: ListDeps = {
      createDraft: vi.fn(async () => "new"),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async () => "ph"),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      publishMany: vi.fn(async (ids: string[], p) => ids.map((id: string, i: number) => { p(i + 1, ids.length); return { id, status: "live" as const }; })),
    };
    const steps: [string, unknown][] = [];
    const out = await listBunch("seller", [item("cut", ["a", "b"], { draftId: "d1", uploaded: ["a"] })], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(deps.updateDraft).toHaveBeenCalledWith("d1", expect.objectContaining({ title: "Oak chair", priceCents: 4000 }));
    expect(deps.addPhoto).toHaveBeenCalledTimes(1);
    expect(deps.addPhoto).toHaveBeenCalledWith("seller", "d1", files.get("b"));
    expect(deps.publishMany).toHaveBeenCalledWith(["d1"], expect.any(Function));
    expect(out).toEqual([{ key: "cut", title: "Oak chair", status: "live" }]);
    // Saved after each lasting step, and it leaves the list once listed.
    expect(steps).toEqual([["cut", { uploaded: ["a", "b"] }], ["cut", null]]);
  });

  it("a new item reports its draft as soon as it exists, so a crash after it never makes a second", async () => {
    const deps: ListDeps = {
      createDraft: vi.fn(async () => "d9"),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async () => { throw new Error("photo_not_uploaded"); }),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      publishMany: vi.fn(async () => []),
    };
    const steps: [string, unknown][] = [];
    await listBunch("seller", [item("x", ["a"])], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(steps).toEqual([["x", { draftId: "d9" }]]);
    expect(deps.updateDraft).not.toHaveBeenCalled();
  });
});
