/**
 * LEAD-GOOGLE-NAME (owner, 2026-10-31): Google's OAuth branding check refused
 * because "the app name 'Louisiana Helpr' configured for your OAuth consent
 * screen does not match the app name on your home page". It reads the home
 * page's HTML before JavaScript runs, and the <body> held only the H mark and a
 * long HTML comment: no visible name.
 *
 * The page every route serves (index.html; vite build copies its <body>
 * through unchanged) must now carry, as VISIBLE text in the static body:
 *  - the name "Louisiana Helpr", outside any hidden or aria-only element;
 *  - plain links to /privacy and /terms;
 *  - no HTML comment (a crawler can read one as page text).
 * And once the app runs, the landing's footer still shows the name.
 *
 * Pass a built file to check the deployed shape: INDEX_HTML=dist/index.html.
 *
 * @mutate index.html | <p class="boot-name">Louisiana Helpr</p> | <p class="boot-name" hidden>Louisiana Helpr</p>
 * @mutate index.html | <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p></div> | Privacy Policy · Terms of Service</p></div>
 * @mutate index.html |   <body>\n | <body>\n    <!-- Inline FCP shell: the boot history -->\n
 * @mutate src/components/Footer.tsx |           © {new Date().getFullYear()} Louisiana Helpr · Helpr LLC |           © {new Date().getFullYear()} Helpr LLC
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, process.env.INDEX_HTML || "index.html"), "utf8");
// Parsed as a browser would (DOMParser), not filtered with regexps: CodeQL js/bad-tag-filter.
const page = new DOMParser().parseFromString(html, "text/html");

/** The body as a visitor with the stylesheet sees it: no scripts, styles, <noscript>, or hidden elements. */
function visibleBody(): HTMLElement {
  const body = page.body.cloneNode(true) as HTMLElement;
  const hidden = 'script, style, noscript, [hidden], [aria-hidden="true"], .sr-only';
  for (const el of Array.from(body.querySelectorAll<HTMLElement>(hidden))) el.remove();
  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[style]"))) {
    if (/display:\s*none|visibility:\s*hidden/i.test(el.getAttribute("style") ?? "")) el.remove();
  }
  return body;
}
const visibleText = () => (visibleBody().textContent ?? "").replace(/\s+/g, " ").trim();

describe("the home page names the app before JavaScript runs (LEAD-GOOGLE-NAME)", () => {
  it("reads a real body (floor: the boot shell and the entry script are in it)", () => {
    expect(page.body.querySelector("#boot-loader")).not.toBeNull();
    expect(page.body.innerHTML.length).toBeGreaterThan(500);
  });

  it('shows "Louisiana Helpr" as visible text in the boot shell (not only in <noscript>)', () => {
    expect(visibleText()).toContain("Louisiana Helpr");
  });

  it("links to /privacy and /terms with plain anchors", () => {
    const links = Array.from(visibleBody().querySelectorAll("a")).map((a) => `${a.getAttribute("href")} ${a.textContent ?? ""}`);
    expect(links.some((l) => /^\/privacy .*Privacy/.test(l))).toBe(true);
    expect(links.some((l) => /^\/terms .*Terms/.test(l))).toBe(true);
  });

  it("carries no HTML comment in the body", () => {
    const walker = page.createTreeWalker(page.body, NodeFilter.SHOW_COMMENT);
    const comments: string[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode.textContent ?? "");
    expect(comments).toEqual([]);
  });

  it("the landing's footer shows the name once the app runs", () => {
    const layout = blankComments(readFileSync(resolve(ROOT, "src/components/marketing/PublicLayout.tsx"), "utf8"));
    expect(layout).toMatch(/footer = true,/);
    expect(layout).toMatch(/\{footer && <Footer landing=\{landing\} \/>\}/);
    const footer = blankComments(readFileSync(resolve(ROOT, "src/components/Footer.tsx"), "utf8"));
    expect(footer).toMatch(/© \{new Date\(\)\.getFullYear\(\)\} Louisiana Helpr/);
  });
});
