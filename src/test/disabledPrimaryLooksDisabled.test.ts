/**
 * A disabled primary looks disabled (Declutter deep audit #48, 2026-10-28, shots 39-buyer-after-paid-reload-p3-390
 * "Book" with no time picked, and 84a-helpr-vehicle-390 "Save" with no truck photo): both were disabled but sat in
 * full olive, so they read as pressable. The shared <Button> dims with `disabled:opacity-50`; a hand-rolled
 * `<button className="btn-grad-primary">` had nothing, so the dimming now lives on the primary surface itself in
 * src/index.css, unlayered (after `@tailwind utilities`), for `:disabled` and `aria-disabled="true"` alike.
 *
 * Inventory from source: the hand-rolled primaries that can be disabled (a `<button` tag carrying both
 * btn-grad-primary and `disabled=`), floor below; every one of them is covered by the one rule.
 *
 * @mutate src/index.css | .btn-grad-primary:disabled,\n.btn-grad-primary[aria-disabled="true"] {\n  opacity: 0.5; | .btn-grad-primary:disabled,\n.btn-grad-primary[aria-disabled="true"] {\n  opacity: 1;
 * @mutate src/index.css | .btn-grad-primary:disabled,\n.btn-grad-primary[aria-disabled="true"] { | .btn-grad-primary.is-never-disabled {
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

describe("a disabled primary looks disabled (deep audit #48)", () => {
  it("index.css dims a disabled .btn-grad-primary, unlayered and after the surface rule", () => {
    const css = blankCssComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));
    const utilities = css.indexOf("@tailwind utilities;");
    const surface = css.search(/\n\.btn-grad-primary\s*\{/);
    const rule = css.match(/\n\.btn-grad-primary:disabled,\s*\n\.btn-grad-primary\[aria-disabled="true"\]\s*\{([^}]*)\}/);
    expect(utilities).toBeGreaterThan(0);
    expect(surface).toBeGreaterThan(utilities);
    expect(rule, "the disabled .btn-grad-primary rule").not.toBeNull();
    expect(css.indexOf(rule![0])).toBeGreaterThan(surface);
    const opacity = rule![1].match(/opacity:\s*([\d.]+)/);
    expect(opacity, "opacity").not.toBeNull();
    expect(Number(opacity![1])).toBeLessThanOrEqual(0.6);
    expect(rule![1]).toMatch(/cursor:\s*not-allowed/);
  });

  it("the rule has hand-rolled disabled primaries to cover", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.|\/test\//.test(f));
    let n = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      if (!src.includes("btn-grad-primary")) continue;
      for (const m of src.matchAll(/<button\b[\s\S]*?(?:\/>|>)/g)) {
        // Either the class is spelled in the tag or it comes from a `primary` class constant.
        if (/disabled=/.test(m[0]) && /btn-grad-primary|className=\{(?:`\$\{)?primary\b/.test(m[0])) n++;
      }
    }
    expect(n).toBeGreaterThan(10);
  });
});
