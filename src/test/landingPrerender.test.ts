// @mutate scripts/prerender-landing.mjs |   return withMarkup.replace( |   return withMarkup; void (
// @mutate scripts/prerender-landing.mjs |   if (!HERO_TEXT.test(markup)) problems.push( |   if (false) problems.push(
// @mutate vercel.json |       "destination": "/app.html" |       "destination": "/index.html"
// @mutate src/pages/info/Index.tsx |     removeLandingPrerender();\n  }, []); |   }, []);
// @mutate index.html |           var skip = location.pathname !== "/"; |           var skip = false;
// @mutate index.html |         display: none !important; /* over its inline display:flex */ |         display: none; /* over its inline display:flex */
/*
 * Q652 (owner, 2026-10-07): `/` paints the landing page as static HTML before
 * any JavaScript runs (scripts/prerender-landing.mjs, src/lib/landingPrerender.ts).
 * The hero is LOCKED: the static copy is the REAL Index rendered at build time,
 * and it leaves the instant React's own landing is in the DOM.
 *
 * Pinned here, each able to fail: the injection (markup before #root, the
 * stylesheet made render-blocking so the copy never paints unstyled), the
 * markup check (the locked H1, assets that exist), the routing (only "/" gets
 * the landing; every other route the plain shell), the build order, the
 * pre-paint skip (signed in, or not on "/"), and both removals.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module
import { assetUrls, checkMarkup, injectPrerender, HERO_TEXT } from "../../scripts/prerender-landing.mjs";
import { LANDING_PRERENDER_ID, removeLandingPrerender } from "@/lib/landingPrerender";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SHELL = [
  "<html><head>",
  '<link rel="preload" as="style" href="/assets/index-abc.css"><link rel="stylesheet" href="/assets/index-abc.css" media="print" data-async-css><noscript><link rel="stylesheet" href="/assets/index-abc.css"></noscript>',
  "</head><body>",
  '<div id="root" style="min-height:100vh;"><div id="boot-loader"></div></div>',
  "</body></html>",
].join("\n");
const HERO = '<h1>Louisiana’s Local Job<!-- --> <em class="x">Partner.</em></h1>';

describe("the landing's build-time first paint (Q652)", () => {
  it("puts the markup in its own container right before #root, and makes the stylesheet render-blocking", () => {
    const out = injectPrerender(SHELL, HERO);
    expect(out).toContain(`<div id="${LANDING_PRERENDER_ID}">${HERO}</div>`);
    expect(out.indexOf(LANDING_PRERENDER_ID)).toBeLessThan(out.indexOf('<div id="root"'));
    expect(out).toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
    expect(out).not.toContain('media="print" data-async-css');
    expect(() => injectPrerender(out, HERO)).toThrow(/already carries/);
  });

  it("refuses markup without the locked H1 or with an asset the build does not have", () => {
    expect(HERO_TEXT.test(HERO)).toBe(true);
    const dist = mkdtempSync(join(tmpdir(), "prerender-"));
    try {
      mkdirSync(join(dist, "assets"));
      writeFileSync(join(dist, "assets", "logo-1.webp"), "x");
      const ok = `${HERO}${"<p>filler</p>".repeat(500)}<img src="/assets/logo-1.webp" srcSet="/assets/logo-1.webp 96w">`;
      expect(ok.length).toBeGreaterThan(6000); // the markup checkMarkup reads is a real page, not an empty string
      expect(assetUrls(ok)).toEqual(["/assets/logo-1.webp"]);
      expect(checkMarkup(ok, dist).problems).toEqual([]);
      expect(checkMarkup(ok.replace("Partner.", "Partner"), dist).problems.join()).toMatch(/locked hero H1/);
      expect(checkMarkup(ok.replace(/logo-1/g, "logo-2"), dist).problems.join()).toMatch(/logo-2\.webp is referenced but not in/);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("serves the landing for \"/\" only; every other SPA route gets the plain shell", () => {
    const rewrites = JSON.parse(read("vercel.json")).rewrites as { source: string; destination: string }[];
    const root = rewrites.findIndex((r) => r.source === "/");
    const all = rewrites.findIndex((r) => r.source === "/((?!api/|_vercel/).*)");
    expect(rewrites[root]?.destination).toBe("/index.html");
    expect(rewrites[all]?.destination).toBe("/app.html");
    expect(root, "the \"/\" rule must come before the catch-all").toBeLessThan(all);
  });

  it("the web build prerenders after the og shell snapshot (which must read the plain shell) and before the CSP check", () => {
    const build = JSON.parse(read("package.json")).scripts.build as string;
    const at = (s: string) => build.indexOf(s);
    expect(at("scripts/prerender-landing.mjs")).toBeGreaterThan(at("scripts/build-og-shell.mjs"));
    expect(at("scripts/prerender-landing.mjs")).toBeLessThan(at("scripts/check-csp-inline-scripts.mjs"));
    expect(JSON.parse(read("package.json")).scripts["build:ios"]).not.toContain("prerender-landing");
  });

  it("a visitor signed in, or not on \"/\", never sees it: marked before first paint, hidden, removed before React", () => {
    const html = read("index.html");
    expect(html).toMatch(/var skip = location\.pathname !== "\/";/);
    expect(html).toMatch(/k\.indexOf\("sb-"\) === 0 && k\.slice\(-11\) === "-auth-token"\) skip = true;/);
    expect(html).toMatch(/html\[data-skip-landing\] #landing-prerender \{\s*display: none;/);
    // The boot loader's own inline style says display:flex; only !important
    // keeps it off the static paint (the first CI capture showed it on top of
    // the H1, run 37582220884).
    expect(html).toMatch(/html:not\(\[data-skip-landing\]\) #landing-prerender ~ #root #boot-loader \{\s*display: none !important;/);
    expect(read("src/main.tsx")).toMatch(/if \(document\.documentElement\.hasAttribute\("data-skip-landing"\)\) removeLandingPrerender\(\);/);
  });

  it("React's landing removes the static copy in a layout effect (before that frame paints)", () => {
    expect(read("src/pages/info/Index.tsx")).toMatch(/useLayoutEffect\(\(\) => \{\n\s+removeLandingPrerender\(\);\n\s+\}, \[\]\);/);
    document.body.innerHTML = `<div id="${LANDING_PRERENDER_ID}"><h1>x</h1></div><div id="root"></div>`;
    expect(removeLandingPrerender(document)).toBe(true);
    expect(document.getElementById(LANDING_PRERENDER_ID)).toBeNull();
    expect(removeLandingPrerender(document)).toBe(false);
  });
});
