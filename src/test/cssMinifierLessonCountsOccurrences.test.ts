import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Q227 (2026-09-23): the css-minifier lesson used to prescribe `grep -c
 * "backdrop-filter:none" dist/assets/*.css` as "the whole check". `npm run
 * build` collapses the bundle onto one (or a handful of) line(s), and `-c`
 * counts MATCHING LINES, not occurrences — so it cannot tell 18 frosted
 * elements from 1, and cannot catch a regression from 18 down to 2. The fix
 * is `grep -o ... | wc -l`, which counts every match on the line.
 *
 * This does not re-derive the CSS itself; it holds the LESSON TEXT to the
 * corrected prescription, so the same wrong advice cannot silently return.
 */
const LESSON_PATH = "docs/lessons/CLAUDE-lessons.md";
const read = () => readFileSync(resolve(__dirname, "../..", LESSON_PATH), "utf8");

function cssMinifierSection(src: string): string {
  const start = src.indexOf('<a id="css-minifier">');
  expect(start, "css-minifier anchor not found in " + LESSON_PATH).toBeGreaterThan(-1);
  const nextAnchor = src.indexOf("\n<a id=", start + 1);
  expect(nextAnchor, "could not find the next lesson anchor to bound the section").toBeGreaterThan(start);
  // Collapse line-wraps so a prescription split across markdown lines still matches.
  return src.slice(start, nextAnchor).replace(/\s+/g, " ");
}

describe("css-minifier lesson counts occurrences, not matching lines", () => {
  it("no longer prescribes grep -c against a minified CSS bundle", () => {
    const section = cssMinifierSection(read());
    // An actual command invocation (grep -c "<pattern>" dist/assets/*.css),
    // not just the words "grep -c" appearing somewhere in the surrounding
    // prose that explains why it is wrong.
    expect(section).not.toMatch(/grep\s+-c\s+"[^"]*"\s+dist\/assets\/\*\.css/);
  });

  it("prescribes grep -o ... | wc -l instead", () => {
    const section = cssMinifierSection(read());
    expect(section).toMatch(/grep\s+-o\s+"backdrop-filter:none"\s+dist\/assets\/\*\.css\s*\|\s*wc\s+-l/);
  });
});

// @mutate docs/lessons/CLAUDE-lessons.md | Use `grep -o "backdrop-filter:none"\n  dist/assets/*.css \| wc -l` | Use `grep -c "backdrop-filter:none"\n  dist/assets/*.css \| wc -l`
