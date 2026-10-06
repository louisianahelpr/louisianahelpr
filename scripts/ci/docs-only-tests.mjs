#!/usr/bin/env node
/**
 * Docs-only fast path for the Vitest workflow (owner, 2026-10-06: "why are the
 * ticks taking so long"). A PR that changes only files under docs/ (OPEN.md
 * ticks, generated counts, audit ledgers) cannot change what any test of the
 * app's code measures; it can only change what the tests that READ those files
 * see. So for such a PR the workflow runs exactly those tests in one shard
 * instead of all ~1,400 test files in six.
 *
 * Usage: node scripts/ci/docs-only-tests.mjs <base-sha> <head-sha>
 * Prints JSON {docsOnly, files}: docsOnly false (run everything) when any
 * changed path is outside docs/, or when no changed file can be traced.
 * A test is picked when it, or a repo script it imports, names a changed file
 * by its path or base name. Guard: src/test/docsOnlyFastPath.test.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });

export const DOCS_ONLY = /^docs\//;

/** Pure: the test files to run for a docs-only change, or null for "run everything". */
export function pickTests(changed, testFiles, read) {
  if (!changed.length || !changed.every((f) => DOCS_ONLY.test(f))) return null;
  const needles = [...new Set(changed.flatMap((f) => [f, basename(f)]))];
  const names = (src) => needles.some((n) => src.includes(n));
  const scriptCache = new Map();
  const viaScripts = (file, src, depth) => {
    if (depth > 2) return false;
    for (const m of src.matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+\.(?:mjs|js|ts))["']/g)) {
      const target = normalize(join(dirname(file), m[1]));
      if (!/^(scripts|src)\//.test(target) || /\.test\./.test(target)) continue;
      if (!scriptCache.has(target)) {
        let s = "";
        try { s = read(target); } catch { /* Silent by design: an import that does not resolve is simply not a path to the docs. */ }
        scriptCache.set(target, s);
      }
      const s = scriptCache.get(target);
      if (s && (names(s) || viaScripts(target, s, depth + 1))) return true;
    }
    return false;
  };
  const picked = testFiles.filter((t) => {
    const src = read(t);
    return names(src) || viaScripts(t, src, 0);
  });
  return picked.length ? picked : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CHANGED_FILES (newline-separated, from the PR API in CI) or a git range.
  const [base, head] = process.argv.slice(2);
  const changed = (process.env.CHANGED_FILES ?? git("diff", "--name-only", `${base}...${head}`)).split("\n").map((l) => l.trim()).filter(Boolean);
  const tests = git("ls-files", "src").split("\n").filter((f) => /\.test\.(ts|tsx)$/.test(f));
  const files = pickTests(changed, tests, (p) => readFileSync(p, "utf8"));
  process.stdout.write(JSON.stringify({ docsOnly: files !== null, files: files ?? [] }));
}
