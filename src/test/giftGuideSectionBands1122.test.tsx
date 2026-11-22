/**
 * SECTION HEADERS ARE SHADED BANDS (owner 2026-11-22, on the live guides: "Add some kind of shading or something so you
 * can tell where each section is better"). The price-section headers ("Under $25 (36)", "$25 to $50 (30)" ...) on Her,
 * Him and Kids were plain bold text over a hairline and blended into the rows. Each is now a band in a light tint of its
 * guide's own colour (Her oat, Him green, Kids red: the guide's cover family), full width, padded, with a 4px bar of the
 * guide's colour on its left, more room above each section and the words a little bolder, on the phone and the
 * computer alike. Every section still starts open (owner 11-22, "everything expanded"); the chevron stays.
 *
 * The contrast is computed here from the stylesheet's own colours (header words and the count >= 4.5:1 on the tint, light
 * and dark theme) and the band must read as a band on the white page (>= 1.15:1). Measured in Chromium on 2026-11-22
 * (local dev build of this branch): see the commit message for the boxes.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | border-left:4px solid var(--gg-sec-bar);border-radius:10px;background:var(--gg-sec-bg);color:var(--gg-sec-ink); | border-left:4px solid var(--gg-sec-bar);border-radius:10px;background:transparent;color:var(--gg-sec-ink);
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sec-red{--gg-sec-bg:#f7e4e3;--gg-sec-ink:#7a1c22; | .gg-sec-red{--gg-sec-bg:#f7e4e3;--gg-sec-ink:#c98a8c;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sec-oat{--gg-sec-bg:#f2e9da; | .gg-sec-oat{--gg-sec-bg:#fefcf9;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | :root[data-theme="dark"] .gg-sec-green{--gg-sec-bg:#1f3328;--gg-sec-ink:#dcebdf;--gg-sec-muted:#b7cdbb; | :root[data-theme="dark"] .gg-sec-green{--gg-sec-bg:#1f3328;--gg-sec-ink:#dcebdf;--gg-sec-muted:#3c5d47;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sec-toggle-h{margin:24px 0 0} | .gg-sec-toggle-h{margin:14px 0 0}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <h2 className={`gg-sec-title gg-sec-toggle-h gg-sec-${guide.tint}`} | <h2 className="gg-sec-title gg-sec-toggle-h"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

await loadAllGuidePicks();
afterEach(cleanup);

const rule = (selector: string) => {
  const at = GIFT_GUIDES_CSS.indexOf(`${selector}{`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = GIFT_GUIDES_CSS.slice(at + selector.length + 1, GIFT_GUIDES_CSS.indexOf("}", at));
  return Object.fromEntries(body.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
};
/** WCAG 2 contrast ratio of two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const TINTS = ["oat", "green", "red"] as const;

describe("price-section headers are shaded bands in the guide's tint (owner 2026-11-22)", () => {
  it("the band: the tint's background, a 4px bar of the guide's colour, padded, full width, bolder words, more room above", () => {
    const band = rule(".gg-sec-toggle-h .gg-sec-toggle");
    expect(band).toMatchObject({ background: "var(--gg-sec-bg)", color: "var(--gg-sec-ink)", "border-left": "4px solid var(--gg-sec-bar)", "font-weight": "800" });
    expect(Number.parseInt(band["padding-left"] ?? band.padding?.split(" ")[3] ?? "0", 10)).toBeGreaterThanOrEqual(8);
    expect(rule(".gg-sec-toggle").width).toBe("100%");
    // The band keeps the button's own 48px height (Button size md asks h-12; the a11y sweep fails a size class that
    // renders taller, as a 52px band did on the first try).
    expect(band["min-height"]).toBeUndefined();
    expect(band.height).toBeUndefined();
    expect(rule(".gg-sec-toggle")["min-height"]).toBe("48px");
    expect(rule(".gg-sec-toggle-h .gg-sec-count").color).toBe("var(--gg-sec-muted)");
    expect(rule(".gg-sec-toggle-h .gg-sec-chev").color).toBe("var(--gg-sec-ink)");
    // More room above each section than the 14px it had.
    expect(Number.parseInt(rule(".gg-sec-toggle-h").margin, 10)).toBeGreaterThan(14);
    // One band design for every width: the shading is set once, outside any breakpoint.
    expect(GIFT_GUIDES_CSS.match(/\.gg-sec-toggle-h \.gg-sec-toggle\{/g)).toHaveLength(1);
  });

  it.each(TINTS)("%s: words and count are at least 4.5:1 on the tint (light and dark), and the band reads on the page", (tint) => {
    const light = rule(`.gg-sec-${tint}`);
    const dark = { ...light, ...rule(`:root[data-theme="dark"] .gg-sec-${tint}`) };
    for (const [theme, v] of [["light", light], ["dark", dark]] as const) {
      expect(v["--gg-sec-bg"], `${tint} ${theme}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(v["--gg-sec-ink"], v["--gg-sec-bg"]), `${tint} ${theme} words`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--gg-sec-muted"], v["--gg-sec-bg"]), `${tint} ${theme} count`).toBeGreaterThanOrEqual(4.5);
      // The bar is decoration (the words carry the meaning); it only has to differ from the band it edges.
      expect(v["--gg-sec-bar"], `${tint} ${theme} bar`).not.toBe(v["--gg-sec-bg"]);
    }
    // A light band visibly darker than the white page, but still a soft tint (never a solid block).
    const onWhite = contrast(light["--gg-sec-bg"], "#ffffff");
    expect(onWhite, `${tint} band on the page`).toBeGreaterThanOrEqual(1.15);
    expect(onWhite, `${tint} band stays light`).toBeLessThan(1.5);
  });

  it("on Her, Him and Kids every price section's header wears its guide's tint, and every section starts open", async () => {
    let headers = 0;
    for (const slug of ["her", "him", "kids"]) {
      const tint = guideBySlug(slug)!.tint;
      let c!: HTMLElement;
      await act(async () => {
        c = render(
          <MemoryRouter initialEntries={[`/gift-guides/${slug}`]}>
            <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
          </MemoryRouter>,
        ).container;
      });
      const toggles = [...c.querySelectorAll<HTMLButtonElement>("button[data-gift-section-toggle]")];
      expect(toggles.length, slug).toBeGreaterThan(2);
      for (const b of toggles) {
        const h2 = b.closest("h2")!;
        expect(h2.classList.contains(`gg-sec-${tint}`), `${slug} ${b.dataset.giftSectionToggle}`).toBe(true);
        expect(b.getAttribute("aria-expanded"), slug).toBe("true");
        headers++;
      }
      cleanup();
    }
    expect(new Set(["her", "him", "kids"].map((s) => guideBySlug(s)!.tint))).toEqual(new Set(TINTS));
    expect(headers).toBeGreaterThan(9);
  });
});
