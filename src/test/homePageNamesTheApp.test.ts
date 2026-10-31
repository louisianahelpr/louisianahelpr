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
// The real tag, after </head>: head comments mention "<body>" in prose.
const body = html.slice(html.indexOf("<body", html.indexOf("</head>")), html.lastIndexOf("</body>"));

/** Text a visitor sees with the stylesheet in the page: drops scripts, styles, comments and hidden elements. */
function visibleText(fragment: string): string {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<([a-z0-9]+)\b[^>]*(\bhidden\b|aria-hidden="true"|display:\s*none|visibility:\s*hidden|class="[^"]*\bsr-only\b)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the home page names the app before JavaScript runs (LEAD-GOOGLE-NAME)", () => {
  it("reads a real body (floor: the boot shell and the entry script are in it)", () => {
    expect(body).toContain('id="boot-loader"');
    expect(body.length).toBeGreaterThan(500);
  });

  it('shows "Louisiana Helpr" as visible text in the boot shell (not only in <noscript>)', () => {
    const shell = body.replace(/<noscript>[\s\S]*?<\/noscript>/gi, " ");
    expect(visibleText(shell)).toContain("Louisiana Helpr");
  });

  it("links to /privacy and /terms with plain anchors", () => {
    const shell = body.replace(/<noscript>[\s\S]*?<\/noscript>/gi, " ");
    expect(shell).toMatch(/<a href="\/privacy">[^<]*Privacy[^<]*<\/a>/);
    expect(shell).toMatch(/<a href="\/terms">[^<]*Terms[^<]*<\/a>/);
  });

  it("carries no HTML comment in the body", () => {
    expect(body.match(/<!--[\s\S]*?-->/g) ?? []).toEqual([]);
  });

  it("the landing's footer shows the name once the app runs", () => {
    const layout = blankComments(readFileSync(resolve(ROOT, "src/components/marketing/PublicLayout.tsx"), "utf8"));
    expect(layout).toMatch(/footer = true,/);
    expect(layout).toMatch(/\{footer && <Footer landing=\{landing\} \/>\}/);
    const footer = blankComments(readFileSync(resolve(ROOT, "src/components/Footer.tsx"), "utf8"));
    expect(footer).toMatch(/© \{new Date\(\)\.getFullYear\(\)\} Louisiana Helpr/);
  });
});
