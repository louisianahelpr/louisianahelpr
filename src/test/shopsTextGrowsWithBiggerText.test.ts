/**
 * S2-031 (Shops audit 2, 11-12): Bigger text (html.senior-mode, src/index.css) enlarges only the text-ds-* scale.
 * Shops used Tailwind text-xs / text-sm (the same 11px / 13px), so with Bigger text on the money terms, card-hold
 * words and hours stayed 11-13px while labels grew to 16-20px. Every Shops screen now uses text-ds-11 / text-ds-13
 * (identical at the normal size), so all of its words grow. This guard keeps a new text-xs / text-sm out.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["src/components/shops", "src/pages/shops"];
const files = DIRS.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => join(d, f)));

describe("S2-031 Shops words grow with Bigger text", () => {
  it("no Shops file uses text-xs or text-sm (use text-ds-11 / text-ds-13)", () => {
    const hits = files.flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n")
      .map((line, i) => (/(^|[^\w-])text-(xs|sm)(?![\w-])/.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
    expect(files.length).toBeGreaterThan(40);
    expect(hits).toEqual([]);
  });
  it("Bigger text still enlarges the two rungs Shops now uses", () => {
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(css).toMatch(/html\.senior-mode \.text-ds-11 \{ font-size: 16px !important;/);
    expect(css).toMatch(/html\.senior-mode \.text-ds-13 \{ font-size: 16px !important;/);
  });
});
