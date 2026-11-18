/**
 * prod-audit 43650083979 (11-14): mobile /browse LCP 3492 ms against its KNOWN ceiling 1966. Measured live (cwv-lab,
 * www, guest, Slow 4G + 4x CPU, 375): api/share.ts served the job-card overlay in the HTML, but it stayed
 * `visibility:hidden` until the app's async stylesheet arrived (its show rule lived only there), so the first screen
 * was the boot loader and the LCP the app's own footer emblem at 3.97 s. The overlay's own subset of the app sheet and
 * its show rule now go into /browse's inlined <style id="lh-shell-css">, in place of the other HTML-drawn screens'
 * rules (none of them is drawn on /browse). Local build, guest, 3 cold runs each: 3348 -> 1460 ms (median); desktop
 * 200-208 ms; the overlay paints styled at 1.46 s (~/.lh-shots/b2-perf-1114/local-browse-film-*).
 *
 * @mutate src/lib/browseShellCards.mjs |   return withBrowseShellCss(page, criticalCss); |   return page;
 * @mutate src/lib/browseShellCards.mjs |   if (typeof criticalCss !== "string" \|\| !criticalCss.includes(BROWSE_SHELL_SHOW_RULE)) return page; |   if (typeof criticalCss !== "string") return page;
 * @mutate api/share.ts | withBrowseShell(page, await fetchBrowseShellRows(), Date.now(), BROWSE_SHELL_CSS) | withBrowseShell(page, await fetchBrowseShellRows(), Date.now(), null)
 * @mutate scripts/build-og-shell.mjs |     `export const BROWSE_SHELL_CSS = ${JSON.stringify(browseCss)}; |     `export const BROWSE_SHELL_CSS = null;
 * @mutate scripts/inline-shell-css.mjs |   return shellCriticalCss([{ html: cards + empty + tints, htmlAttr: "" }], css) + BROWSE_SHELL_SHOW_RULE; |   return shellCriticalCss([{ html: cards + empty + tints, htmlAttr: "" }], css);
 * @mutate scripts/inline-shell-css.mjs |   writeFileSync(path.join(dist, BROWSE_CSS_FILE), browse); |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { BROWSE_SHELL_ID, BROWSE_SHELL_SHOW_RULE, withBrowseShell, withBrowseShellCss } from "@/lib/browseShellCards.mjs";
import { BROWSE_CSS_FILE, MAX_BROWSE_INLINE_BYTES, browseShellCriticalCss } from "../../scripts/inline-shell-css.mjs";

const NOW = Date.UTC(2026, 10, 14, 18);
const ROW = { title: "Help move furniture", category: "moving", budget: 80, location: "Baton Rouge, LA", status: "open", created_at: new Date(NOW - 60_000).toISOString() };
const PAGE =
  '<html><head><style id="lh-shell-css">.landing-h1{font-size:44px}</style><link rel="stylesheet" href="/assets/index-x.css" data-async-css></head>' +
  '<body><div id="boot-loader" role="status"></div></body></html>';
// A compiled sheet in Tailwind's shape: rules the overlay uses and one it does not.
const SHEET = [
  ".job-card-title{font-weight:700}",
  ".money-chip{display:inline-flex}",
  ".helpr-emblem{height:2.5rem}",
  ".landing-h1{font-size:44px}",
  ".not-on-browse-xyz{color:red}",
].join("");

describe("/browse's job-card overlay paints with the HTML, not after the app stylesheet", () => {
  it("the overlay's block, with its show rule, replaces the page's inlined block when cards are drawn", () => {
    const css = browseShellCriticalCss(SHEET);
    expect(css).toContain(".job-card-title{font-weight:700}");
    expect(css).toContain(".money-chip{display:inline-flex}");
    expect(css).not.toContain("not-on-browse-xyz");
    expect(css.endsWith(BROWSE_SHELL_SHOW_RULE)).toBe(true);
    const out = withBrowseShell(PAGE, [ROW], NOW, css);
    expect(out).toContain(`<div id="${BROWSE_SHELL_ID}"`);
    expect(out).toContain(`<style id="lh-shell-css">${css}</style>`);
    expect(out).not.toContain(".landing-h1{font-size:44px}</style>");
    // Still before the app sheet, which repeats every rule.
    expect(out.indexOf('<style id="lh-shell-css">')).toBeLessThan(out.indexOf('data-async-css'));
  });

  it("no block without cards, without CSS, or with CSS that lacks the show rule: the page as it was", () => {
    expect(withBrowseShell(PAGE, null, NOW, browseShellCriticalCss(SHEET))).toBe(PAGE);
    expect(withBrowseShell(PAGE, [ROW], NOW, null)).toContain(".landing-h1{font-size:44px}</style>");
    expect(withBrowseShellCss(PAGE, ".job-card-title{font-weight:700}")).toBe(PAGE);
    expect(withBrowseShellCss(PAGE, undefined)).toBe(PAGE);
  });

  it("the build writes it, the share function serves it, the lab measures it", () => {
    const inline = blankComments(readFileSync("scripts/inline-shell-css.mjs", "utf8"));
    expect(BROWSE_CSS_FILE).toBe("lh-browse-shell-css.txt");
    expect(MAX_BROWSE_INLINE_BYTES).toBe(6_000);
    expect(inline).toMatch(/if \(browseGz > MAX_BROWSE_INLINE_BYTES\) throw new Error/);
    expect(inline).toContain("writeFileSync(path.join(dist, BROWSE_CSS_FILE), browse);");
    const og = blankComments(readFileSync("scripts/build-og-shell.mjs", "utf8"));
    expect(og).toContain('path.join(path.dirname(indexHtmlPath), "lh-browse-shell-css.txt")');
    expect(og).toContain("export const BROWSE_SHELL_CSS = ${JSON.stringify(browseCss)};");
    const share = blankComments(readFileSync("api/share.ts", "utf8"));
    expect(share).toContain("withBrowseShell(page, await fetchBrowseShellRows(), Date.now(), BROWSE_SHELL_CSS)");
    const lab = blankComments(readFileSync("scripts/perf/cwv-lab.mjs", "utf8"));
    expect(lab).toContain('const cssFile = join(distDir, "lh-browse-shell-css.txt");');
    // The app sheet still carries the same show rule (src/index.css), so nothing changes once it arrives.
    expect(readFileSync("src/index.css", "utf8")).toContain("#lh-browse-shell { visibility: visible !important; }");
  });
});
