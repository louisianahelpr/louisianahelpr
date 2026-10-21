/**
 * THE COMPACT TITLE BAR IS OPAQUE (lead 2026-10-20). `.compact-title-bar`
 * (largeTitles.ts) pins over the page on scroll; at hsl(--background / 0.88)
 * plus a blur the page title and content showed through it (Declutter
 * deliveries, Post a job at 375). It is the solid --background now, keeping
 * its hairline.
 *
 * @mutate src/index.css |   background: hsl(var(--background));\n  border-bottom: 0.5px solid hsl(var(--border));\n  opacity: 0; pointer-events: none; |   background: hsl(var(--background) / 0.88);\n  border-bottom: 0.5px solid hsl(var(--border));\n  opacity: 0; pointer-events: none;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
});
