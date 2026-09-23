/*
 * GUARD (Q24): the shared comment scanner understands regex literals.
 * A `'` inside a regex (src/lib/chunkReload.ts) used to open a fake string that
 * ran to the next `'` in the file, so later comments were read as code by
 * every guard built on blankComments().
 */
// @mutate src/test/helpers/blankNonCode.ts |     if (c === "/" && regexCanStart(src, i)) { |     if (false) {
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankNonCode } from "./helpers/blankNonCode";

describe("blankComments handles regex literals", () => {
  it("a quote inside a regex does not swallow the comments after it", () => {
    const src = [
      // ONE unbalanced quote, as in src/lib/chunkReload.ts
      // (/null is not an object \(evaluating '[\w.]*dispatcher/i).
      "const ok = /evaluating '[\\w.]*dispatcher/i.test(msg) ||",
      "  // SECRET_COMMENT must be blanked",
      "  x;",
      "const s = 'keep me';",
    ].join("\n");
    const out = blankComments(src);
    expect(out).not.toContain("SECRET_COMMENT");
    expect(out).toContain("'keep me'");
    expect(out.length).toBe(src.length);
  });

  it("division is still division", () => {
    const src = "const r = a / b; // DIV_COMMENT\nconst t = total / 2 / 3;";
    const out = blankComments(src);
    expect(out).not.toContain("DIV_COMMENT");
    expect(out).toContain("a / b");
    expect(out).toContain("total / 2 / 3");
  });

  it("a slash inside a character class does not end the regex", () => {
    const src = "const re = /[/']x/; // CLASS_COMMENT\n";
    expect(blankComments(src)).not.toContain("CLASS_COMMENT");
  });

  it("on the real file that exposed it, no comment text survives after the regex", () => {
    const src = readFileSync(resolve(__dirname, "../lib/chunkReload.ts"), "utf8");
    const out = blankNonCode(src);
    // Every line that is purely a // comment in the source must be blank after.
    const lines = src.split("\n");
    const outLines = out.split("\n");
    const leaked = lines
      .map((l, k) => ({ l, o: outLines[k], k }))
      .filter(({ l, o }) => /^\s*\/\//.test(l) && o.trim() !== "")
      .map(({ k }) => k + 1);
    expect(lines.filter((l) => /^\s*\/\//.test(l)).length).toBeGreaterThan(5);
    expect(leaked).toEqual([]);
  });
});
