#!/usr/bin/env node
/**
 * After a land.sh rebase: write the MEASURED value into every exact-count
 * constant whose conflict ./landRebaseResolve.mjs settled with main's value.
 *
 * Both sides of a rebase may move a count (MARKERLESS_PARTLY_DONE,
 * UNNUMBERED_OPEN_LINES, ...) and neither number is right for the merged
 * tree. The guard that owns the constant measures it: run that test file,
 * read vitest's `expected <measured> to be <constant>`, write <measured>, and
 * run it again to prove it green. A guard that still fails stops the land.
 *
 *   node scripts/lib/landRecount.mjs   # reads .git/land-recount.json (land.sh clears it once merged)
 *
 * Guard: src/test/landRebaseResolve.test.ts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The measured value vitest printed for constant `value`, or null. */
export function measuredFrom(output, value) {
  const re = /expected (\d+) to (?:be|equal|strictly equal|deeply equal) (\d+)/g;
  for (const m of output.replace(/\x1b\[[0-9;]*m/g, "").matchAll(re)) if (Number(m[2]) === value) return Number(m[1]);
  return null;
}

export function setConstant(text, name, value) {
  return text.replace(new RegExp(`^(\\s*(?:export\\s+)?const ${name} = )\\d+;`, "m"), `$1${value};`);
}

/** A file's text, or null when it is not there: one call, no exists-then-read race. */
function readOr(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

function runTest(file, cwd) {
  const r = spawnSync("npx", ["vitest", "run", file], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` };
}

export function recount({ cwd = process.cwd(), log = console.log, run = runTest } = {}) {
  const recordPath = execFileSync("git", ["rev-parse", "--git-path", "land-recount.json"], { cwd, encoding: "utf8" }).trim();
  const abs = recordPath.startsWith("/") ? recordPath : `${cwd}/${recordPath}`;
  const recordText = readOr(abs);
  if (recordText === null) return { changed: [], failed: [] };
  const record = JSON.parse(recordText);
  const changed = [];
  const failed = [];
  for (const file of [...new Set(record.map((r) => r.file))]) {
    const path = `${cwd}/${file}`;
    if (readOr(path) === null) continue;
    for (let round = 0; round < 3; round++) {
      const first = run(file, cwd);
      if (first.ok) break;
      let text = readOr(path) ?? "";
      let moved = false;
      for (const { name } of record.filter((r) => r.file === file)) {
        const cur = new RegExp(`const ${name} = (\\d+);`).exec(text);
        if (!cur) continue;
        const measured = measuredFrom(first.out, Number(cur[1]));
        if (measured === null || measured === Number(cur[1])) continue;
        text = setConstant(text, name, measured);
        changed.push(`${file}: ${name} ${cur[1]} -> ${measured}`);
        moved = true;
      }
      if (!moved) {
        failed.push(file);
        break;
      }
      writeFileSync(path, text);
    }
  }
  // The record is KEPT until the landing merges (land.sh removes it then):
  // land.sh drops its own refresh commit and rebases again on every retry,
  // so a value written here must be written again after each rebase, even
  // one with no conflict (2026-10-07: the second run dropped the 28 -> 29
  // recount with the refresh commit and stopped on the guard).
  for (const c of changed) log(`landRecount: ${c} (measured on the rebased tree)`);
  for (const f of failed) log(`landRecount: ${f} still fails after the recount; fix it by hand`);
  return { changed, failed };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { failed } = recount();
  process.exit(failed.length ? 1 : 0);
}
