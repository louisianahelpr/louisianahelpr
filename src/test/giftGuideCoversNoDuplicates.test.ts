/**
 * No product on two gift guide covers of the same landing section (owner 11-18: "No duplicates on cover", then "no
 * repeats within a section"): the manifest the cover script writes (scripts/gift-guide-cover-items.json) holds each
 * cover's section and products, and scripts/check-gift-cover-duplicates.mjs finds a product key (brand or line plus
 * kind) or name on more than one cover of a section. The same product in two different sections is allowed. Careers
 * may repeat, never on two career covers next to each other (the two before it in landing order).
 *
 * @mutate scripts/check-gift-cover-duplicates.mjs |       for (const k of new Set(ids(cover))) if (theirs.has(k)) out.push | for (const k of []) if (theirs.has(k)) out.push
 *
 * @mutate scripts/check-gift-cover-duplicates.mjs |         if (seen && !seen.includes(slug)) seen.push(slug); |         if (false) seen.push(slug);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANIFEST, coverDuplicates } from "../../scripts/check-gift-cover-duplicates.mjs";

type Manifest = Record<string, { section: string; items: { name: string; key: string }[] }>;
// Landing rows, held in constants so fixtureSchemaContract does not read them as saved_searches.section literals.
const BY_PERSON = "By person";
const BY_CAREER = "By career";
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
const stanley = (name: string) => ({ name, key: "stanley:drink" });

describe("gift guide covers carry no repeats within a section", () => {
  it("lists every cover with its section and products", () => {
    // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20 (54 covers).
    expect(Object.keys(manifest).length).toBeGreaterThan(45);
    expect(Object.values(manifest).reduce((n, c) => n + c.items.length, 0)).toBeGreaterThan(200); // Builder 3 1120b (no Amazon photos, only picks still in the guide): 244 measured 2026-11-20
    for (const c of Object.values(manifest)) expect(typeof c.section).toBe("string");
  });

  it("finds a product planted on a second cover of the same section", () => {
    const planted: Manifest = { a: { section: BY_PERSON, items: [stanley("Stanley 40 oz")] }, b: { section: BY_PERSON, items: [stanley("Other Stanley")] } };
    expect(coverDuplicates(planted)).toEqual(["By person key stanley:drink: a, b"]);
  });

  it("allows the same product in two different sections", () => {
    const twoRows: Manifest = { a: { section: BY_PERSON, items: [stanley("Stanley 40 oz")] }, b: { section: BY_CAREER, items: [stanley("Stanley 40 oz")] } };
    expect(coverDuplicates(twoRows)).toEqual([]);
  });

  it("careers repeat only away from their neighbors", () => {
    const c = (items: { name: string; key: string }[]) => ({ section: BY_CAREER, items });
    const spaced: Manifest = { a: c([stanley("S")]), b: c([{ name: "x", key: "x:1" }]), d: c([{ name: "y", key: "y:1" }]), e: c([stanley("S")]) };
    expect(coverDuplicates(spaced)).toEqual([]);
    const near: Manifest = { a: c([stanley("S")]), b: c([{ name: "x", key: "x:1" }]), d: c([stanley("S")]) };
    expect(coverDuplicates(near)).toContain("By career neighbors key stanley:drink: a, d");
  });

  it("no product key or name is on two covers of one section", () => {
    expect(coverDuplicates(manifest)).toEqual([]);
  });
});
