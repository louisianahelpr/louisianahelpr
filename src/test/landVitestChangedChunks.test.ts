/*
 * GUARD (2026-10-12): land.sh ran its "tests related to what changed" step as
 * ONE `npx vitest run --changed origin/main` process. On fix-land/no-poster-fee
 * (162 heavy test files) node's ~2 GB heap ran out twice, while the same files
 * passed in halves, so the land queue dropped a ready branch for a memory
 * limit. land.sh now runs scripts/land-vitest-changed.mjs: the same set from
 * `vitest list --changed`, in chunks of at most CHUNK files per process, and it
 * fails closed when the list cannot be read.
 *
 * Red first: on origin/main's land.sh the single-process line is still there
 * and scripts/land-vitest-changed.mjs does not exist.
 */
// @mutate scripts/land-vitest-changed.mjs |   for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size)); |   out.push(unique);
// @mutate scripts/land-vitest-changed.mjs |   const unique = [...new Set(files)]; |   const unique = files;
// @mutate scripts/land-vitest-changed.mjs |   if (!Array.isArray(rows)) throw new Error("vitest list did not return an array"); |   if (!Array.isArray(rows)) return [];
// @mutate scripts/land-vitest-changed.mjs | export const CHUNK = 60; | export const CHUNK = 6000;
// @mutate scripts/land.sh |   node scripts/land-vitest-changed.mjs origin/main |   npx vitest run --changed origin/main --passWithNoTests
// @mutate scripts/land.sh |   node scripts/land-vitest-changed.mjs --files $NAMED_TESTS |   npx vitest run $NAMED_TESTS
// @mutate scripts/land.sh |   if [ "${LAND_TRAIN:-}" = 1 ]; then |   if true; then
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { CHUNK, chunkFiles, parseListedFiles } from "../../scripts/land-vitest-changed.mjs";

const ROOT = join(__dirname, "..", "..");

describe("land.sh runs the --changed test set in chunks", () => {
  it("splits a 162-file set (the no-poster-fee OOM) into runs of at most CHUNK, keeping every file once", () => {
    const files = Array.from({ length: 162 }, (_, i) => `src/test/t${i}.test.ts`);
    const chunks = chunkFiles([...files, files[0], files[100]]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(CHUNK);
    expect(chunks.flat()).toEqual(files);
    expect(CHUNK).toBeLessThanOrEqual(80);
    expect(chunkFiles([])).toEqual([]);
    expect(() => chunkFiles(files, 0)).toThrow();
  });

  it("reads vitest list's JSON rows relative to the tree, and fails closed on anything else", () => {
    const cwd = "/w/tree";
    const out = `noise before\n${JSON.stringify([{ file: "/w/tree/src/test/a.test.ts", projectName: "unit" }, { file: "/w/tree/src/b.test.tsx" }])}`;
    expect(parseListedFiles(out, cwd)).toEqual(["src/test/a.test.ts", "src/b.test.tsx"]);
    expect(parseListedFiles("[]", cwd)).toEqual([]);
    expect(() => parseListedFiles("no tests", cwd)).toThrow();
    expect(() => parseListedFiles('[{"name":"x"}]', cwd)).toThrow();
    expect(() => parseListedFiles('{"file":"x"}', cwd)).toThrow();
  });

  it("land.sh calls the chunked runner, and no longer runs --changed as one process", () => {
    const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
    const code = land.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).toContain("node scripts/land-vitest-changed.mjs origin/main");
    expect(code).not.toMatch(/vitest run --changed/);
    // The named-tests run too (2026-10-12: the money batch's named set ran out
    // of heap in one process after its --changed set had passed in chunks).
    expect(code).toContain("node scripts/land-vitest-changed.mjs --files $NAMED_TESTS");
    expect(code).not.toMatch(/npx vitest run \$NAMED_TESTS/);
  });

  // A batch train leaves exactly these two runs to GitHub CI (owner,
  // 2026-10-12), only when LAND_TRAIN=1 is set: a plain land.sh still runs them.
  it("LAND_TRAIN=1 skips only the two local vitest runs, and only when set", () => {
    const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
    const at = land.indexOf('if [ "${LAND_TRAIN:-}" = 1 ]; then');
    expect(at).toBeGreaterThan(-1);
    const end = land.indexOf("\n  fi\n", at);
    const block = land.slice(at, end);
    expect(block).toContain("node scripts/land-vitest-changed.mjs origin/main");
    expect(block).toContain("node scripts/land-vitest-changed.mjs --files $NAMED_TESTS");
    // Nothing else sits inside the skipped branch.
    const skipped = block.slice(block.indexOf("else"));
    expect(skipped.split("\n").filter((l) => /^\s*(npm|npx|node|git)\b/.test(l))).toHaveLength(2);
    // The checks around it still run unconditionally.
    for (const step of ["npx eslint --quiet $CHANGED_LINT", "npm run -s check:counts", "node scripts/check-sensitive-review.mjs"]) {
      expect(land.indexOf(step), step).toBeGreaterThan(-1);
      expect(land.slice(at, end)).not.toContain(step);
    }
    const runner = readFileSync(join(ROOT, "scripts", "land-vitest-changed.mjs"), "utf8");
    expect(runner).toContain('"list", "--changed", base, "--filesOnly", "--json"');
    expect(runner).toMatch(/if \(run\.status !== 0\) \{[\s\S]*?process\.exit\(1\);/);
    expect(runner).toMatch(/if \(list\.status !== 0\) \{[\s\S]*?process\.exit\(1\);/);
  });
});
