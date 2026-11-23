/**
 * The phone's one-line menu tip at small phones (guide train p 11-23): at 320px wide "Tap [menu icon] for deals, free
 * printables & more" ran out of room and ended in "..."; the owner wants the tip on exactly one line.
 *   1. The tip carries both wordings: the owner's ("for deals, free printables & more", .gg-menuhint-l) and the short
 *      one ("for deals, printables & more", .gg-menuhint-s), the short one the same words without "free".
 *   2. The CSS shows exactly one of them, by width alone (no script measures anything): the short words are hidden by
 *      default; under 375px the owner's words hide and the short ones show; under 346px the words are 12.5px. Top-level
 *      media queries only (after the 767px phone block, so they win over its 14px). The widths come from the build,
 *      measured in Chromium and WebKit (Montserrat 600 14px): the owner's words need 276.3px of text room and a phone
 *      has (width - 96px) at those widths, so they fit from 373px (375: 279px); the short words need 244.9px (fit from
 *      341px) and 220.6px at 12.5px (320: 224px). So 360px phones, which also cut the owner's words, get the short words.
 *   3. The line stays one line that may never wrap (white-space:nowrap) in the 38px box.
 * The browser proof (scrollWidth <= clientWidth at 320, 360 and 375, one line, 38px box) is in the train p report
 * (~/.lh-shots/guide-p-1123/fit-results.json).
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:374px){.gg-menuhint-l{display:none}.gg-menuhint-s{display:inline}} | @media (max-width:374px){.gg-menuhint-s{display:inline}}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:374px){.gg-menuhint-l | @media (max-width:359px){.gg-menuhint-l
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:345px){.gg-menuhint-go{font-size:12.5px}} | @media (max-width:345px){.gg-menuhint-go{font-size:13px}}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-menuhint-s{display:none}\n | \n
 * @mutate src/content/giftGuides.ts | afterShort: "for deals, printables & more" | afterShort: "for deals, free printables & more"
 * @mutate src/pages/info/giftGuides/GiftGuideMenuHint.tsx |           <span className="gg-menuhint-s">{W.afterShort}</span> |
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GuidesMenuHint } from "@/pages/info/giftGuides/GiftGuideMenuHint";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { giftGuides as G } from "@/content/giftGuides";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { blankComments } from "./helpers/blankNonCode";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetHintsForTests();
});

/** The CSS's top-level rules (a media block kept whole), in order. */
function topRules(raw: string): string[] {
  // Comments blanked to spaces (never deleted: guardsDoNotDeleteSource), so a rule after a comment still starts the slice.
  const css = blankComments(raw);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return out.filter(Boolean);
}

describe("gift guides: the menu tip stays one line at 320, 360 and 375px (train p 11-23)", () => {
  it("carries the owner's words and the short words, the short ones the same without 'free'", () => {
    const { container } = render(<MemoryRouter><GuidesMenuHint /></MemoryRouter>);
    const open = container.querySelector("[data-gift-menu-hint-open]")!;
    expect(open.querySelector(".gg-menuhint-l")?.textContent).toBe("for deals, free printables & more");
    expect(open.querySelector(".gg-menuhint-s")?.textContent).toBe("for deals, printables & more");
    expect(G.menuHint.afterShort).toBe(G.menuHint.after.replace("free ", ""));
    expect(G.menuHint.afterShort.length).toBeLessThan(G.menuHint.after.length);
  });

  it("the CSS shows exactly one wording: the short one only under 375px, 12.5px under 346px, from top-level media queries", () => {
    const rules = topRules(GIFT_GUIDES_CSS);
    expect(rules.length).toBeGreaterThan(20);
    // The short words are hidden by default (a top-level rule, so it holds at every width).
    expect(rules).toContain(".gg-menuhint-s{display:none}");
    const small = rules.filter((r) => /gg-menuhint-(l|s|go)\b/.test(r) && r.startsWith("@media") && !r.startsWith("@media (max-width:767px)"));
    expect(small).toEqual([
      "@media (max-width:374px){.gg-menuhint-l{display:none}.gg-menuhint-s{display:inline}}",
      "@media (max-width:345px){.gg-menuhint-go{font-size:12.5px}}",
    ]);
    // Both come after the phone block that sets the tip's 14px, so at equal specificity they win.
    const phone = rules.findIndex((r) => r.startsWith("@media (max-width:767px)") && r.includes(".gg-menuhint-go{"));
    expect(phone).toBeGreaterThan(-1);
    for (const r of small) expect(rules.indexOf(r)).toBeGreaterThan(phone);
    // Nothing else shows the short words or hides the owner's, anywhere in the CSS (nested blocks included).
    expect(GIFT_GUIDES_CSS.match(/\.gg-menuhint-s\{[^}]*\}/g)).toEqual([".gg-menuhint-s{display:none}", ".gg-menuhint-s{display:inline}"]);
    expect(GIFT_GUIDES_CSS.match(/\.gg-menuhint-l\{[^}]*\}/g)).toEqual([".gg-menuhint-l{display:none}"]);
  });

  it("the line never wraps, in the 38px box", () => {
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-menuhint-t\{[^}]*white-space:nowrap/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-menuhint\{display:flex;[^}]*height:38px/);
  });
});
