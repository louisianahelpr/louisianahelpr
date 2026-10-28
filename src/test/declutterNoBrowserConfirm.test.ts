/**
 * CLASS GUARD (lead walkthrough 2026-10-28): Declutter's money and handover moments ask in an in-app sheet, never
 * the browser's window.confirm (a grey system box with no total, no app styling, and on iOS the page's address as
 * its title). Buy now moved to DeclutterReserveSheet; the handover moments did the same earlier (boards 159/160,
 * DeclutterHandoverSheets.tsx).
 *
 * Inventory from source: every non-test .ts/.tsx file under src/components/declutter and src/pages/declutter,
 * comments blanked. The count is EXACT (two-way): moving another site to a sheet lowers it in the same commit, a new
 * window.confirm raises it and fails. The buy path is held at zero on its own.
 *
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const confirmBuy = () => setReserve("ask"); |   const confirmBuy = () => { if (window.confirm("Buy?")) buy.mutate(); };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([join(ROOT, "src/components/declutter"), join(ROOT, "src/pages/declutter")])
  .filter((f) => !/\.test\.tsx?$/.test(f));

/** Sites still on window.confirm on 2026-10-28 (after Buy now moved to its sheet): sell side, Selling and delivery. */
const DECLUTTER_BROWSER_CONFIRMS = 7;

const sites = () =>
  files.flatMap((f) => {
    const n = (blankComments(readFileSync(f, "utf8")).match(/\bwindow\.confirm\s*\(/g) ?? []).length;
    return n ? [{ file: relative(ROOT, f), n }] : [];
  });

describe("Declutter asks in the app, not with window.confirm", () => {
  it("reads a real Declutter source tree", () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith("DeclutterOfferPanel.tsx"))).toBe(true);
  });

  it("Buy now (the offer panel and its reserve sheet) never uses window.confirm", () => {
    const buyPath = sites().filter((s) => /DeclutterOfferPanel|DeclutterReserveSheet/.test(s.file));
    expect(buyPath).toEqual([]);
  });

  it(`exactly ${DECLUTTER_BROWSER_CONFIRMS} window.confirm sites remain (lower this in the same commit as a move to a sheet)`, () => {
    const total = sites().reduce((sum, s) => sum + s.n, 0);
    expect(total, JSON.stringify(sites())).toBe(DECLUTTER_BROWSER_CONFIRMS);
  });
});
