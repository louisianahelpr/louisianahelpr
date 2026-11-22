/**
 * The Meta Pixel never rides the HTML (owner, 2026-11-22: "nothing slow for users").
 *
 * Meta's setup page tells you to paste its base code into <head>. Pasted there, the fbq stub runs before first paint
 * and fbevents.js competes with the page's own scripts and fonts; it would also need 'unsafe-inline' or a new hash in
 * the CSP (Q13). The pixel is loaded instead by src/lib/metaPixel.ts, after load + idle, on the website only. This
 * guard fails the day anyone pastes the snippet (or its noscript <img>, which an SPA has no use for) into any HTML the
 * build ships: index.html and every *.html in public/. HTML comments are ignored, so a note about the pixel is fine.
 *
 * @mutate index.html | <meta name="application-name" content="Louisiana Helpr" /> | <meta name="application-name" content="Louisiana Helpr" /><script>!function(f,b,e,v,n,t,s){t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','2088408795197912');</script>
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { stripHtmlComments } from "../../scripts/perf/stripHtmlComments.mjs";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const pages = ["index.html", ...walk("public").filter((f) => f.endsWith(".html"))];

/** Any piece of Meta's base code: the script URL, an fbq call, the pixel id, or the /tr beacon. */
const PIXEL_MARKERS = [/connect\.facebook\.net/i, /fbevents\.js/i, /\bfbq\s*\(/, /2088408795197912/, /facebook\.com\/tr\b/i];

describe("the Meta Pixel is never in the HTML the build ships", () => {
  it("the inventory is real: index.html and the public pages are read, with their scripts", () => {
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const index = stripHtmlComments(readFileSync("index.html", "utf8"));
    expect(index).toMatch(/<head>/);
    expect((index.match(/<script\b/g) ?? []).length).toBeGreaterThan(2);
  });

  it.each(pages)("%s carries no Meta Pixel base code or noscript beacon", (page) => {
    const html = stripHtmlComments(readFileSync(page, "utf8"));
    expect(PIXEL_MARKERS.filter((re) => re.test(html)).map(String)).toEqual([]);
  });

  it("the detector fires on Meta's own snippet (not vacuous)", () => {
    const snippet =
      "<head><script>!function(f,b,e,v){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
      "fbq('init', '2088408795197912');fbq('track', 'PageView');</script>" +
      '<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=2088408795197912&ev=PageView&noscript=1"/></noscript></head>';
    expect(PIXEL_MARKERS.every((re) => re.test(snippet))).toBe(true);
  });

  it("the pixel is loaded from code instead: src/lib/metaPixel.ts injects fbevents.js after load + idle", () => {
    const loader = readFileSync("src/lib/metaPixel.ts", "utf8");
    expect(loader).toContain('"https://connect.facebook.net/en_US/fbevents.js"');
    expect(loader).toMatch(/requestIdleCallback\(run/);
    expect(loader).toMatch(/addEventListener\("load"/);
  });
});
