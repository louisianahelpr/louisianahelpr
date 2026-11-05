/**
 * Q2705 (Slow 4G first frame, lead 11-05 "A+B now"): the HTML-drawn landing shell paints with the HTML, not after the
 * app stylesheet. scripts/inline-shell-css.mjs copies the compiled rules the #lh-landing-shell markup needs into a
 * <style id="lh-shell-css"> in dist/index.html's head, with the shell's show rule. Measured before (live, Slow 4G + 4x,
 * 375, guest "/"): LCP 2108-2168 ms while the HTML is in at ~0.9 s.
 *
 * @mutate scripts/inline-shell-css.mjs | if (!vocab.classes.has(unescapeCss(m[1]))) return false; | if (!vocab.classes.has(unescapeCss(m[1]))) {}
 * @mutate scripts/inline-shell-css.mjs |     if (!vocab.tags.has(t)) return false; |     if (!vocab.tags.has(t)) {}
 * @mutate scripts/inline-shell-css.mjs | #lh-landing-shell{display:block; | #lh-landing-shell{display:none;
 * @mutate scripts/inline-shell-css.mjs |   const block = `<style id="${STYLE_ID}">${critical}${SHOW_RULE}</style>`; |   const block = `<style id="${STYLE_ID}">${SHOW_RULE}</style>`;
 * @mutate scripts/inline-shell-css.mjs |     if (!families.has(fam)) at.remove(); |     at.remove();
 * @mutate scripts/inline-shell-css.mjs |     if (!families.has(fam)) at.remove(); |     {}
 * @mutate package.json | node scripts/inline-shell-css.mjs && node scripts/build-og-shell.mjs | node scripts/build-og-shell.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineShellCss, SHELL_END, SHELL_START, shellCriticalCss, shellVocabulary } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");
const SHELL = INDEX.slice(INDEX.indexOf(SHELL_START), INDEX.indexOf(SHELL_END));

// A compiled sheet in the shape Tailwind emits: the tokens, preflight, utilities the shell uses and ones it does not.
const SHEET = [
  ":root{--lp-money:20 50% 40%}",
  '[data-theme="dark"]{--lp-money:20 50% 60%}',
  "*,:before,:after{box-sizing:border-box}",
  "html{line-height:1.5}",
  "@font-face{font-family:Bodoni Moda;src:url(/fonts/b.woff2)}",
  "@font-face{font-family:Unused Face;src:url(/fonts/u.woff2)}",
  "@keyframes spin{to{transform:rotate(360deg)}}",
  ".landing-h1{font-size:44px}",
  ".font-display{font-family:Bodoni Moda,serif}",
  ".not-in-the-shell-xyz{color:red}",
  "table{border-collapse:collapse}",
  ".landing-h1,.not-in-the-shell-xyz{letter-spacing:-.01em}",
  "@media (min-width:1024px){.lg\\:mt-7{margin-top:1.75rem}.not-in-the-shell-xyz{margin:0}}",
  "@media (min-width:9999px){.not-in-the-shell-xyz{margin:0}}",
  "#some-other-id{display:none}",
].join("");

describe("the landing shell's own CSS rides in the HTML (Q2705)", () => {
  it("reads the classes, ids and elements of the real index.html shell", () => {
    const v = shellVocabulary(SHELL);
    expect(v.classes.size, "the shell's class inventory").toBeGreaterThan(100);
    for (const c of ["landing-h1", "font-display", "landing-page", "lg:mt-7"]) expect(v.classes.has(c), c).toBe(true);
    expect(v.ids.has("lh-landing-shell")).toBe(true);
    for (const t of ["h1", "p", "em", "nav"]) expect(v.tags.has(t), t).toBe(true);
  });

  it("keeps the rules the shell needs and drops the rest", () => {
    const out = shellCriticalCss(SHELL, SHEET);
    expect(out).toContain(":root{--lp-money:20 50% 40%}");
    expect(out).toContain('[data-theme="dark"]{--lp-money:20 50% 60%}');
    expect(out).toContain("box-sizing:border-box");
    expect(out).toContain("html{line-height:1.5}");
    expect(out).toContain(".landing-h1{font-size:44px}");
    expect(out).toContain(".font-display{");
    expect(out).toContain(".landing-h1{letter-spacing:-.01em}");
    expect(out).toContain("@media (min-width:1024px){.lg\\:mt-7{margin-top:1.75rem}}");
    expect(out).not.toContain("not-in-the-shell-xyz");
    expect(out).not.toContain("9999px");
    expect(out).not.toContain("table{");
    expect(out).not.toContain("#some-other-id");
    expect(out, "the hero's own face, or it paints in a fallback and swaps").toContain("@font-face{font-family:Bodoni Moda;src:url(/fonts/b.woff2)}");
    expect(out).not.toContain("Unused Face");
    expect(out).not.toContain("@keyframes");
  });

  it("writes them with the show rule into <head>, once", () => {
    const { html } = inlineShellCss(INDEX, SHEET);
    const at = html.indexOf('<style id="lh-shell-css">');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf("</head>"));
    const block = html.slice(at, html.indexOf("</style>", at));
    expect(block).toContain(".landing-h1{font-size:44px}");
    expect(block).toContain("[data-lh-landing-shell] #lh-landing-shell{display:block;position:fixed;inset:0;");
    expect(() => inlineShellCss(html, SHEET)).toThrow(/already inlined/);
    expect(() => inlineShellCss("<html><head></head><body></body></html>", SHEET)).toThrow(/no #lh-landing-shell/);
  });

  it("npm run build inlines it after vite build and before the share function snapshots the shell", () => {
    const build = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.build as string;
    expect(build).toMatch(/^vite build && .*node scripts\/inline-shell-css\.mjs && node scripts\/build-og-shell\.mjs/);
  });
});
