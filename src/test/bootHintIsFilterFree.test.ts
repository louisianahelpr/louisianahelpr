/**
 * Q651 (owner decisions, 2026-10-04: "a CSS-only, filter-free loading hint",
 * then "ship it but add the h on top") — a slow cold load shows the
 * wrought-iron H above a sliding olive bar instead of ~3.9 s of bare
 * background (slow 3G, run 36101678860), and the H can never come back as the
 * clipped square it was removed for on 2026-09-23 (5833178bd: an <img> with a
 * drop-shadow FILTER that iPhone WebKit painted as a clipped square).
 *
 * Held from index.html and public/ themselves:
 *   - #boot-loader holds the stack: H then bar; no <img>, no <svg>;
 *   - no CSS rule that styles any of it uses `filter`, `drop-shadow`,
 *     `box-shadow` or `mask`;
 *   - the H box keeps the artwork's own ratio (256:220), so no square box,
 *     and both its images are static public files: the light one a byte copy
 *     of the header's H (src/assets/helpr-logo-256.webp), the dark one with
 *     the filter baked in;
 *   - the stack waits before showing (a normal load sees only the background);
 *   - reduced motion stops the slide.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
const css = blankComments(noComments.match(/<style id="boot-theme">([\s\S]*?)<\/style>/)?.[1] ?? "");

/** Every rule block whose selector names a piece of the boot stack. */
function stackRules(): string[] {
  return [...css.matchAll(/([^{}]*\.boot-(?:stack|h|progress)[^{}]*)\{([^{}]*)\}/g)].map((m) => `${m[1].trim()} { ${m[2].trim()} }`);
}
const rule = (selector: string) => stackRules().find((r) => r.startsWith(selector + " {")) ?? "";

describe("Q651: the boot loading hint is the H over a bar, CSS-only and filter-free", () => {
  it("#boot-loader holds the H then the bar, nothing drawn by <img> or <svg>", () => {
    const start = noComments.indexOf('id="boot-loader"');
    expect(start).toBeGreaterThan(0);
    const shell = noComments.slice(start, noComments.indexOf('<script type="module"', start));
    expect(shell).toMatch(
      /<div class="boot-stack" aria-hidden="true"><div class="boot-h"><\/div><div class="boot-progress"><div class="boot-progress-fill"><\/div><\/div><\/div>/,
    );
    expect(shell).not.toMatch(/<img|<svg|boot-mark/i);
  });

  it("no rule that styles it uses a filter, a shadow or a mask", () => {
    const rules = stackRules();
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) expect(r, r).not.toMatch(/filter|drop-shadow|box-shadow|mask/i);
  });

  it("the H keeps the artwork's ratio and comes from static public files", () => {
    const h = rule("#boot-loader .boot-h");
    const w = Number(/width: ([\d.]+)px;/.exec(h)?.[1]);
    const ht = Number(/height: ([\d.]+)px;/.exec(h)?.[1]);
    expect(ht).toBeGreaterThanOrEqual(56);
    expect(ht).toBeLessThanOrEqual(72);
    expect(Math.abs(w / ht - 256 / 220)).toBeLessThan(0.01);
    expect(h).toContain('url("/boot-h.webp") center / contain no-repeat');
    expect(rule('[data-theme="dark"] #boot-loader .boot-h')).toContain('url("/boot-h-dark.webp")');
    // The light H IS the header's H, byte for byte; the dark one exists.
    expect(readFileSync(resolve(ROOT, "public/boot-h.webp")).equals(readFileSync(resolve(ROOT, "src/assets/helpr-logo-256.webp")))).toBe(true);
    expect(existsSync(resolve(ROOT, "public/boot-h-dark.webp"))).toBe(true);
  });

  it("it waits before it shows, and reduced motion stops the slide", () => {
    expect(rule("#boot-loader .boot-stack")).toMatch(/opacity: 0;[^}]*animation: boot-progress-in \d+ms ease-out \d+ms forwards;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*#boot-loader \.boot-progress-fill \{\s*animation: none;/);
  });
});

// @mutate index.html |         background: url("/boot-h.webp") center / contain no-repeat;\n | background: url("/boot-h.webp") center / contain no-repeat;\n        filter: drop-shadow(0 2px 4px #0006);\n
// @mutate index.html |         <div class="boot-stack" aria-hidden="true"><div class="boot-h"></div> |         <div class="boot-stack" aria-hidden="true"><img class="boot-h" src="/boot-h.webp" alt="">
// @mutate index.html |         width: 74.5px;\n        height: 64px; |         width: 64px;\n        height: 64px;
// @mutate index.html |         gap: 18px;\n        opacity: 0;\n | gap: 18px;\n
