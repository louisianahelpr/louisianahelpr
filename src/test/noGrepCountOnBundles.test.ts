/**
 * Q227: a minified bundle is ONE line, so `grep -c` (matching LINES) prints 1
 * whether a declaration occurs once or fifty times and cannot tell a fixed
 * build from a broken one. No doc or script may prescribe `grep -c` against
 * dist/ output; count occurrences with `grep -o ... | wc -l`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["docs/lessons", "scripts", ".claude/skills"];
const FILES = ["CLAUDE.md", ".claude/AGENT-BRIEF.md"];
export const GREP_C_ON_DIST = /grep\s+(-[a-zA-Z]*c[a-zA-Z]*)\b[^\n|]*\bdist\//;

function walk(dir: string, out: string[]) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const e of entries) {
    if (e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|mjs|js|ts|sh)$/.test(e)) out.push(p);
  }
}

describe("no grep -c against a one-line bundle (Q227)", () => {
  it("the pattern catches the original lesson text", () => {
    expect(GREP_C_ON_DIST.test('`grep -c "backdrop-filter:none" dist/assets/*.css`')).toBe(true);
    expect(GREP_C_ON_DIST.test('`grep -o "backdrop-filter:none" dist/assets/*.css | wc -l`')).toBe(false);
  });

  it("no doc or script prescribes it", () => {
    const files: string[] = FILES.map((f) => join(ROOT, f));
    for (const d of DIRS) walk(join(ROOT, d), files);
    const hits = files.flatMap((f) => {
      if (!existsSync(f)) return [];
      const text = readFileSync(f, "utf8");
      return text.split("\n").flatMap((l, i) => (GREP_C_ON_DIST.test(l) ? [`${f.slice(ROOT.length + 1)}:${i + 1}`] : []));
    });
    expect(hits).toEqual([]);
  });
});
