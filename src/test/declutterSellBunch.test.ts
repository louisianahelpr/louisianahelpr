/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"; pop-up: the photo tool groups, the seller fixes the grouping).
 * src/lib/declutter/bunch.ts:
 *   - no photo is ever lost: unplaced photos and a failed batch's photos stay
 *     together as not sorted; fixing the grouping only moves photos between items;
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
 * @mutate src/lib/declutter/bunch.ts |   if (unplaced.length > 0) out.push(notSortedPile(unplaced, PILE_NOT_PLACED)); |   void unplaced;
 * @mutate src/lib/declutter/bunch.ts |           made = giveUp(good, cleaned, error); |           void good;
 * @mutate src/lib/declutter/bunch.ts |     onProgress(i + 1, batches.length, made); |     onProgress(i + 1, batches.length, []);
 * @mutate src/lib/declutter/bunch.ts | withRetries(() => spacedAsk(cleaned), { delays, | withRetries(() => spacedAsk(part.map((p) => p.file)), { delays,
 * @mutate src/lib/declutter/bunch.ts |         unusable.push({ key: p.key, name: p.file.name, error: made.error });\n      }\n    }\n    let made |         throw made.error;\n      }\n    }\n    let made
 * @mutate src/lib/declutter/bunch.ts |   const reworded = "title" in patch \|\| "description" in patch; |   const reworded = false;
 * @mutate src/lib/declutter/bunch.ts |   const kept = photos.filter((p) => held.has(p.key)); |   const kept = photos;
 * @mutate src/lib/declutter/bunch.ts |   const next = { ...blankItem(take), flagged: src.flagged }; |   const next = blankItem(take);
 * @mutate src/lib/declutter/bunch.ts |       if (problem) throw Object.assign(new Error("bunch_item_not_ready"), { userMessage: problem }); |       void problem;
 * @mutate src/lib/declutter/bunch.ts |       out.set(it.key, { key: it.key, title: it.title, error, draftId: id, stays: true }); |       throw error;
 */
import { AI_CHECK_GAP_MS } from "@/lib/declutter/moves";
import { describe, expect, it, vi } from "vitest";
import { ListingPhotoError } from "@/lib/declutter/errors";
import {
  bunchItemProblem, dropItem, editBunchItem, groupPhotos, itemsFromAnswer, listBunch, mergeItems, movePhoto, photosInItems, splitItem, unusablePhotosNote,
  blankItem, draftsLeftBehind, removeBunchDraft,
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
  it("unplaced photos stay together as not sorted, never one item each; a photo is placed once", () => {
    const batch = ["a", "b", "c"].map(photo);
    const items = itemsFromAnswer({ items: [drafted([0, 0, 2]), drafted([2, 9])], leftover: [1] }, batch);
    expect(items.map((i) => i.photoKeys)).toEqual([["a", "c"], ["b"]]);
    expect(items[1]).toMatchObject({ title: "", notSorted: true });
  });

  it("a flag the tool left out counts as flagged", () => {
    const items = itemsFromAnswer({ items: [drafted([0], { flagged: undefined as unknown as boolean })], leftover: [] }, [photo("a")]);
    expect(items[0].flagged).toBe(true);
  });

  it("batches of 8, spaced, and a failed batch keeps its photos and says why", async () => {
    const photos = Array.from({ length: 17 }, (_, i) => photo(`p${i}`));
    const ask = vi.fn(async (files: File[]): Promise<GroupAnswer> => {
      // The second batch fails on all three of its tries; a limit isn't helped by sending fewer.
      if ([2, 3, 4].includes(ask.mock.calls.length)) throw new Error("ai_rate_limited");
      return { items: [drafted(files.map((_, i) => i), { title: `Thing${"abcdefgh"[ask.mock.calls.length]}` })], leftover: [] };
    });
    let now = 0;
    const waits: number[] = [];
    const res = await groupPhotos(photos, () => {}, ask, async (ms) => { waits.push(ms); now += ms; }, () => now, async (f) => f);
    expect(ask.mock.calls.map((c) => c[0].length)).toEqual([8, 8, 8, 8, 1]);
    expect(waits).toEqual([AI_CHECK_GAP_MS, 5_000, AI_CHECK_GAP_MS - 5_000, 20_000, AI_CHECK_GAP_MS]);
    expect(res.failed).toEqual([{ photos: 8, error: new Error("ai_rate_limited") }]);
    expect(allPhotos(res.items)).toEqual(photos.map((p) => p.key).sort());
  });
});

describe("sorting shows as it goes, and one bad photo costs only itself", () => {
  const noWait = async () => {};
  let calls = 0;
  const askAll = async (files: File[]): Promise<GroupAnswer> => ({ items: [drafted(files.map((_, i) => i), { title: `Thingnumber${++calls}` })], leftover: [] });

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
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async (f) => {
        if (f.title === "Bad") throw new Error("invalid_items");
        return `id${++n}`;
      }),
      updateDraft: vi.fn(async (id) => id),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
      withdrawItem: vi.fn(async () => {}),
      addPhoto: vi.fn(async (_s, id) => {
        if (id === "id2") throw new Error("photo_not_uploaded");
        return "ph";
      }),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
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
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 4000, floorPriceCents: 4000, areaLabel: "Mid-City" }), expect.any(String));
  });

  // Audit finding 2: a run cut off part way (crash, reload) resumes; nothing is made or uploaded twice.
  // @mutate src/lib/declutter/bunch.ts |     let id: string \| null = it.draftId ?? null; |     let id: string \| null = null;
  // @mutate src/lib/declutter/bunch.ts |         if (k in uploaded) continue; |         void uploaded;
  // @mutate src/lib/declutter/bunch.ts |         onStep(it.key, { draftId: id }); |         void onStep;
  it("trying again finishes the same draft: its edits go on it, and only the photos still missing go up", async () => {
    const deps: ListDeps = {
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async () => "new"),
      updateDraft: vi.fn(async (id) => id),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
      withdrawItem: vi.fn(async () => {}),
      addPhoto: vi.fn(async () => "ph"),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
      publishMany: vi.fn(async (ids: string[], p) => ids.map((id: string, i: number) => { p(i + 1, ids.length, i); return { id, status: "live" as const }; })),
    };
    const steps: [string, unknown][] = [];
    const out = await listBunch("seller", [item("cut", ["a", "b"], { draftId: "d1", uploaded: { a: "pa" } })], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(deps.updateDraft).toHaveBeenCalledWith("d1", expect.objectContaining({ title: "Oak chair", priceCents: 4000 }));
    expect(deps.addPhoto).toHaveBeenCalledTimes(1);
    expect(deps.addPhoto).toHaveBeenCalledWith("seller", "d1", files.get("b"));
    expect(deps.publishMany).toHaveBeenCalledWith(["d1"], expect.any(Function));
    expect(out).toMatchObject([{ key: "cut", title: "Oak chair", status: "live" }]);
    // Saved after each lasting step, and it leaves the list once listed.
    expect(steps).toEqual([["cut", { uploaded: { a: "pa", b: "ph" } }], ["cut", null]]);
  });

  // LEAD-BUNCH-34-SLOW: listing runs a few at once, so items finish in any order; each one's own card leaves the list.
  // @mutate src/lib/declutter/bunch.ts |       const p = prepared[index]; |       const p = prepared[done - 1];
  it("items listed out of order: each one that went live is the one taken off the list", async () => {
    const deps: ListDeps = {
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async (f: { title: string }) => `d-${f.title}`),
      updateDraft: vi.fn(async (id) => id),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async () => new Map()),
      withdrawItem: vi.fn(async () => {}),
      addPhoto: vi.fn(async () => "ph"),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
      // The last item goes live first; the first never does.
      publishMany: vi.fn(async (ids: string[], p) => {
        p(1, ids.length, 2);
        p(2, ids.length, 1);
        return ids.map((id, i) => (i === 0 ? { id, error: new Error("photos_required") } : { id, status: "live" as const }));
      }),
    };
    const steps: [string, unknown][] = [];
    await listBunch("seller", [item("one", ["a"], { title: "One" }), item("two", ["b"], { title: "Two" }), item("three", ["a"], { title: "Three" })], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(steps.filter(([, patch]) => patch === null).map(([k]) => k)).toEqual(["three", "two"]);
  });

  // A photo moved off an item that already has a draft (B19's gap, lead 10-30): it stayed on the draft on the server.
  // @mutate src/lib/declutter/bunch.ts |         await removeDraftPhoto(deps, uploaded[k]); |         void k;
  // @mutate src/lib/declutter/bunch.ts |         delete uploaded[k]; |         void k;
  // @mutate src/lib/declutter/bunch.ts |     if (!String((err as Error)?.message ?? "").includes("photo_not_found")) throw err; |     throw err;
  describe("a photo moved off an item with a draft", () => {
    const makeDeps = (removePhoto: ListDeps["removePhoto"]): ListDeps => ({
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async () => "new"),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async () => "ph"),
      removePhoto,
      itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
      withdrawItem: vi.fn(async () => {}),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
      publishMany: vi.fn(async (ids: string[], p) => ids.map((id: string, i: number) => { p(i + 1, ids.length, i); return { id, status: "live" as const }; })),
    });

    it("leaves the draft before it lists, and what stays is not uploaded again", async () => {
      const remove = vi.fn(async () => {});
      const deps = makeDeps(remove);
      const steps: [string, unknown][] = [];
      await listBunch("seller", [item("cut", ["a"], { draftId: "d1", uploaded: { a: "pa", b: "pb" } })], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("pb");
      expect(deps.addPhoto).not.toHaveBeenCalled();
      expect(steps[0]).toEqual(["cut", { uploaded: { a: "pa" } }]);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan((deps.publishMany as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    });

    it("already gone from the draft is fine; any other refusal keeps the item on the list, unlisted", async () => {
      const gone = makeDeps(vi.fn(async () => { throw new Error("photo_not_found"); }));
      const ok = await listBunch("seller", [item("cut", ["a"], { draftId: "d1", uploaded: { a: "pa", b: "pb" } })], files, place, ["porch"], () => {}, gone);
      expect(ok).toMatchObject([{ key: "cut", title: "Oak chair", status: "live" }]);
      const down = makeDeps(vi.fn(async () => { throw new Error("offline"); }));
      const out = await listBunch("seller", [item("cut", ["a"], { draftId: "d1", uploaded: { a: "pa", b: "pb" } })], files, place, ["porch"], () => {}, down);
      expect(out[0]).toMatchObject({ key: "cut", draftId: "d1", stays: true });
      expect(down.publishMany).not.toHaveBeenCalled();
    });
  });

  it("a new item reports its draft as soon as it exists, so a crash after it never makes a second", async () => {
    const deps: ListDeps = {
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async () => "d9"),
      updateDraft: vi.fn(async (id) => id),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, "draft"]))),
      withdrawItem: vi.fn(async () => {}),
      addPhoto: vi.fn(async () => { throw new Error("photo_not_uploaded"); }),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
      publishMany: vi.fn(async () => []),
    };
    const steps: [string, unknown][] = [];
    await listBunch("seller", [item("x", ["a"])], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(steps).toEqual([["x", { appId: expect.any(String) }], ["x", { draftId: "d9" }], ["x", { failedPhoto: "a" }]]);
    expect(deps.updateDraft).not.toHaveBeenCalled();
  });
});

// "Don't sell this" on an item with a draft (B19's gap, lead 10-30): the draft stayed under Selling.
// @mutate src/lib/declutter/bunch.ts |   return before.flatMap((it) => (it.draftId && !kept.has(it.draftId) ? [{ id: it.draftId, item: it }] : [])); |   return [];
// @mutate src/lib/declutter/bunch.ts |   if (status && status !== "draft") return "already_listed"; |   void status;
// @mutate src/lib/declutter/bunch.ts |   if (status === "draft") await deps.withdrawItem(id); |   void deps;
describe("a draft the grouping leaves behind", () => {
  const it2 = (key: string, draftId?: string): BunchItem => ({ ...blankItem([`${key}-p`]), key, draftId, sizeUnknown: false });

  it("names a dropped item's draft, a merged-away item's and one that lost its last photo; never one still held", () => {
    const a = it2("a", "d-a");
    const b = it2("b", "d-b");
    const c = it2("c");
    expect(draftsLeftBehind([a, b, c], dropItem([a, b, c], "a")).map((d) => d.id)).toEqual(["d-a"]);
    expect(draftsLeftBehind([a, b, c], mergeItems([a, b, c], "b", "a")).map((d) => d.id)).toEqual(["d-b"]);
    expect(draftsLeftBehind([a, b, c], movePhoto([a, b, c], "a-p", "c")).map((d) => d.id)).toEqual(["d-a"]);
    expect(draftsLeftBehind([a, b, c], dropItem([a, b, c], "c"))).toEqual([]);
    expect(draftsLeftBehind([a, b], movePhoto([{ ...a, photoKeys: ["a-p", "x"] }, b], "a-p", "b"))).toEqual([]);
  });

  it("withdraws a draft, leaves a listing that is already up, and asks nothing of one that is gone", async () => {
    const deps = (status?: string) => ({ itemStatuses: vi.fn(async () => new Map(status ? [["d1", status]] : [])), withdrawItem: vi.fn(async () => {}) });
    const draft = deps("draft");
    expect(await removeBunchDraft("d1", draft)).toBe("removed");
    expect(draft.withdrawItem).toHaveBeenCalledWith("d1");
    const live = deps("live");
    expect(await removeBunchDraft("d1", live)).toBe("already_listed");
    expect(live.withdrawItem).not.toHaveBeenCalled();
    const gone = deps();
    expect(await removeBunchDraft("d1", gone)).toBe("removed");
    expect(gone.withdrawItem).not.toHaveBeenCalled();
  });
});

// A run cut off after a draft was listed, before that was saved: trying again gave item_not_a_draft (B19's gap, lead 10-30).
// @mutate src/lib/declutter/bunch.ts |       if (status === "live" \|\| status === "pending_review") { |       if (false) {
// @mutate src/lib/declutter/bunch.ts |       if (status === undefined) { |       if (false) {
// @mutate src/lib/declutter/bunch.ts |       } else if (status !== "draft") { |       } else if (false) {
describe("trying again after a cut-off run", () => {
  const place = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.4, pickupLng: -91.1 };
  const made = (key: string, draftId: string): BunchItem => ({ ...blankItem(["p"]), key, title: `Oak ${key}`, price: "40", draftId, uploaded: { p: "ph-1" }, sizeUnknown: false });
  const files = new Map([["p", new File(["p"], "p.jpg")]]);
  function makeDeps(statuses: Map<string, string> | "read fails"): ListDeps {
    return {
      createMoveDraft: vi.fn(async () => "moved"),
      createDraft: vi.fn(async () => "fresh"),
      updateDraft: vi.fn(async (id) => id),
      addPhoto: vi.fn(async () => "ph-2"),
      removePhoto: vi.fn(async () => {}),
      itemStatuses: vi.fn(async () => {
        if (statuses === "read fails") throw new Error("offline");
        return statuses;
      }),
      withdrawItem: vi.fn(async () => {}),
      setHandovers: vi.fn(async (_id, w) => w),
      setDropPct: vi.fn(async (_id, p) => p),
      setKeepUp: vi.fn(async (_id, on) => on),
      setOfferRules: vi.fn(async () => {}),
      publishMany: vi.fn(async (ids: string[], p) => ids.map((id: string, i: number) => { p(i + 1, ids.length, i); return { id, status: "live" as const }; })),
    };
  }

  it("an item already listed is reported as listed and leaves the list, with no second publish", async () => {
    const deps = makeDeps(new Map([["d1", "live"], ["d2", "pending_review"]]));
    const steps: [string, unknown][] = [];
    const out = await listBunch("seller", [made("a", "d1"), made("b", "d2")], files, place, ["porch"], () => {}, deps, (k, p) => steps.push([k, p]));
    expect(out).toMatchObject([{ key: "a", title: "Oak a", status: "live" }, { key: "b", title: "Oak b", status: "pending_review" }]);
    expect(steps).toEqual([["a", null], ["b", null]]);
    expect(deps.updateDraft).not.toHaveBeenCalled();
    expect(deps.publishMany).not.toHaveBeenCalled();
  });

  it("a draft that is gone gets a new one, with its photos again", async () => {
    const deps = makeDeps(new Map());
    const out = await listBunch("seller", [made("a", "d1")], files, place, ["porch"], () => {}, deps);
    expect(deps.createDraft).toHaveBeenCalledTimes(1);
    expect(deps.addPhoto).toHaveBeenCalledWith("seller", "fresh", files.get("p"));
    expect(deps.publishMany).toHaveBeenCalledWith(["fresh"], expect.any(Function));
    expect(out[0]).toMatchObject({ key: "a", status: "live" });
  });

  it("any other status is named and leaves the list; a failed read changes nothing", async () => {
    const taken = makeDeps(new Map([["d1", "rejected"]]));
    const out = await listBunch("seller", [made("a", "d1")], files, place, ["porch"], () => {}, taken);
    expect(out[0]).toMatchObject({ key: "a", draftId: "d1" });
    expect(String((out[0] as { error: Error }).error.message)).toBe("item_not_a_draft");
    expect(taken.publishMany).not.toHaveBeenCalled();
    const blind = makeDeps("read fails");
    await listBunch("seller", [made("a", "d1")], files, place, ["porch"], () => {}, blind);
    expect(blind.updateDraft).toHaveBeenCalledWith("d1", expect.anything());
    expect(blind.publishMany).toHaveBeenCalledWith(["d1"], expect.any(Function));
  });
});
