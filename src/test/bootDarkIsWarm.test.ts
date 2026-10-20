/**
 * The dark boot shell paints #root with the SAME warm stops as the dark
 * --page-gradient (spec v2 §2, warm charcoal; 2026-10-20). index.html's
 * `[data-theme="dark"] #root` rule is !important and outlives the boot, so
 * when it kept the old cool hue-220 stops a cool grey band showed wherever the
 * page background did not cover #root (seen below the first viewport of the
 * dark /signup, design-a2 handoff).
 *
 * @mutate index.html |         background: linear-gradient(160deg, hsl(36 10% 9%) 0%, hsl(36 10% 10%) 40%, hsl(38 9% 11%) 100%) !important; |         background: linear-gradient(160deg, hsl(220 15% 8%) 0%, hsl(220 12% 11%) 40%, hsl(200 15% 10%) 100%) !important;
 * @mutate index.html |         background-color: hsl(36 10% 9%) !important; |         background-color: hsl(220 15% 8%) !important;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const css = blankComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

describe("the dark boot shell is warm, like the dark page", () => {
  it("#root's dark background uses the dark --page-gradient's stops and a warm base colour", () => {
    const rule = html.match(/\[data-theme="dark"\] #root,[\s\S]*?\{([\s\S]*?)\}/);
    expect(rule, "index.html dark #root rule").not.toBeNull();
    const body = blankComments(rule![1]);
    const grads = [...css.matchAll(/--page-gradient:\s*(linear-gradient\([^;]*\));/g)].map((m) => m[1]);
    expect(grads.length).toBeGreaterThan(1);
    const dark = grads.find((g) => /hsl\(36 /.test(g));
    expect(dark, "a warm dark --page-gradient in src/index.css").toBeDefined();
    expect(body).toContain(`background: ${dark} !important;`);
    expect(body).not.toMatch(/hsl\(2[0-2]0 /);
    expect(body).toMatch(/background-color: hsl\(36 10% 9%\) !important;/);
  });
});
