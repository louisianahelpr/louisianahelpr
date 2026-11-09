/**
 * Q2705 (Slow 4G first frame, lead 11-05 "A+B now"): the HTML-drawn landing shell paints with the HTML, not after the
 * app stylesheet. scripts/inline-shell-css.mjs copies the compiled rules the #lh-landing-shell markup needs into a
 * <style id="lh-shell-css"> in dist/index.html's head, with the shell's show rule. Measured before (live, Slow 4G + 4x,
 * 375, guest "/"): LCP 2108-2168 ms while the HTML is in at ~0.9 s.
 *
 * @mutate scripts/inline-shell-css.mjs |       if (doc.querySelector(base)) return true; |       if (doc.querySelector(base) && base.includes(":")) return true;
 * Trim plan (Q2705 B, 11-05): a first frame has no hover/focus/press and no motion, so those selectors and the
 * transition/animation/will-change declarations stay in the app sheet only (":not(:focus-visible)" still applies).
 * @mutate scripts/inline-shell-css.mjs | (s) => !dynamic(s) && selectorNeeded(s, docs) | (s) => selectorNeeded(s, docs)
 * @mutate scripts/inline-shell-css.mjs | (d) => d.remove());
 | (d) => void d);

 * @mutate scripts/inline-shell-css.mjs | s.replace(/:not\([^()]*\)/g, "") | s
 * @mutate scripts/inline-shell-css.mjs |   return false;\n} | return true;\n}
 * @mutate scripts/inline-shell-css.mjs | data-theme="${theme}" ${htmlAttr}><head> | data-theme="${theme}"><head>
 * @mutate scripts/inline-shell-css.mjs | const FIXED = "{display:block; | const FIXED = "{display:none;
 * @mutate scripts/inline-shell-css.mjs | `<style id="${STYLE_ID}">${critical}${present | `<style id="${STYLE_ID}">${present
 * @mutate scripts/inline-shell-css.mjs |     if (!families.has(fam)) at.remove(); |     at.remove();
 * @mutate scripts/inline-shell-css.mjs |     if (!families.has(fam)) at.remove(); |     {}
 * @mutate scripts/inline-shell-css.mjs |   root.walkDecls((d) => { if (d.prop.startsWith("--") && !used.has(d.prop)) d.remove(); }); |
 * @mutate scripts/inline-shell-css.mjs | for (const n of refs(v)) if (!used.has(n)) { used.add(n); queue.push(n); } | {}
 * @mutate package.json | node scripts/inline-shell-css.mjs && node scripts/build-og-shell.mjs | node scripts/build-og-shell.mjs
 * Item page speed (11-09): a phone-only shell never needs a desktop (min-width >= 900px) rule.
 * @mutate scripts/inline-shell-css.mjs |     const at = minWidthAbove(rule) >= DESKTOP_PX ? wideDocs : docs; |     const at = docs;
 * @mutate scripts/inline-shell-css.mjs | extra: ITEM_PHOTO_MARKUP, phoneOnly: true }, | extra: ITEM_PHOTO_MARKUP },
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_PX, inlineShellCss, SHELL_END, SHELL_START, SHELLS, shellCriticalCss, shellVocabulary } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");
const SHELL = INDEX.slice(INDEX.indexOf(SHELL_START), INDEX.indexOf(SHELL_END));

// A compiled sheet in the shape Tailwind emits: the tokens, preflight, utilities the shell uses and ones it does not.
const SHEET = [
  ":root{--lp-money:20 50% 40%}",
  // Tokens: one read by a kept rule through another token, one read by nothing in the first frame.
  ":root{--chain-a-xyz:var(--chain-b-xyz);--chain-b-xyz:3px;--unused-token-xyz:1px}",
  ".landing-h1{margin:var(--chain-a-xyz)}",
  ".not-in-the-shell-xyz{padding:var(--unused-token-xyz)}",
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
  // Measured 11-05: matching by class names alone dropped rules like these, and the hero painted 190 px too high.
  ".landing-h1:not(.absent-xyz){padding-top:190px}",
  "[data-lh-landing-shell] .landing-page{min-height:100vh}",
  ".landing-h1:hover{color:red}",
  ".landing-h1:not(:focus-visible){outline:none}",
  ".landing-h1{transition:color .2s;-webkit-animation:spin 1s;animation:spin 1s;will-change:transform;color:#111}",
  ".font-display::before{content:''}",
  ".not-in-the-shell-xyz:hover{color:blue}",
  "div>.not-in-the-shell-xyz{color:green}",
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
    expect(out, "a :not() of something absent still matches").toContain(".landing-h1:not(.absent-xyz){padding-top:190px}");
    expect(out, "the attribute index.html sets on <html>").toContain("[data-lh-landing-shell] .landing-page{min-height:100vh}");
    expect(out, "a first frame has no hover: the app sheet brings it").not.toContain(":hover");
    expect(out, "a :not() of a dynamic state applies at first frame").toContain(".landing-h1:not(:focus-visible){outline:none}");
    expect(out, "the colour stays, the motion goes").toContain(".landing-h1{color:#111}");
    expect(out).not.toMatch(/transition|animation|will-change/);
    expect(out).toContain(".font-display::before{content:''}");
    expect(out).not.toContain("not-in-the-shell-xyz");
    expect(out).not.toContain("9999px");
    expect(out).not.toContain("table{");
    expect(out).not.toContain("#some-other-id");
    expect(out, "the hero's own face, or it paints in a fallback and swaps").toContain("@font-face{font-family:Bodoni Moda;src:url(/fonts/b.woff2)}");
    expect(out).not.toContain("Unused Face");
    expect(out).not.toContain("@keyframes");
    expect(out, "a token read through another token stays").toContain(":root{--chain-a-xyz:var(--chain-b-xyz);--chain-b-xyz:3px}");
    expect(out, "a token nothing in the first frame reads goes (it kept the block over its byte cap)").not.toContain("--unused-token-xyz");
  });

  it("keeps a desktop rule only for a shell that can show on the desktop website (item page speed, 11-09)", () => {
    const sheet = [
      "@media (min-width:900px){.lg\\:grid{display:grid}.lg\\:mt-7{margin-top:1.75rem}}",
      "@media (min-width:640px){.sm\\:pt-6{padding-top:1.5rem}}",
      ".mt-4{margin-top:1rem}",
    ].join("");
    const wide = { html: '<div class="lg:mt-7"></div>', htmlAttr: 'data-lh-landing-shell=""' };
    const phone = { html: '<div class="lg:grid sm:pt-6 mt-4"></div>', htmlAttr: 'data-lh-app-shell="item"' };
    const out = shellCriticalCss([wide, { ...phone, phoneOnly: true }], sheet);
    expect(out, "a phone-only shell's desktop rule goes").not.toContain("display:grid");
    expect(out, "a wide shell's desktop rule stays").toContain(".lg\\:mt-7{margin-top:1.75rem}");
    expect(out, "a phone-only shell's small-tablet rule stays").toContain(".sm\\:pt-6{padding-top:1.5rem}");
    expect(out).toContain(".mt-4{margin-top:1rem}");
    expect(shellCriticalCss([wide, phone], sheet), "the same shell, not phone-only").toContain("display:grid");
  });

  it("every shell an app page shows is phone-only, and every script that shows one stops at the desktop width", () => {
    const appShells = SHELLS.filter((s: { htmlAttr: string }) => s.htmlAttr.startsWith("data-lh-app-shell="));
    expect(appShells.length).toBeGreaterThan(4);
    for (const s of appShells as { id: string; phoneOnly?: boolean }[]) expect(s.phoneOnly, s.id).toBe(true);
    for (const s of SHELLS as { id: string; htmlAttr: string; phoneOnly?: boolean }[]) if (!s.htmlAttr.startsWith("data-lh-app-shell=")) expect(s.phoneOnly, s.id).toBeUndefined();
    const scripts = [...INDEX.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const showing = scripts.filter((b) => /setAttribute\("data-lh-app-shell"/.test(b));
    expect(showing.length).toBeGreaterThan(2);
    for (const b of showing) expect(b, b.slice(0, 120)).toMatch(new RegExp(`window\\.innerWidth (?:>= ${DESKTOP_PX}|< ${DESKTOP_PX})`));
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
