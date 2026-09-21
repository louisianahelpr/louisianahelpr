/**
 * VN-30 (owner, 2026-09-14): "can't scroll these options".
 *
 * The review popup's quick-tag chips sat on ONE horizontal line with a hidden
 * scrollbar and a right-edge fade mask. On desktop a mouse wheel scrolls
 * vertically, so the clipped chips ("Highly recommend", "Friendly & helpful")
 * could not be reached at all. They must wrap onto rows instead.
 *
 * Source-level on purpose: jsdom has no layout, and rendering ReviewForm needs
 * the whole review panel's data layer. Fails on the original
 * `flex gap-2 … overflow-x-auto scrollbar-none [mask-image:…]` string.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "ReviewForm.tsx"), "utf8");

describe("ReviewForm quick review tags (VN-30)", () => {
  it("wrap onto rows rather than hiding in a scroll strip", () => {
    const m = /aria-label="Quick review tags"\s*className="([^"]*)"/.exec(src);
    expect(m, "could not find the Quick review tags group").not.toBeNull();
    const cls = m![1];
    expect(cls, "tag row does not wrap").toMatch(/\bflex-wrap\b/);
    expect(cls, "tag row still scrolls horizontally").not.toMatch(/overflow-x-(auto|scroll)/);
    expect(cls, "tag row still hides its scrollbar").not.toMatch(/scrollbar-none/);
    expect(cls, "tag row still has the right-edge fade mask").not.toMatch(/mask-image/);
  });

  it("no wrapper reintroduces the scroll strip around the group", () => {
    // The assertion above pins ONE element's className, so the identical
    // defect written one level out — `<div className="overflow-x-auto
    // scrollbar-none [mask-image:…]">` wrapping the wrapped chip group —
    // would clip the same chips with this guard still green. jsdom has no
    // layout and rendering ReviewForm needs the whole review panel's data
    // layer, so the check is source-level: the JSX immediately enclosing the
    // group must not carry a horizontal scroller either.
    const at = src.indexOf('aria-label="Quick review tags"');
    expect(at, "could not find the Quick review tags group").toBeGreaterThan(-1);
    const enclosing = src.slice(Math.max(0, at - 600), at);
    expect(enclosing, "a wrapper scrolls the tag row horizontally").not.toMatch(
      /overflow-x-(auto|scroll)/,
    );
    expect(enclosing, "a wrapper still fades the tag row's right edge").not.toMatch(
      /mask-image/,
    );
  });
});

// VN-30 reverting: the chips back on one clipped line, where a desktop mouse
// wheel scrolls vertically and "Highly recommend" cannot be reached at all.
// @mutate src/components/reviewPanel/ReviewForm.tsx | className="flex flex-wrap gap-2 pt-1 pb-1" | className="flex gap-2 pt-1 pb-1 overflow-x-auto scrollbar-none"
