/**
 * Owner on their iPhone, 2026-10-30: "I listed a few pictures of each item and bulk upload added it as each picture a
 * separate item and don't even write the listing with ai." A phone's dropped request used to do exactly that. This pins:
 *   - a failed batch tries again by itself, with backoff, and not while the page is away;
 *   - a batch that may be too much for the connection goes again in two halves;
 *   - photos out of tries stay TOGETHER with the reason: no item per photo, and nothing that can be listed;
 *   - a page closed mid-sort brings them back the same way (useBunchSaved, in declutterBunchSaved.test.tsx);
 *   - an item that straddles two batches joins, or carries a merge suggestion when the check can't run.
 *
 * @mutate src/lib/declutter/bunch.ts |   return { ...blankItem(photoKeys), notSorted: true, sortReason }; |   return { ...blankItem(photoKeys), sortReason };
 * @mutate src/lib/declutter/bunch.ts |   if (it.notSorted) return "These photos aren't sorted yet."; |   void it.notSorted;
 * @mutate src/lib/declutter/bunch.ts |         made = await sendPart(good, cleaned, connectionDown ? [] : SORT_RETRY_DELAYS_MS); |         made = await sendPart(good, cleaned, []);
 * @mutate src/lib/declutter/bunch.ts |         if (!connectionDown && good.length >= 2 && sizeMayBeWhy(error)) { |         if (false) {
 * @mutate src/lib/declutter/bunch.ts |           made = made.map((it) => (it === first ? { ...it, mergeHint: before.key } : it)); |           void first;
 * @mutate src/lib/declutter/bunch.ts |             made = made.filter((it) => it !== first); |             void first;
 * @mutate src/lib/declutter/steadyRetry.ts |       if (awayCount() !== awayBefore) { |       if (false) {
 * @mutate src/lib/declutter/steadyRetry.ts |     await whenBack();\n    const awayBefore |     const awayBefore
 */
import { AI_CHECK_GAP_MS } from "@/lib/declutter/moves";
import { describe, expect, it, vi } from "vitest";
import { addSorted, bunchItemProblem, bunchListable, blankItem, groupPhotos, joinSorted, mightBeSameThing, notSortedPile, type BunchPhoto, type GroupAnswer, type SortExtras } from "@/lib/declutter/bunch";
import { withRetries, worthTryingAgain } from "@/lib/declutter/steadyRetry";

const photo = (key: string): BunchPhoto => ({ key, file: new File([key], `${key}.jpg`, { type: "image/jpeg" }) });
const many = (n: number) => Array.from({ length: n }, (_, i) => photo(`p${i}`));
const loadFailed = () => new TypeError("Load failed");
const drafted = (photos: number[], title: string) => ({ photos, title, description: "Words.", category: "furniture", deliverySize: "large" as const, conditionStars: 4, flagged: false });
let nextName = 0;
/** A different thing each time, so no two batches look alike. */
const oneThing = (files: File[]): GroupAnswer => ({ items: [drafted(files.map((_, i) => i), `Thing${++nextName}`)], leftover: [] });

const noWait = async () => {};
const clean = async (f: File) => f;
function sort(photos: BunchPhoto[], ask: (f: File[]) => Promise<GroupAnswer>, extras: SortExtras = {}) {
  const waits: number[] = [];
  const shown: string[][] = [];
  const run = groupPhotos(photos, (_d, _t, made) => shown.push(made.flatMap((m) => m.photoKeys)), ask, async (ms) => { waits.push(ms); }, () => 1e9, clean, { whenBack: noWait, awayCount: () => 0, ...extras });
  return { run, waits, shown };
}

describe("a failed batch keeps trying before it gives up", () => {
  it("a dropped request is tried again with backoff, and then sorts", async () => {
    const ask = vi.fn(async (f: File[]) => {
      if (ask.mock.calls.length <= 2) throw loadFailed();
      return oneThing(f);
    });
    const { run, waits } = sort(many(3), ask);
    const res = await run;
    expect(ask).toHaveBeenCalledTimes(3);
    expect(waits.filter((ms) => ms !== AI_CHECK_GAP_MS)).toEqual([5_000, 20_000]);
    expect(res.failed).toEqual([]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].notSorted).toBeFalsy();
    expect(res.items[0].photoKeys).toEqual(["p0", "p1", "p2"]);
  });

  it("a try the page was sent away during doesn't use one up, and the next waits until it's back", async () => {
    let away = 0;
    const whenBack = vi.fn(noWait);
    const ask = vi.fn(async (f: File[]) => {
      if (ask.mock.calls.length <= 4) {
        away += 1;
        throw loadFailed();
      }
      return oneThing(f);
    });
    const { run, waits } = sort(many(2), ask, { awayCount: () => away, whenBack });
    const res = await run;
    expect(res.failed).toEqual([]);
    // Four tries killed by iOS: no backoff spent, each new try waited for the page.
    expect(waits.filter((ms) => ms !== AI_CHECK_GAP_MS)).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(5);
    expect(whenBack).toHaveBeenCalledTimes(5);
  });

  it("a timeout goes again in two halves, in order: smaller bodies for a slow connection", async () => {
    const sent: number[] = [];
    const ask = async (f: File[]) => {
      sent.push(f.length);
      if (f.length === 8) throw new Error("ai_timed_out");
      return oneThing(f);
    };
    const { run } = sort(many(8), ask);
    const res = await run;
    expect(sent).toEqual([8, 8, 8, 4, 4]);
    expect(res.failed).toEqual([]);
    expect(res.items.flatMap((i) => i.photoKeys)).toEqual(many(8).map((p) => p.key));
  });

  it("a refusal is not tried again: it would answer the same", async () => {
    const ask = vi.fn(async () => { throw new Error("under_18"); });
    const { run } = sort(many(3), ask);
    await run;
    expect(ask).toHaveBeenCalledTimes(1);
    expect(worthTryingAgain(new Error("under_18"))).toBe(false);
    expect(worthTryingAgain(loadFailed())).toBe(true);
  });

  it("after a whole batch dies on the connection, later batches get one try each, and one success ends that", async () => {
    const sent: number[] = [];
    let call = 0;
    const ask = async (f: File[]) => {
      sent.push(f.length);
      call += 1;
      // Batch 1: 3 tries, then 2 tries each of 2 halves. Batch 2: one try. Batch 3 gets through. Batch 4 is back to full tries.
      if (call <= 8) throw loadFailed();
      return oneThing(f);
    };
    const { run } = sort(many(32), ask);
    const res = await run;
    expect(sent).toEqual([8, 8, 8, 4, 4, 4, 4, 8, 8, 8]);
    expect(res.failed.map((f) => f.photos)).toEqual([4, 4, 8]);
  });
});

describe("what still can't be sorted stays together, with why", () => {
  it("a batch out of tries is ONE pile with the reason, never an item per photo (the owner's bug)", async () => {
    const { run, shown } = sort(many(8), async () => { throw loadFailed(); });
    const res = await run;
    const piles = res.items.filter((i) => i.notSorted);
    // Two halves of one batch, joined on the screen by addSorted.
    const onScreen = addSorted([], res.items);
    expect(onScreen).toHaveLength(1);
    expect(onScreen[0].photoKeys).toEqual(many(8).map((p) => p.key));
    expect(onScreen[0].sortReason).toContain("Connection trouble");
    expect(piles.every((p) => p.photoKeys.length > 1)).toBe(true);
    expect(shown.flat()).toHaveLength(8);
  });

  it("a model answer that places nothing comes back as one pile, not one item per photo", async () => {
    const { run } = sort(many(4), async () => ({ items: [], leftover: [0, 1, 2, 3] }));
    const res = await run;
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ notSorted: true, photoKeys: ["p0", "p1", "p2", "p3"] });
    expect(res.items[0].sortReason).toBeTruthy();
  });

  it("a pile can't be listed, whatever it holds", () => {
    const pile = { ...notSortedPile(["a"], "why"), title: "Filled in", price: "20" };
    expect(bunchItemProblem(pile)).toMatch(/aren't sorted/);
    expect(bunchListable([pile], false)).toEqual([]);
  });

  it("addSorted keeps one pile, first, with every photo and the latest reason", () => {
    const item = { ...blankItem(["x"]), title: "Chair" };
    const out = addSorted([notSortedPile(["a"], "old"), item], [notSortedPile(["b"], "new"), { ...blankItem(["y"]), title: "Rug" }]);
    expect(out.map((i) => i.photoKeys)).toEqual([["a", "b"], ["x"], ["y"]]);
    expect(out[0].sortReason).toBe("new");
  });
});

describe("an item that straddles two batches", () => {
  const batchOfChair = (f: File[]): GroupAnswer => ({ items: [drafted(f.map((_, i) => i), "Oak rocking chair")], leftover: [] });

  it("joins when the tool sees one thing in photos from both sides", async () => {
    const sent: number[] = [];
    const onJoined = vi.fn();
    const { run, shown } = sort(many(12), async (f) => {
      sent.push(f.length);
      return batchOfChair(f);
    }, { onJoined });
    const res = await run;
    // Two batches, then the check: 2 photos of each side.
    expect(sent).toEqual([8, 4, 4]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].photoKeys).toEqual(many(12).map((p) => p.key));
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(shown[1]).toEqual([]);
  });

  it("stays two items when the tool sees two things", async () => {
    let call = 0;
    const { run } = sort(many(12), async (f) => {
      call += 1;
      if (call === 3) return { items: [drafted([0, 1], "Oak rocking chair"), drafted([2, 3], "Wicker rocking chair")], leftover: [] };
      return batchOfChair(f);
    });
    const res = await run;
    expect(res.items).toHaveLength(2);
    expect(res.items[1].mergeHint).toBeUndefined();
  });

  it("carries a merge suggestion when the check can't run", async () => {
    let call = 0;
    const { run } = sort(many(12), async (f) => {
      call += 1;
      if (call === 3) throw loadFailed();
      return batchOfChair(f);
    });
    const res = await run;
    expect(res.items).toHaveLength(2);
    expect(res.items[1].mergeHint).toBe(res.items[0].key);
  });

  it("spends no call on items that aren't named alike, and never joins past the photo limit", async () => {
    const ask = vi.fn(async (f: File[]) => oneThing(f));
    await sort(many(12), ask).run;
    expect(ask).toHaveBeenCalledTimes(2);
    expect(mightBeSameThing({ ...blankItem(["a"]), title: "Floor lamp" }, { ...blankItem(["b"]), title: "Table lamp" })).toBe(true);
    expect(mightBeSameThing({ ...blankItem(["a"]), title: "Floor lamp" }, { ...blankItem(["b"]), title: "Oak chair" })).toBe(false);
    expect(mightBeSameThing({ ...blankItem(["a"]), title: "" }, { ...blankItem(["b"]), title: "" })).toBe(false);
  });

  it("joining onto an item the seller already dropped keeps the photos as their own item", () => {
    const from = { ...blankItem(["b"]), title: "Chair" };
    expect(joinSorted([], "gone", from)).toEqual([from]);
  });
});

describe("withRetries", () => {
  it("gives the last error once the delays are used up", async () => {
    const step = vi.fn(async () => { throw loadFailed(); });
    await expect(withRetries(step, { delays: [1, 2], pause: noWait, whenBack: noWait, awayCount: () => 0 })).rejects.toThrow("Load failed");
    expect(step).toHaveBeenCalledTimes(3);
  });
});
