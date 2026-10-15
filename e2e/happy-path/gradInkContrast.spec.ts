/**
 * TEXT ON THE PRIMARY GRADIENT IS READABLE, IN BOTH THEMES, AT EVERY SITE
 * (Q?btn-grad-text-contrast).
 *
 * `.btn-grad-primary` paints the surface and, until this guard, nothing else:
 * the ink was each call site's job. `<Button>` pins it (button.tsx), and the
 * hand-rolled sites (40 of them on 2026-10-15) each stated it, or did not. One that did not inherits
 * the page's ink, `--foreground` (olivewood), which is the SAME family as the
 * gradient: measured on the token values, 1.2-2.5:1 in light and 1.8-2.5:1 in
 * dark. SeriesDatesPanel's "Pick N dates" was one.
 *
 * WHAT THIS MEASURES. Every element in src/ that wears the class, read from
 * the source by ./gradInkSites (no hand list), is rendered as a fixture with
 * its own class string, inline colour and text-bearing descendants, against
 * the BUILT stylesheet (dist/assets/*.css; CLAUDE.md: never the dev server).
 * In light and in dark, each glyph's COMPUTED colour (alpha and ancestor
 * opacity composited) is scored against every stop of the COMPUTED gradient:
 * text needs 4.5:1, an icon 3:1 (WCAG 1.4.3 / 1.4.11). A glyph that sits on a
 * surface of its own between it and the gradient (SegmentedControl's count
 * badge) is not on the gradient, so it is skipped; every site must still have
 * at least one glyph measured, or the test fails as blind.
 *
 * Breaking the guarded source: drop the class-level ink from
 * `.btn-grad-primary` and SeriesDatesPanel's button inherits olivewood again.
 * (registered below the imports: its find text holds a comment terminator).
 *
 * setContent only: no app boot, no Supabase, no preview server needed beyond
 * the build the happy-path job already runs (playwright.config.ts webServer).
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gradSites, fixtureHtml } from "./gradInkSites";

// @mutate src/index.css | light and dark. */\n  color: hsl(var(--parchment)); | light and dark. */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = resolve(REPO, "dist/assets");

function builtCss(): string {
  if (!existsSync(ASSETS)) throw new Error("dist/assets is missing: run `npm run build` (the happy-path webServer does)");
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".css"));
  if (files.length === 0) throw new Error("dist/assets has no .css: the build did not emit a stylesheet");
  const css = files.map((f) => readFileSync(resolve(ASSETS, f), "utf8")).join("\n");
  if (!css.includes(".btn-grad-primary")) throw new Error("the built CSS has no .btn-grad-primary rule");
  return css;
}

type Finding = { site: string; theme: string; glyph: string; ratio: number | null; why: string };

test.describe("text on btn-grad-primary", () => {
  test("every site's glyphs clear AA on every gradient stop, light and dark", async ({ page }) => {
    const all = gradSites();
    // Inventory floor: 41 sites on 2026-10-15. A parser that silently found
    // nothing would pass every assertion below.
    expect(all.length).toBeGreaterThan(35);
    // The ONE site whose class this parser cannot rebuild: <Button>'s own
    // element, whose variant is a runtime prop. Every <Button> call site is
    // rendered with its own variant's class string instead (gradInkSites.ts).
    expect(all.filter((s) => !s.resolved).map((s) => s.site.replace(/:\d+$/, ""))).toEqual(["src/components/ui/button.tsx"]);
    const sites = all.filter((s) => s.resolved);

    const body = sites.map((s, i) => `<div data-site="${i}" data-shape="${s.shape}" style="padding:4px">${fixtureHtml(s.root, String(i))}</div>`).join("\n");
    const css = builtCss();

    const findings: Finding[] = [];
    const measured = new Map<number, number>();
    for (const theme of ["light", "dark"]) {
      // A FRESH document per theme, born with its data-theme. Flipping the
      // attribute on a live page starts every `transition-colors` /
      // `transition-all` site's colour transition, and getComputedStyle read
      // straight after returns the START of it: the first run of this spec (2026-10-15)
      // reported 20 dark-theme sites at "2.49:1", every one of them the LIGHT
      // parchment caught mid-transition (and the screenshot showed the same).
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><style>${css}</style></head><body>${body}</body></html>`);
      const rows = await page.evaluate(() => {
        const parse = (s: string): number[][] =>
          [...s.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(/[\s,/]+/).filter(Boolean).map(Number));
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const out: { i: number; glyph: string; ratio: number | null; why: string }[] = [];
        for (const wrap of Array.from(document.querySelectorAll<HTMLElement>("[data-site]"))) {
          const i = Number(wrap.dataset.site);
          const grad = wrap.querySelector<HTMLElement>("[data-grad]");
          const stops = grad ? parse(getComputedStyle(grad).backgroundImage).map((c) => c.slice(0, 3)) : [];
          if (!grad || stops.length < 2) { out.push({ i, glyph: "-", ratio: null, why: "the gradient is not painted (no colour stops in the computed background-image)" }); continue; }
          // "pill": the gradient is a backdrop and the glyphs are its siblings.
          const scope = wrap.dataset.shape === "pill" && grad.parentElement ? grad.parentElement : grad;
          for (const el of Array.from(wrap.querySelectorAll<HTMLElement>("[data-ink]"))) {
            if (!(scope === el || scope.contains(el))) continue;
            // A surface of its own between the glyph and the gradient: not ours to score.
            let own = false; let alpha = 1;
            for (let n: HTMLElement | null = el; n && n !== grad && n !== scope.parentElement; n = n.parentElement) {
              const cs = getComputedStyle(n);
              alpha *= Number(cs.opacity);
              if (n === scope && scope !== grad) continue;
              const bg = parse(cs.backgroundColor)[0];
              if ((bg && (bg[3] ?? 1) > 0) || cs.backgroundImage !== "none") { own = true; break; }
            }
            if (own) { out.push({ i, glyph: el.dataset.ink!, ratio: null, why: "own-surface" }); continue; }
            const c = parse(getComputedStyle(el).color)[0];
            const a = (c[3] ?? 1) * alpha;
            const worst = Math.min(...stops.map((s) => ratio(c.slice(0, 3).map((v, k) => v * a + s[k] * (1 - a)), s)));
            out.push({ i, glyph: `${el.dataset.ink} "${getComputedStyle(el).color}"`, ratio: Math.round(worst * 100) / 100, why: "" });
          }
        }
        return out;
      });
      for (const r of rows) {
        const site = sites[r.i].site;
        if (r.why === "own-surface") continue;
        if (r.ratio === null) { findings.push({ site, theme, glyph: r.glyph, ratio: null, why: r.why }); continue; }
        measured.set(r.i, (measured.get(r.i) ?? 0) + 1);
        const floor = r.glyph.startsWith("icon") ? 3 : 4.5;
        if (r.ratio < floor) findings.push({ site, theme, glyph: r.glyph, ratio: r.ratio, why: `below ${floor}:1` });
      }
    }
    // Fail closed: a site whose fixture carried no glyph measured nothing.
    const blind = sites.filter((_, i) => !measured.has(i)).map((s) => s.site);
    expect(blind, "sites where no glyph was measured").toEqual([]);
    expect(findings.map((f) => `${f.site} [${f.theme}] ${f.glyph}: ${f.ratio ?? "-"} ${f.why}`)).toEqual([]);
  });
});
