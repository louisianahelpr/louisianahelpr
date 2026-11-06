/**
 * HOTFIX 2026-11-05 (live since 8ec1841d7f, 12:57 PM): the desktop left rail was not drawn on any page at any desktop
 * width (an empty 248 px strip). Found by vacuity's rail-inset.spec baseline (run 42151534551: dashboard@1024 rail
 * width 0). Cause: scripts/inline-shell-css.mjs wrote <style id="lh-shell-css"> just before </head>, AFTER the app
 * stylesheet <link>. The landing and auth shells use the class `hidden`, so the block carried `.hidden{display:none}`
 * but not `.lg\:flex`, and an inline rule later in the document out-ranks the sheet's
 * `@media (min-width:1024px){.lg\:flex{display:flex}}` at equal specificity: the rail (`hidden lg:flex`) stayed
 * display:none. Measured (dummy-backend lab, main dist 9075dc8b11, signed-in /home): rail 0x0 at 900/1024/1440; the
 * same dist with the block moved before the link: 248 px at all three; the 16 first-frame pairs (/, /login, /signup,
 * /home x 375/1440, inline-only and inline+sheet) 0 px different.
 *
 * Rule: the inlined block (a SUBSET of the app sheet) sits BEFORE every app stylesheet link, so the sheet comes later
 * and repeats every rule in its own order; the cascade is then exactly the sheet's.
 *
 * @mutate scripts/inline-shell-css.mjs |   const at = sheet >= 0 && sheet < head ? sheet : head; |   const at = head;
 * @mutate scripts/inline-shell-css.mjs |   const sheet = html.indexOf('<link rel="stylesheet" href="/assets/'); |   const sheet = -1;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineShellCss } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");
const LINKS =
  '<link rel="preload" as="style" href="/assets/index-AbCd1234.css"><link rel="stylesheet" href="/assets/index-AbCd1234.css" media="print" data-async-css><noscript><link rel="stylesheet" href="/assets/index-AbCd1234.css"></noscript>';
// The built head as vite writes it: the async app sheet inside <head>, before the manifest and the end of head.
const BUILT = INDEX.replace("</head>", `${LINKS}<link rel="manifest" href="/manifest.webmanifest"></head>`);
// The rail's pair: a rule the shells need (`hidden`) and the breakpoint rule they do not (`lg:flex`).
const SHEET = [".hidden{display:none}", "@media (min-width:1024px){.lg\\:flex{display:flex}}", "html{line-height:1.5}"].join("");

describe("the inlined first-screen CSS never out-ranks the app sheet", () => {
  const { html } = inlineShellCss(BUILT, SHEET);
  const style = html.indexOf('<style id="lh-shell-css">');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="\/assets\/[^"]+\.css"/g)].map((m) => m.index!);

  it("finds the block and the app sheet links (the parser works)", () => {
    expect(style).toBeGreaterThan(0);
    expect(sheets.length).toBeGreaterThan(1);
    // The shells really do use `hidden`, so the block carries the rule that hid the rail.
    expect(html.slice(style, html.indexOf("</style>", style))).toContain(".hidden{display:none}");
  });

  it("the block sits before EVERY app stylesheet link, and still inside <head>", () => {
    for (const at of sheets) expect(style).toBeLessThan(at);
    expect(style).toBeLessThan(html.indexOf("</head>"));
  });

  it("with no app stylesheet in the head it still lands in <head>", () => {
    const { html: bare } = inlineShellCss(INDEX, SHEET);
    const at = bare.indexOf('<style id="lh-shell-css">');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(bare.indexOf("</head>"));
  });
});
