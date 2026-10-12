#!/usr/bin/env node
/**
 * land.sh's "tests related to what changed" step, in chunks.
 *
 * WHY (2026-10-12): land.sh ran `npx vitest run --changed origin/main` as ONE
 * process. On a big set (fix-land/no-poster-fee: 162 heavy test files) node's
 * ~2 GB heap ran out, twice, while the same files passed in halves; the queue
 * dropped the branch for a memory limit, not a test failure. Batch trains of
 * 10-15 changes make that set bigger still.
 *
 * Now: ask vitest for the same set (`vitest list --changed <base> --filesOnly
 * --json`, the same import graph), then run it CHUNK files per process.
 * Fails closed: if the list cannot be read, or any chunk fails, exit 1.
 *
 * Usage: node scripts/land-vitest-changed.mjs [base=origin/main]
 * Guard: src/test/landVitestChangedChunks.test.ts
 */
import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

export const CHUNK = 60;

/** Split `files` into runs of at most `size`, keeping order and dropping repeats. */
export function chunkFiles(files, size = CHUNK) {
  if (!(size > 0)) throw new Error(`chunk size must be positive, got ${size}`);
  const unique = [...new Set(files)];
  const out = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/**
 * The test files `vitest list --json` printed, relative to `cwd`. Throws on
 * anything that is not a JSON array of { file } rows (fail closed).
 * @param {string} stdout
 * @param {string} cwd
 */
export function parseListedFiles(stdout, cwd) {
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("vitest list printed no JSON array");
  const rows = JSON.parse(stdout.slice(start));
  if (!Array.isArray(rows)) throw new Error("vitest list did not return an array");
  return rows.map((r) => {
    if (!r || typeof r.file !== "string") throw new Error(`vitest list row without a file: ${JSON.stringify(r)}`);
    return relative(cwd, r.file);
  });
}

/** Run `files` CHUNK at a time; exit 1 on the first chunk that fails. */
function runChunks(files, what, cwd) {
  const chunks = chunkFiles(files);
  console.log(`land-vitest-changed: ${files.length} ${what}, ${chunks.length} chunk(s) of at most ${CHUNK}`);
  chunks.forEach((chunk, i) => {
    console.log(`land-vitest-changed: chunk ${i + 1}/${chunks.length} (${chunk.length} files)`);
    const run = spawnSync("npx", ["vitest", "run", ...chunk], { cwd, stdio: "inherit" });
    if (run.status !== 0) {
      console.error(`land-vitest-changed: chunk ${i + 1}/${chunks.length} failed (exit ${run.status})`);
      process.exit(1);
    }
  });
}

function main() {
  const cwd = process.cwd();
  // `--files a b c`: land.sh's named tests (the ones that read a changed file
  // by path, and the repo-wide guards). One process for that set ran out of
  // node's heap on the 2026-10-12 money batch, after the --changed set passed.
  const at = process.argv.indexOf("--files");
  if (at >= 0) {
    runChunks(process.argv.slice(at + 1).filter(Boolean), "named test file(s)", cwd);
    return;
  }
  const base = process.argv[2] || "origin/main";
  const list = spawnSync("npx", ["vitest", "list", "--changed", base, "--filesOnly", "--json", "--passWithNoTests"], {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
  });
  if (list.status !== 0) {
    console.error(`land-vitest-changed: vitest list --changed ${base} exited ${list.status}`);
    process.exit(1);
  }
  runChunks(parseListedFiles(list.stdout, cwd), `test file(s) related to ${base}..HEAD`, cwd);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
