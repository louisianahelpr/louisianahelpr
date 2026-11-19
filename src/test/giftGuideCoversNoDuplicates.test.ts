/**
 * No product on two gift guide covers (owner 11-18: "No duplicates on cover"): the manifest the cover script writes
 * (scripts/gift-guide-cover-items.json) holds each cover's products, and scripts/check-gift-cover-duplicates.mjs finds
 * a product key (brand or line plus kind) or name on more than one cover.
 *
 * @mutate scripts/check-gift-cover-duplicates.mjs |         if (seen && !seen.includes(slug)) seen.push(slug); |         if (false) seen.push(slug);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANIFEST, coverDuplicates } from "../../scripts/check-gift-cover-duplicates.mjs";

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, { name: string; key: string }[]>;

describe("gift guide covers carry no duplicate products", () => {
  it("lists every cover with its products", () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(300);
    expect(Object.values(manifest).reduce((n, l) => n + l.length, 0)).toBeGreaterThan(400);
  });

  it("finds a product planted on a second cover", () => {
    const planted = { a: [{ name: "Stanley Quencher 40 oz", key: "stanley:drink" }], b: [{ name: "Other Stanley", key: "stanley:drink" }] };
    expect(coverDuplicates(planted)).toEqual(["key stanley:drink: a, b"]);
  });

  it("no product key or name is on two covers", () => {
    expect(coverDuplicates(manifest)).toEqual([]);
  });
});
