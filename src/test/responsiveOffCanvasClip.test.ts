/**
 * The responsive audit (e2e/visual-audit/responsive.spec.ts) reports an element
 * past the phone's right edge by what the member can SEE, not by its raw box.
 *
 * Release gate e2e-real-backend 41330878323 (2026-11-01, sha 2ee45fd687) was red
 * on "06-activity @ iPhoneSE: <button .inline-flex> right=382", the same line
 * on every scheduled run from 2026-10-20 on. The button is a status chip
 * ("Booked") in the Jobs > Working chip row, a sideways scroll strip
 * (StatusBoxes: overflow-x-auto, right-edge fade). The strip clips the chip at
 * its own edge, inside the screen, and the page has no horizontal scroll. The
 * old check read the chip's raw box and called the strip overflow. Its red
 * also cost the request budget: the serial spec retried all 25 tests, about 556
 * more metered requests and 86 tests instead of 61 (Q104).
 *
 * The check still reports what does not fit: a chip in a row that does not
 * clip, and a scroll strip that itself runs past the edge.
 */
// @mutate e2e/visual-audit/offCanvas.ts |       if (ox === "visible" \|\| ox === "") continue; |       continue;
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findOffCanvas } from "../../e2e/visual-audit/offCanvas";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function box(el: HTMLElement, left: number, right: number) {
  el.getBoundingClientRect = () =>
    ({ left, right, top: 100, bottom: 144, width: right - left, height: 44, x: left, y: 100, toJSON() {} }) as DOMRect;
}

/** The Jobs > Working chip row at 375: a strip from 16 to 359, the third chip from 300 to 386. */
function chipRow(overflowX: string, stripRight = 359, chipLeft = 300, chipRight = 386) {
  document.body.innerHTML = "";
  const strip = document.createElement("div");
  strip.style.overflowX = overflowX;
  const chip = document.createElement("button");
  chip.className = "inline-flex min-h-11";
  chip.textContent = "Booked";
  strip.appendChild(chip);
  document.body.appendChild(strip);
  box(document.body, 0, 375);
  box(strip, 16, stripRight);
  box(chip, chipLeft, chipRight);
  return { strip, chip };
}

describe("responsive audit: off-canvas means visible past the edge", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  });

  it("a chip clipped by its scroll strip inside the screen is not overflow (the 41330878323 false red)", () => {
    chipRow("auto");
    expect(findOffCanvas()).toEqual([]);
  });

  it("the same chip in a row that does not clip IS overflow", () => {
    chipRow("visible");
    const hits = findOffCanvas();
    expect(hits).toHaveLength(1);
    expect(hits[0].rect.x + hits[0].rect.w).toBe(386);
  });

  it("a scroll strip that itself runs past the edge is still overflow, at the strip's edge", () => {
    chipRow("auto", 420);
    const hits = findOffCanvas();
    expect(hits).toHaveLength(1);
    expect(hits[0].rect.x + hits[0].rect.w).toBe(386);
  });

  it("a chip scrolled wholly out of its strip is not on screen", () => {
    chipRow("hidden", 359, 380, 450);
    expect(findOffCanvas()).toEqual([]);
  });

  it("the spec measures with findOffCanvas, never its own raw-box loop", () => {
    const spec = blankComments(readFileSync(resolve(ROOT, "e2e/visual-audit/responsive.spec.ts"), "utf8"));
    expect(spec).toMatch(/page\.evaluate\(findOffCanvas\)/);
    expect(spec).not.toMatch(/getBoundingClientRect/);
    // Inventory floor: the spec still sweeps its six screens at four widths.
    const screens = spec.match(/\{ name: "0\d-[a-z-]+", url:/g) ?? [];
    expect(screens.length).toBeGreaterThan(5);
  });
});
