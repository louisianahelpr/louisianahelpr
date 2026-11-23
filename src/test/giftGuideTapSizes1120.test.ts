/**
 * Holiday audit D M6 (11-20, salvaged 11-23 onto today's deal cards): every gift guide code Copy control is a 44px tap
 * target. On main the codes are copied from GiftGuideDealCards' chip (the old sidebar Copy button and the Gift of the
 * Day Share left with their screens). Inventory from source: every element marked data-gift-code-copy, with a floor;
 * each one's class must have a CSS rule with min-height 44px or more (the chip is an InlineTextButton, which is
 * text-sized, min-h-0 p-0, unless its own class sets a floor).
 *
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | justify-content:space-between;gap:2px 6px;width:100%;min-height:44px; | justify-content:space-between;gap:2px 6px;width:100%;min-height:28px;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FILES = ["src/pages/info/giftGuides/GiftGuideDealCards.tsx"];

/** Every JSX opening tag carrying `attr`, up to that attribute. */
const tagsWith = (src: string, attr: string) =>
  [...src.matchAll(new RegExp(attr, "g"))].map((m) => src.slice(src.lastIndexOf("<", m.index), m.index! + attr.length));

describe("gift guide code Copy controls are 44px tap targets (holiday audit D M6)", () => {
  it("every data-gift-code-copy element's class sets min-height 44px or more", () => {
    let n = 0;
    for (const f of FILES) {
      const raw = readFileSync(join(ROOT, f), "utf8");
      for (const tag of tagsWith(blankComments(raw), "data-gift-code-copy")) {
        n++;
        const cls = /className="([^"]+)"/.exec(tag)?.[1]?.split(/\s+/)[0];
        expect(cls, tag).toBeTruthy();
        const rule = raw.match(new RegExp(`\\.${cls}\\{[^}]*\\}`))?.[0] ?? "";
        const h = Number(/min-height:(\d+)px/.exec(rule)?.[1] ?? 0);
        expect(h, `${f} .${cls}: ${rule.slice(0, 120)}`).toBeGreaterThanOrEqual(44);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
