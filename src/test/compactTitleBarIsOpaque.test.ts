/**
 * THE COMPACT TITLE BAR IS OPAQUE (lead 2026-10-20). `.compact-title-bar`
 * (largeTitles.ts) pins over the page on scroll; at hsl(--background / 0.88)
 * plus a blur the page title and content showed through it (Declutter
 * deliveries, Post a job at 375). It is the solid --background now, keeping
 * its hairline. And ONE line with an ellipsis (audit A1-L1, 2026-10-29).
 *
 * @mutate src/index.css |   white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n  padding-left: 3.5rem; padding-right: 3.5rem; |   padding-left: 3.5rem; padding-right: 3.5rem;
 * @mutate src/index.css |   display: block; text-align: center;\n  white-space: nowrap; |   display: flex; align-items: center; justify-content: center;\n  white-space: nowrap;
 * @mutate src/index.css |   background: hsl(var(--background));\n  border-bottom: 0.5px solid hsl(var(--border));\n  opacity: 0; pointer-events: none; |   background: hsl(var(--background) / 0.88);\n  border-bottom: 0.5px solid hsl(var(--border));\n  opacity: 0; pointer-events: none;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankCssComments } from "./helpers/blankNonCode";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

describe("the compact title bar is opaque", () => {
  it("solid --background, no see-through alpha, no blur, hairline kept", () => {
    const at = css.indexOf(".compact-title-bar {");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toMatch(/background: hsl\(var\(--background\)\);/);
    expect(block).not.toMatch(/--background\)? \/ 0\.\d|backdrop-filter/);
    expect(block).toMatch(/border-bottom: 0\.5px solid hsl\(var\(--border\)\)/);
  });

  // Audit A1-L1 (2026-10-29, ~/.lh-shots/app-audit-1028/1-declutter/a1-item-buy-p1-375.png): a long Declutter item
  // title wrapped to two lines over the back/share/watch buttons. One line, cut with an ellipsis, centred. A block,
  // not flex: text-overflow never applies to a flex container's anonymous text item.
  it("one line with an ellipsis, centred, a block (not flex) so the ellipsis can apply", () => {
    const at = css.indexOf(".compact-title-bar {");
    const block = blankCssComments(css.slice(at, css.indexOf("}", at)));
    expect(block).toMatch(/white-space: nowrap;/);
    expect(block).toMatch(/overflow: hidden;/);
    expect(block).toMatch(/text-overflow: ellipsis;/);
    expect(block).toMatch(/text-align: center;/);
    expect(block).toMatch(/display: block;/);
    expect(block).not.toMatch(/display: flex/);
  });
});
