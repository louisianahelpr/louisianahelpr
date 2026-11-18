/*
 * GUARD (owner 2026-11-17): on a phone the footer's Explore links were one long column of ~52px rows. Below 620px
 * Explore now takes the full row with its links in a two-column grid, each link exactly its 44px tap height
 * (min-h-11) with no extra vertical gap, and Legal and Follow sit side by side under it (a two-column grid, no
 * re-ordering). From 620px the 12-column 4/3/2/3 layout is unchanged. jsdom cannot lay out, so this pins the classes.
 * It replaces footerLinkGroupsOneRow (owner 2026-09-23: Explore, Legal and Follow on one row from 360px).
 *
 * @mutate src/components/Footer.tsx | className="grid grid-cols-2 gap-x-4 min-[620px]:block | className="space-y-2 min-[620px]:block
 * @mutate src/components/Footer.tsx | <div className="col-span-2 min-[620px]:col-span-3"> | <div className="min-[620px]:col-span-3">
 * @mutate src/components/Footer.tsx | <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12"> | <div className="grid grid-cols-2 min-[360px]:grid-cols-[auto_auto_auto] gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(import.meta.dirname, "../components/Footer.tsx"), "utf8"));

describe("footer on a phone: Explore in two columns, Legal and Follow under it", () => {
  it("the footer grid is two columns below 620px and 12 from 620px, with no in-between three-column tier", () => {
    expect(src).toContain('<div className="grid grid-cols-2 gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12">');
    expect(src).not.toMatch(/grid-cols-\[auto_auto_auto\]|min-\[500px\]:grid-cols-3/);
  });

  it("Explore spans the full row below 620px and its list is a two-column grid with no vertical gap", () => {
    expect(src).toContain('<div className="col-span-2 min-[620px]:col-span-3">');
    const ul = /<ul data-footer-explore="" className="([^"]+)"/.exec(src)?.[1] ?? "";
    const cls = ul.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "min-[620px]:block"]));
    expect(cls.filter((c) => /^(gap-y-|space-y-)/.test(c))).toEqual([]); // the 44px links touch; no added spacing below 620
  });

  it("every footer link keeps its 44px tap height, and no group is re-ordered", () => {
    expect(src).toContain('const FOOTER_LINK = "link-standard inline-flex items-center min-h-11";');
    const links = src.match(/className=\{FOOTER_LINK\}/g) ?? [];
    expect(links.length).toBeGreaterThan(8);
    expect(src).not.toMatch(/\border-[123]\b/);
  });
});
