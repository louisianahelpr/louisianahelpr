/**
 * LEAD-BUNCH-34-SLOW (owner 10-31, 34 photos on her iPhone: "takes ages, like it's not even accepting the pictures").
 * Every photo was made ready (decoded, shrunk, location data removed) one after another, and only when its batch's turn
 * came, after the previous batch's photo-tool call had answered: nothing was shown until the first batch was sorted.
 * Now every photo starts at once, PHOTO_WORK_AT_ONCE at a time, in the order picked; each is reported as it is made
 * (its thumbnail and "Adding N of M"), and a later batch's photos are ready while the earlier call is still out.
 *
 * @mutate src/lib/declutter/bunch.ts |   for (let w = 0; w < Math.min(atOnce, photos.length); w++) void worker(); |   for (let w = 0; w < Math.min(1, photos.length); w++) void worker();
 * @mutate src/lib/declutter/bunch.ts |         onEach?.(p.key, copy);\n |
 * @mutate src/lib/declutter/bunch.ts |   const ahead = cleanAhead(photos, clean, onCleaned ? (key, copy) => onCleaned(key, copy) : undefined); |   const ahead = photos.map((p) => clean(p.file).then((copy) => { onCleaned?.(p.key, copy); return { copy }; }, (error: unknown) => ({ error })));
 * @mutate src/lib/declutter/bunch.ts |   const checks = new Map(cleanAhead(loose, clean).map( |   const checks = new Map(cleanAhead(loose, clean, undefined, 1).map(
 */
import { describe, expect, it } from "vitest";
import { cleanAhead, groupPhotos, keepCleanablePhotos, PHOTO_WORK_AT_ONCE, type BunchPhoto, type GroupAnswer } from "@/lib/declutter/bunch";

const photo = (i: number): BunchPhoto => ({ key: `p${i}`, file: new File([`${i}`], `${i}.jpg`, { type: "image/jpeg" }) });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A clean that waits until released, counting how many run at once. */
function heldClean() {
  let running = 0;
  let most = 0;
  const started: string[] = [];
  const waiting: (() => void)[] = [];
  const clean = (file: File) => {
    running += 1;
    most = Math.max(most, running);
    started.push(file.name);
    return new Promise<File>((resolve) => waiting.push(() => { running -= 1; resolve(file); }));
  };
  const releaseAll = async () => {
    while (waiting.length > 0) {
      waiting.splice(0).forEach((go) => go());
      await tick();
    }
  };
  return { clean, started, most: () => most, releaseAll };
}

describe("LEAD-BUNCH-34-SLOW: photos are made ready a few at a time, from the first tap", () => {
  it("cleanAhead runs PHOTO_WORK_AT_ONCE at a time (never all, never one), in order, and reports each one", async () => {
    expect(PHOTO_WORK_AT_ONCE).toBe(4);
    const c = heldClean();
    const seen: string[] = [];
    const out = cleanAhead(Array.from({ length: 34 }, (_, i) => photo(i)), c.clean, (k) => seen.push(k));
    await tick();
    expect(c.started).toEqual(["0.jpg", "1.jpg", "2.jpg", "3.jpg"]);
    await c.releaseAll();
    expect(c.most()).toBe(4);
    expect(seen).toHaveLength(34);
    expect(seen.slice(0, 4)).toEqual(["p0", "p1", "p2", "p3"]);
    expect((await Promise.all(out)).every((r) => "copy" in r)).toBe(true);
  });

  it("a photo that can't be made ready is reported with why, and the rest still go", async () => {
    const out = cleanAhead([photo(0), photo(1), photo(2)], async (f) => {
      if (f.name === "1.jpg") throw new Error("decode_failed");
      return f;
    });
    const r = await Promise.all(out);
    expect("copy" in r[0]).toBe(true);
    expect(r[1]).toEqual({ error: new Error("decode_failed") });
    expect("copy" in r[2]).toBe(true);
  });

  it("34 photos: the second batch's photos are made ready while the first batch's call is still out, and every one is shown as made", async () => {
    const c = heldClean();
    const asked: number[] = [];
    let answerFirst: (a: GroupAnswer) => void = () => {};
    const ask = (cleaned: File[]) => {
      asked.push(cleaned.length);
      if (asked.length === 1) return new Promise<GroupAnswer>((r) => { answerFirst = r; });
      return Promise.resolve({ items: [{ title: "Thing", photos: cleaned.map((_, i) => i), description: "", category: "other", deliverySize: "small", conditionStars: 3, flagged: false }], leftover: [] } as GroupAnswer);
    };
    const made: string[] = [];
    let now = 0;
    const run = groupPhotos(Array.from({ length: 34 }, (_, i) => photo(i)), () => {}, ask, async (ms) => { now += ms; }, () => now, c.clean,
      { whenBack: async () => {}, awayCount: () => 0, onCleaned: (k) => made.push(k) });
    await c.releaseAll();
    // The first call is out and unanswered, and all 34 are already ready and shown: before, the 9th waited for that answer.
    expect(asked).toEqual([8]);
    expect(made).toHaveLength(34);
    expect(c.started).toHaveLength(34);
    expect(c.most()).toBe(4);
    answerFirst({ items: [{ title: "Chair", photos: [0, 1, 2, 3, 4, 5, 6, 7], description: "", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false }], leftover: [] } as GroupAnswer);
    const res = await run;
    expect(asked.slice(0, 5)).toEqual([8, 8, 8, 8, 2]);
    expect(res.items.flatMap((it) => it.photoKeys)).toHaveLength(34);
  });

  it("photos brought back mid-sort are checked a few at a time too", async () => {
    const c = heldClean();
    const run = keepCleanablePhotos(Array.from({ length: 12 }, (_, i) => photo(i)), [], c.clean);
    await tick();
    expect(c.started).toHaveLength(4);
    await c.releaseAll();
    expect((await run).photos).toHaveLength(12);
    expect(c.most()).toBe(4);
  });
});
