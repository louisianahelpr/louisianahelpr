#!/usr/bin/env node
/**
 * The tests land.sh must run locally because they READ a changed file by
 * path, which `vitest --changed` (the import graph) cannot see and land.sh's
 * basename grep misses when a test reads a whole directory or a fixed path.
 *
 * 2026-10-07: CI caught cronLivenessCoverage, offerDeadlineBeforeStart,
 * openFeedsMirrored and hireRefusedAcrossBlock on landings whose local pass
 * had skipped them; each reads supabase/migrations/ (every migration) or
 * docs/OPEN.md by path, and each failed only on GitHub, ~20 minutes later.
 *
 *   node scripts/lib/landPathReaders.mjs <changed file>...   # prints test paths, one per line
 *
 * Guard: src/test/landPathReaders.test.ts.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** changed-file pattern -> what a test that reads it by path names */
export const READERS = [
  { changed: /^supabase\/migrations\//, reads: "supabase/migrations|[\"'`]migrations[\"'`]" },
  { changed: /^docs\/OPEN\.md$|^docs\/archive\/OPEN-done-[^/]+\.md$/, reads: "OPEN\\.md|OPEN-done" },
];

export function pathReaders(changed, { cwd = process.cwd() } = {}) {
  const tests = new Set();
  for (const { changed: c, reads } of READERS) {
    if (!changed.some((f) => c.test(f))) continue;
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-l", "-E", reads, "--", "src/**/*.test.ts", "src/**/*.test.tsx"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (e.status !== 1) throw e; // 1 = no match
    }
    for (const t of out.split("\n").filter(Boolean)) tests.add(t);
  }
  return [...tests].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const list = pathReaders(process.argv.slice(2));
  if (list.length) console.log(list.join("\n"));
}
