/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"; pop-up: the photo tool groups, the seller fixes the grouping).
 * src/lib/declutter/bunch.ts:
 *   - no photo is ever lost: unplaced photos and a failed batch's photos stay
 *     as items to name; fixing the grouping only moves photos between items;
 *   - a split never clears a possible banned item, and a flagged item cannot
 *     be listed (bunchItemProblem, checked again inside listBunch);
 *   - listBunch: one item failing never stops the rest, and each failure keeps
 *     its own reason and whether its draft exists.
 *
 * @mutate src/lib/declutter/bunch.ts |     if (!placed.has(i)) out.push(blankItem([p.key])); |     if (false) out.push(blankItem([p.key]));
 * @mutate src/lib/declutter/bunch.ts |       for (const p of batch) items.push(blankItem([p.key])); |       void batch;
 * @mutate src/lib/declutter/bunch.ts |   const next = { ...blankItem(take), flagged: src.flagged }; |   const next = blankItem(take);
 * @mutate src/lib/declutter/bunch.ts |       if (problem) throw Object.assign(new Error("bunch_item_not_ready"), { userMessage: problem }); |       void problem;
 * @mutate src/lib/declutter/bunch.ts |       out.set(it.key, { key: it.key, title: it.title, error, draftId: id, stays: true }); |       throw error;
 */
import { describe, expect, it, vi } from "vitest";
import {
  bunchItemProblem, dropItem, groupPhotos, itemsFromAnswer, listBunch, mergeItems, movePhoto, splitItem,
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
    const res = await groupPhotos(photos, () => {}, ask, async (ms) => { waits.push(ms); now += ms; }, () => now);
    expect(ask.mock.calls.map((c) => c[0].length)).toEqual([8, 8, 1]);
    expect(waits).toEqual([10_500, 10_500]);
    expect(res.failed).toEqual([{ photos: 8, error: new Error("ai_rate_limited") }]);
    expect(allPhotos(res.items)).toEqual(photos.map((p) => p.key).sort());
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

  it("says what stops an item", () => {
    expect(bunchItemProblem(item("x", ["a"]))).toBeNull();
    expect(bunchItemProblem(item("x", ["a"], { flagged: true }))).toMatch(/can't sell/);
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
      publishMany: vi.fn(async (ids: string[]) => ids.map((id: string) => (id === "id3" ? { id, error: new Error("setup_fee_required") } : { id, status: "live" as const }))),
    };
    const items = [
      item("ok", ["a"]),
      item("bad", ["b"], { title: "Bad" }),
      item("photo", ["c"]),
      item("pub", ["d"]),
      item("flag", ["a"], { flagged: true }),
    ];
    const out = await listBunch("seller", items, files, place, ["porch"], () => {}, deps);
    expect(out.map((o) => [o.key, "status" in o ? o.status : (o.error as Error).message, "draftId" in o ? o.draftId : "-"])).toEqual([
      ["ok", "live", "-"],
      ["bad", "invalid_items", null],
      ["photo", "photo_not_uploaded", "id2"],
      ["pub", "setup_fee_required", "id3"],
      ["flag", "bunch_item_not_ready", null],
    ]);
    // Only the items that got their photos and ways are listed; a flagged item never reaches the server.
    expect(deps.publishMany).toHaveBeenCalledWith(["id1", "id3"], expect.any(Function));
    expect(deps.createDraft).toHaveBeenCalledTimes(4);
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
      publishMany: vi.fn(async () => []),
    };
    const steps: [string, unknown][] = [];
    await listBunch("seller", [item("x", ["a"])], files, place, ["porch"], () => {}, deps, (k, patch) => steps.push([k, patch]));
    expect(steps).toEqual([["x", { draftId: "d9" }]]);
    expect(deps.updateDraft).not.toHaveBeenCalled();
  });
});
