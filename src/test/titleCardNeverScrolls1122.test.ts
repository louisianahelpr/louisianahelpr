/**
 * Deep audit 11-22 #14 (Medium): on /jobs?tab=working and ?tab=posted at 375, tapping (or tabbing to) a status chip
 * at the right end ("Completed", "Cancelled") slid the whole Jobs header 4px left, cutting the "J" of Jobs, the "B" of
 * Browse and the search box's edge.
 *
 * Measured locally (dev build, 375): the status chip row bleeds 4px past the title card (`-mx-1`, so its first chip
 * lines up with the title), the card's scrollWidth was 347 against a 343 clientWidth, and because the card was
 * `overflow: hidden` (a scroll container) the browser's scroll-into-view moved it: scrollLeft 4. With `overflow: clip`
 * the same call moves nothing (scrollLeft 0), and the edge still paints clipped.
 *
 * CLASS: every page title card is drawn from TITLE_CARD_CLASS (PageScaffold is its one renderer; the `page-title-card`
 * name appears nowhere else in markup), so the card itself must clip, never hide. A new hand-rolled title card fails
 * the inventory below until it uses the shared class.
 *
 * @mutate src/components/ui/pageCardSurfaces.ts | relative overflow-hidden supports-[overflow:clip]:overflow-clip"; | relative overflow-hidden";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";
import { TITLE_CARD_CLASS } from "@/components/ui/pageCardSurfaces";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Files that name `page-title-card` and why. EXACT. */
const NAMES_THE_CARD: Record<string, string> = {
  "src/components/ui/pageCardSurfaces.ts": "defines TITLE_CARD_CLASS",
};

describe("the page title card can never be scrolled sideways (deep audit 11-22 #14)", () => {
  it("TITLE_CARD_CLASS clips (overflow: clip where supported), so scroll-into-view cannot shift the header", () => {
    const classes = TITLE_CARD_CLASS.split(/\s+/);
    expect(classes).toContain("page-title-card");
    expect(classes).toContain("supports-[overflow:clip]:overflow-clip");
  });

  it("PageScaffold paints the title card from the shared class", () => {
    expect(code("src/components/ui/PageScaffold.tsx")).toMatch(/\bTITLE_CARD_CLASS\b/);
  });

  it("no other file draws its own page-title-card (exact, both ways)", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(800);
    const naming = files.filter((f) => /page-title-card/.test(code(f))).sort();
    expect(naming).toEqual(Object.keys(NAMES_THE_CARD).sort());
  });
});
