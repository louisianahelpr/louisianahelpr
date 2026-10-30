/*
 * GUARD (DA-8, Declutter audit 10-29): "Browse scrolls a little even when the list is short".
 *
 * Measured (WebKit, helper-e2e on prod, read-only, ~/.lh-shots/b104/da8/probe-before.log): at 1440 with the map
 * beside the list, every short Browse (1 card, a search that misses, ?free=1, a category with nothing in it) had
 * a scrollHeight of 791 in a 771px scroll column, because the sticky map column was `clientHeight - 24` tall and
 * the list's wrapper adds 4px above and 24px below it, plus the column's 16px bottom padding. After: 771 / 771.
 *
 * The map column's height is mapFillHeight(scroller): the visible height minus that padding, read from the live
 * styles, so a change to SectionScreen's padding cannot bring the scroll back.
 */
// @mutate src/components/declutter/DeclutterBrowseView.tsx | setHeight(mapFillHeight(scroller)) | setHeight(Math.max(320, scroller.clientHeight - 24))
// @mutate src/lib/declutter/mapFillHeight.ts | px(inner, "paddingTop") + px(inner, "paddingBottom") | px(inner, "paddingTop")
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { mapFillHeight } from "./mapFillHeight";

/** SectionScreen's scroll column as it measured at 1440: 771px tall, pb 16, inner wrapper pt 4 / pb 24. */
function column(clientHeight: number, pb: string, innerPt: string, innerPb: string) {
  const scroller = document.createElement("div");
  scroller.style.paddingBottom = pb;
  Object.defineProperty(scroller, "clientHeight", { value: clientHeight });
  const inner = document.createElement("div");
  inner.style.paddingTop = innerPt;
  inner.style.paddingBottom = innerPb;
  scroller.appendChild(inner);
  return scroller;
}

describe("Declutter Browse map column height (DA-8)", () => {
  it("leaves room for the padding around the list, so a short list does not scroll", () => {
    const h = mapFillHeight(column(771, "16px", "4px", "24px"));
    expect(h).toBe(727);
    // The whole column with a list no taller than the map: wrapper pt + map + wrapper pb + column pb.
    expect(4 + h + 24 + 16).toBeLessThanOrEqual(771);
  });

  it("follows the live padding rather than a fixed number", () => {
    expect(mapFillHeight(column(800, "0px", "0px", "0px"))).toBe(800);
    expect(mapFillHeight(column(700, "112px", "4px", "24px"))).toBe(560);
  });

  it("never goes below the 320px floor", () => {
    expect(mapFillHeight(column(300, "16px", "4px", "24px"))).toBe(320);
  });

  it("is what Browse sizes its map column with", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    const uses = src.match(/setHeight\(mapFillHeight\(scroller\)\)/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/clientHeight\s*-\s*\d+/);
  });
});
