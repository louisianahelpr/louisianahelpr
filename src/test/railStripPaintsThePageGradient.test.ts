/**
 * CLASS CHECK: wherever an AppShell frame sits beside the desktop rail, the
 * strip the frame does not cover is painted by `body` with the page gradient
 * and #root is transparent, in BOTH arrangements the frame can be in:
 *   - an app-shell route (`html.web-desktop.app-shell`), and
 *   - a document-scroll route that mounts the frame anyway
 *     (`html.web-desktop:not(.app-shell) … :has(.app-shell-frame)`): every
 *     signed-in 404 (NotFound marks its own path document-scroll; /quotes and
 *     its two sub-routes render it while the 'quotes' switch is off), /help,
 *     /support and Legal (PublicLayout's AppShell, Q179).
 * And the dark override of that body paint covers both arrangements too.
 *
 * Why: index.html gives #root an inline LIGHT boot gradient. prod-audit run
 * 39008504928 (rail-inset) measured `div#root right=1024 pos=static`, padding
 * 0, under the open rail on /quotes, /quotes/request/:id and /quotes/send/:id
 * at 1024/1280/1440/1920: the frame was inset (frameRight=248) and #root's
 * boot paint showed around the rail, a light band in dark mode.
 *
 * Inventory comes from src/index.css itself (postcss).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

// @mutate src/index.css |   html.web-desktop:not(.app-shell) #root:has(.app-shell-frame) {\n    background: transparent !important; |   html.web-desktop:not(.app-shell) #root:has(.app-shell-frame).x {\n    background: transparent !important;
// @mutate src/index.css | html[data-theme="dark"].web-desktop:not(.app-shell) body:has(.app-shell-frame), | html[data-theme="dark"].web-desktop.x:not(.app-shell) body:has(.app-shell-frame),

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Every selector, normalised, mapped to the declarations its rule sets. */
function rules(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  postcss.parse(css).walkRules((rule) => {
    const decls: Record<string, string> = {};
    for (const n of rule.nodes) if (n.type === "decl") decls[(n as postcss.Declaration).prop] = (n as postcss.Declaration).value.trim();
    for (const raw of rule.selectors) out.set(norm(raw), { ...(out.get(norm(raw)) ?? {}), ...decls });
  });
  return out;
}

const ARRANGEMENTS = [
  { name: "app-shell route", root: "html.web-desktop.app-shell #root", body: "html.web-desktop.app-shell body", dark: 'html[data-theme="dark"].web-desktop.app-shell body' },
  {
    name: "document-scroll route with a frame",
    root: "html.web-desktop:not(.app-shell) #root:has(.app-shell-frame)",
    body: "html.web-desktop:not(.app-shell) body:has(.app-shell-frame)",
    dark: 'html[data-theme="dark"].web-desktop:not(.app-shell) body:has(.app-shell-frame)',
  },
];

function missing(css: string): string[] {
  const r = rules(css);
  const out: string[] = [];
  for (const a of ARRANGEMENTS) {
    if (!/^transparent/.test(r.get(a.root)?.background ?? "")) out.push(`${a.name}: #root keeps its boot paint (${a.root})`);
    if (r.get(a.body)?.["background-image"] !== "var(--page-gradient)") out.push(`${a.name}: body does not paint the page gradient (${a.body})`);
    if (r.get(a.dark)?.["background-image"] !== "var(--page-gradient)") out.push(`${a.name}: no dark body paint (${a.dark})`);
  }
  return out;
}

describe("the strip beside the desktop rail is the page's own paint, not #root's boot gradient", () => {
  it("catches the original: only the app-shell arrangement was covered", () => {
    const original = `
      [data-theme="dark"] .bg-premium-page, html[data-theme="dark"].web-desktop.app-shell body { background-image: var(--page-gradient); }
      @media (min-width: 900px) {
        html.web-desktop.app-shell body { background-image: var(--page-gradient); }
        html.web-desktop.app-shell #root { background: transparent !important; }
      }`;
    expect(missing(original)).toEqual([
      "document-scroll route with a frame: #root keeps its boot paint (html.web-desktop:not(.app-shell) #root:has(.app-shell-frame))",
      "document-scroll route with a frame: body does not paint the page gradient (html.web-desktop:not(.app-shell) body:has(.app-shell-frame))",
      'document-scroll route with a frame: no dark body paint (html[data-theme="dark"].web-desktop:not(.app-shell) body:has(.app-shell-frame))',
    ]);
  });

  it("src/index.css covers both arrangements", () => {
    const css = readFileSync("src/index.css", "utf8");
    // Floor: the boot gradient this exists for is still inline on #root.
    expect(readFileSync("index.html", "utf8")).toMatch(/<div id="root" style="background:/);
    expect(rules(css).size).toBeGreaterThan(200);
    expect(missing(css)).toEqual([]);
  });
});
