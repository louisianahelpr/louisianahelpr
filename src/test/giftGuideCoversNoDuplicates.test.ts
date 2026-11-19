/**
 * No product on two gift guide covers of the same landing section (owner 11-18: "No duplicates on cover", then "no
 * repeats within a section"): the manifest the cover script writes (scripts/gift-guide-cover-items.json) holds each
 * cover's section and products, and scripts/check-gift-cover-duplicates.mjs finds a product key (brand or line plus
 * kind) or name on more than one cover of a section. The same product in two different sections is allowed.
 *
 * @mutate scripts/check-gift-cover-duplicates.mjs |         if (seen && !seen.includes(slug)) seen.push(slug); |         if (false) seen.push(slug);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANIFEST, coverDuplicates } from "../../scripts/check-gift-cover-duplicates.mjs";

type Manifest = Record<string, { section: string; items: { name: string; key: string }[] }>;
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
const stanley = (name: string) => ({ name, key: "stanley:drink" });

describe("gift guide covers carry no repeats within a section", () => {
  it("lists every cover with its section and products", () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(300);
    expect(Object.values(manifest).reduce((n, c) => n + c.items.length, 0)).toBeGreaterThan(1000);
    for (const c of Object.values(manifest)) expect(typeof c.section).toBe("string");
  });

  it("finds a product planted on a second cover of the same section", () => {
    const planted: Manifest = { a: { section: "By person", items: [stanley("Stanley 40 oz")] }, b: { section: "By person", items: [stanley("Other Stanley")] } };
    expect(coverDuplicates(planted)).toEqual(["By person key stanley:drink: a, b"]);
  });

  it("allows the same product in two different sections", () => {
    const twoRows: Manifest = { a: { section: "By person", items: [stanley("Stanley 40 oz")] }, b: { section: "By career", items: [stanley("Stanley 40 oz")] } };
    expect(coverDuplicates(twoRows)).toEqual([]);
  });

  it("no product key or name is on two covers of one section", () => {
    expect(coverDuplicates(manifest)).toEqual([]);
  });
});
