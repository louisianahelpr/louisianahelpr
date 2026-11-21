/**
 * The owner's own cover picks (scripts/gift-guide-cover-pins.json; owner 2026-11-21: "for the her guide remove the camera
 * and the biodance from the cover. replace those with the hatch alarm clock and the current body red light mask") are
 * exactly what each pinned cover shows: every pinned name is a product in that guide, the cover manifest the cover
 * script writes (scripts/gift-guide-cover-items.json) lists exactly those products in that order, and any stand-in photo
 * for an Amazon-linked pick is a transparent cutout from another store, never Amazon's.
 *
 * @mutate scripts/gift-guide-photo-covers.py |         return first + [q for q in own if q not in first] |         return [q for q in own if q not in first] + first
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { isAmazonPhoto } from "../../scripts/check-gift-cover-in-guide.mjs";

type Pins = Record<string, { items: string[]; photos?: Record<string, string> }>;
type Pick = { name: string; href: string; store?: string };
const pins = Object.fromEntries(Object.entries(JSON.parse(readFileSync("scripts/gift-guide-cover-pins.json", "utf8")) as Record<string, unknown>).filter(([k]) => !k.startsWith("_"))) as Pins;
const manifest = JSON.parse(readFileSync("scripts/gift-guide-cover-items.json", "utf8")) as Record<string, { items: { name: string; image: string }[] }>;
const picksOf = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const isAmazonPick = (p: Pick) => p.store === "store-amazon" || /amazon\.com\//.test(p.href);

describe("the owner's pinned cover picks (11-21)", () => {
  it("pins her, with six products each", () => {
    expect(Object.keys(pins)).toContain("her");
    for (const [slug, p] of Object.entries(pins)) expect(p.items.length, slug).toBe(6);
  });

  it.each(Object.keys(pins))("%s: every pinned name is in the guide, and the cover shows exactly those, in order", (slug) => {
    const names = new Set(picksOf(slug).map((p) => p.name));
    for (const n of pins[slug].items) expect(names.has(n), `${slug}: "${n}" is not in the guide`).toBe(true);
    expect(manifest[slug]?.items.map((i) => i.name)).toEqual(pins[slug].items);
  });

  it.each(Object.keys(pins))("%s: a stand-in photo is only for an Amazon-linked pick, and is a non-Amazon transparent cutout", (slug) => {
    const picks = picksOf(slug);
    for (const [name, url] of Object.entries(pins[slug].photos ?? {})) {
      const p = picks.find((x) => x.name === name);
      expect(p && isAmazonPick(p), `${slug}: "${name}" is not an Amazon-linked pick in the guide`).toBe(true);
      expect(isAmazonPhoto(url), url).toBe(false);
      expect(url.startsWith(CUTOUT_BASE), url).toBe(true);
      const file = `public/gift-guides/cutouts/${url.slice(CUTOUT_BASE.length)}`;
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 32);
      expect(head.subarray(12, 16).toString("latin1") === "VP8L" || (head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0), `${file} has no alpha`).toBe(true);
    }
  });
});
