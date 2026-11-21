/**
 * For Him and For Kids are the owner's own Amazon saves (owner 2026-11-21: "i also added the mens stuff to the amazon
 * men list", "i did kids too in amazon list", "add all oft he things to the guides. fix them how you see fit. launch the
 * 3 guides"). Each page is ONE flat list, cheapest first, with at most 2 of a brand and 2 of an item type, every pick an
 * Amazon link with her tag and no price on the site.
 * @mutate scripts/giftGuideHimKids1121.mjs | pageList[slug] = picks; | void picks;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIM_1121, KIDS_1121, applyHimKids1121, him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";

type Pick = { name: string; brand?: string; href: string; image: string; store: string; type?: string; price?: unknown; sortPrice?: unknown; rels?: string[] };
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const most = (xs: string[]) => Math.max(0, ...Object.values(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})));

describe.each([
  ["him", HIM_1121 as { sortPrice: number }[], him1121Picks() as Pick[]],
  ["kids", KIDS_1121 as { sortPrice: number }[], kids1121Picks() as Pick[]],
])("For %s is the owner's Amazon saves (11-21)", (slug, rows, built) => {
  const page = chunk(slug);

  it("the live page is exactly the module's list, in order", () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(page.length).toBe(rows.length);
    expect(page.map((p) => p.href)).toEqual(built.map((p) => p.href));
    expect(new Set(page.map((p) => p.href)).size).toBe(page.length);
  });

  it("every pick is an Amazon link with her tag, Amazon's own photo and no price", () => {
    for (const p of page) {
      expect(p.href).toMatch(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=louisianahelpr-20$/);
      expect(p.image).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
      expect(p.store).toBe("store-amazon");
      expect(p.price).toBeUndefined();
      expect(p.sortPrice).toBeUndefined();
    }
  });

  it("is cheapest first", () => {
    const sorted = [...rows].sort((a, b) => a.sortPrice - b.sortPrice);
    expect((sorted as unknown as Pick[]).map((r) => r.href)).toEqual(page.map((p) => p.href));
  });

  it("holds at most 2 of one brand and 2 of one item type", () => {
    expect(most(page.map((p) => p.brand ?? "").filter(Boolean))).toBeLessThanOrEqual(2);
    expect(most(page.map((p) => p.type ?? ""))).toBeLessThanOrEqual(2);
  });

  it("shows as one flat owner list (no chips, no codes box)", () => {
    expect(isOwnerList(slug)).toBe(true);
  });
});

describe("the generator sets Him and Kids last", () => {
  it("applyHimKids1121 replaces both pages", () => {
    const pages: Record<string, unknown[]> = { him: [{ name: "old" }], kids: [], her: [{ name: "keep" }] };
    const out = applyHimKids1121(pages);
    expect(out.him).toEqual({ before: 1, after: HIM_1121.length });
    expect(pages.kids.length).toBe(KIDS_1121.length);
    expect(pages.her).toEqual([{ name: "keep" }]);
  });

  it("runs after the final sweep and before the pages are written", () => {
    const src = readFileSync("scripts/gift-guide-picks.mjs", "utf8");
    const sweep = src.indexOf("console.log(`gift-guide-picks: final sweep");
    const apply = src.lastIndexOf("applyHimKids1121(pageList)");
    const write = src.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(sweep).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(sweep);
    expect(write).toBeGreaterThan(apply);
  });

  it("men's picks keep relationship tags so /dad and /husband still build", () => {
    const him = chunk("him");
    for (const rel of ["dad", "husband", "boyfriend", "brother"]) expect(him.filter((p) => p.rels?.includes(rel)).length).toBeGreaterThan(10);
  });
});
