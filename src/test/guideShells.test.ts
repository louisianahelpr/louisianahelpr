/**
 * Guide prerender (11-24; owner rule: pages under 2 s): every live gift guide page, the deals days and the /gift-guides
 * landing have a first screen in the raw HTML (src/prerender/guidePages.tsx -> scripts/lib/guideShellBuild.mjs ->
 * api/share.ts via src/lib/guideShell.mjs), drawn from the page's own component, carrying its banner and its first
 * items (name, link, photo), and src/boot/guideShellHandoff.ts keeps it over the booting app only until the page's own
 * content is on screen.
 *
 * @mutate src/lib/guideShell.mjs |   const page = html.replace(/<div\s+id="boot-loader"[^>]*>/, (open) => `${open}${block}`); |   const page = html;
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", | export const LIVE_GUIDES_1121 = ["her", "lh-not-prerendered",
 * @mutate scripts/lib/guideShellBuild.mjs |   if (items.length > FIRST_SCREEN_ITEMS) { |   if (items.length > 0) {
 * @mutate src/boot/guideShellHandoff.ts |   if (signedIn \|\| el.getAttribute("data-guide-shell") !== path) { |   if (el.getAttribute("data-guide-shell") !== path) {
 * @mutate src/boot/guideShellHandoff.ts |   doc.body.appendChild(el); |   void doc.body;
 * @mutate src/main.tsx | adoptGuideShell(window.location.pathname, tokenProbeAtBoot(), document); | void adoptGuideShell;
 * @mutate api/share.ts |       return respond(guided, meta.cdnCache, 200, meta.noindexHeader === true); |       return respond(page, meta.cdnCache, 200, meta.noindexHeader === true);
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { DEAL_DAY_SLUGS } from "@/content/giftGuideDeals.mjs";
import { GUIDE_SHELL_ID, GUIDE_SHELL_SHOW_RULE, withGuideShell } from "@/lib/guideShell.mjs";
import { adoptGuideShell, GUIDE_SHELL_ELEMENT_ID, GUIDE_SHELL_MAX_MS } from "@/boot/guideShellHandoff";
import { FIRST_SCREEN_ITEMS, ITEM_SELECTOR, guideShellData } from "../../scripts/lib/guideShellBuild.mjs";

// The page renders once per width, as the build's Vite config makes it (useIsMobile aliased to the stub).
vi.mock("@/hooks/use-mobile", async () => await import("@/prerender/useIsMobileStub"));

/** The first n item names of a page, in page order (gift names, deal lines' store names, or Top 10 cards). */
function firstNames(markup: string, n: number): string[] {
  const doc = new DOMParser().parseFromString(`<div>${markup.replace(/<style[\s\S]*?<\/style>/g, "")}</div>`, "text/html");
  const main = doc.querySelector(".gg-main");
  if (!main) return [];
  return [...main.querySelectorAll(ITEM_SELECTOR)].slice(0, n).map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40));
}

let rendered: Record<string, { phone: string; desktop: string }>;
let data: ReturnType<typeof guideShellData>["data"];
let counts: Record<string, number>;
let paths: string[];

beforeAll(async () => {
  const mod = await import("@/prerender/guidePages");
  paths = mod.GUIDE_SHELL_PATHS;
  rendered = await mod.renderGuidePages();
  // A stand-in sheet: the real one is the build's (scripts/prerender-static-pages.mjs reads dist/).
  ({ data, counts } = guideShellData(rendered, ".gg{color:red}"));
}, 120_000);

describe("every live guide page has its first screen in the HTML", () => {
  it("covers the landing and every live guide slug", () => {
    expect(LIVE_GUIDES_1121.length).toBeGreaterThan(6);
    const want = ["/gift-guides", ...LIVE_GUIDES_1121.map((s) => `/gift-guides/${s}`)];
    expect([...paths].sort()).toEqual([...want].sort());
    expect(Object.keys(data.pages).sort()).toEqual([...want].sort());
  });

  it("each block carries the banner and the page's own first items, with their links and photos", () => {
    let checked = 0;
    for (const p of paths) {
      const block = data.pages[p];
      expect(block.startsWith(`<div id="${GUIDE_SHELL_ID}" data-guide-shell="${p}">`), p).toBe(true);
      // A guide opens on at least 4 gifts; a deals day on at least one line (Small Business Saturday's shop grid is read live).
      const least = DEAL_DAY_SLUGS.includes(p.replace("/gift-guides/", "")) ? 1 : 4;
      expect(counts[p], p).toBeGreaterThanOrEqual(least);
      expect(counts[p], p).toBeLessThanOrEqual(FIRST_SCREEN_ITEMS);
      for (const w of ["phone", "desktop"] as const) {
        const full = rendered[p][w];
        const names = firstNames(full, Math.max(least, Math.min(4, counts[p])));
        expect(names.length, `${p} ${w}`).toBeGreaterThanOrEqual(least);
        const own = firstNames(block, FIRST_SCREEN_ITEMS * 2);
        for (const n of names) expect(own, `${p} ${w}: ${n}`).toContain(n);
      }
      // A guide or deals day opens on its banner h1; the landing's h1 is its head row's title.
      expect(block, p).toMatch(/<h1[\s>]/);
      expect(block, p).toMatch(/<a [^>]*href="[^"]+"/);
      expect(block, p).toMatch(/<img [^>]*src="[^"]+"/);
      // Never the whole list: the rest comes with the app.
      const doc = new DOMParser().parseFromString(block, "text/html");
      for (const v of doc.querySelectorAll(`#${GUIDE_SHELL_ID} > [data-lh-guide-v]`)) {
        expect(v.querySelectorAll(ITEM_SELECTOR).length, p).toBeLessThanOrEqual(FIRST_SCREEN_ITEMS);
      }
      expect(block, p).not.toMatch(/<style|<script|<footer/);
      checked++;
    }
    expect(checked).toBeGreaterThan(6);
  });

  it("the rules end with the block's own show rule", () => {
    expect(data.css?.endsWith(GUIDE_SHELL_SHOW_RULE)).toBe(true);
    expect(guideShellData(rendered, null).data.css).toBeNull();
  });
});

describe("withGuideShell", () => {
  const shell = '<html><head><style id="lh-shell-css">.landing{}</style></head><body><div id="root"><div id="boot-loader" role="status"><p>x</p></div></div></body></html>';
  it("puts the page's block first inside #boot-loader and its rules in the inlined block", () => {
    const out = withGuideShell(shell, "/gift-guides/her/", data);
    expect(out).toContain(`<div id="boot-loader" role="status">${data.pages["/gift-guides/her"]}<p>x</p>`);
    expect(out).toContain(`<style id="lh-shell-css">${data.css}</style>`);
    expect(out).not.toContain(".landing{}");
  });
  it("leaves every other page, and a build without rules, as it was", () => {
    expect(withGuideShell(shell, "/gift-guides/nope", data)).toBe(shell);
    expect(withGuideShell(shell, "/browse", data)).toBe(shell);
    expect(withGuideShell(shell, "/gift-guides/her", { css: null, pages: data.pages })).toBe(shell);
    expect(withGuideShell(shell, "/gift-guides/her", null)).toBe(shell);
  });
  it("api/share.ts serves it on the guide pages and main.tsx adopts it before React renders", () => {
    const share = blankComments(readFileSync("api/share.ts", "utf8"));
    expect(share).toMatch(/withGuideShell\(page, path, GUIDE_SHELLS as GuideShellData\)/);
    expect(share).toMatch(/return respond\(guided, meta\.cdnCache/);
    const main = blankComments(readFileSync("src/main.tsx", "utf8"));
    const adopt = main.indexOf("adoptGuideShell(window.location.pathname, tokenProbeAtBoot(), document);");
    expect(adopt).toBeGreaterThan(0);
    expect(adopt).toBeLessThan(main.indexOf("createRoot("));
  });
});

describe("adoptGuideShell", () => {
  afterEach(() => vi.useRealTimers());
  const page = (path = "/gift-guides/her") => {
    document.body.innerHTML = `<div id="root"><div id="boot-loader"><div id="${GUIDE_SHELL_ID}" data-guide-shell="${path}">first screen</div></div></div>`;
  };
  const el = () => document.getElementById(GUIDE_SHELL_ID);

  it("one id everywhere", () => expect(GUIDE_SHELL_ELEMENT_ID).toBe(GUIDE_SHELL_ID));

  it("a guest on the page it was drawn for: moved out of #boot-loader, kept until the page's own list is in", async () => {
    page();
    adoptGuideShell("/gift-guides/her/", false);
    expect(el()?.parentElement).toBe(document.body);
    document.getElementById("root")!.innerHTML = "<p>loading</p>";
    await new Promise((r) => setTimeout(r, 50));
    expect(el()).not.toBeNull();
    document.getElementById("root")!.innerHTML = '<ol><li data-gift-pick="">gift</li></ol>';
    await vi.waitFor(() => expect(el()).toBeNull());
  });

  it("signed in, or another path: removed at once", () => {
    page();
    adoptGuideShell("/gift-guides/her", true);
    expect(el()).toBeNull();
    page("/gift-guides/her");
    adoptGuideShell("/gift-guides/him", false);
    expect(el()).toBeNull();
  });

  it("never longer than GUIDE_SHELL_MAX_MS", () => {
    vi.useFakeTimers();
    page();
    adoptGuideShell("/gift-guides/her", false);
    vi.advanceTimersByTime(GUIDE_SHELL_MAX_MS - 1);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });
});
