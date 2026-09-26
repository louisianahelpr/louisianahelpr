#!/usr/bin/env node
/**
 * Move every done ([x]) item out of docs/OPEN.md into the dated archive
 * docs/archive/OPEN-done-YYYY-MM.md, verbatim, grouped by the heading it sat
 * under (docs/OPEN.md Q16). Rules: scripts/lib/openQueue.mjs.
 * Guard: src/test/openQueueArchive.test.ts.
 *
 *   node scripts/archive-done.mjs          # report: exit 1 while OPEN.md holds a done item
 *   node scripts/archive-done.mjs --write  # move them (registered in check-generated-current.mjs,
 *                                          # so `npm run inventories:refresh` runs it)
 * LH_ARCHIVE_DATE=YYYY-MM-DD pins the date (tests); default is today, UTC.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OPEN, appendToArchive, archivePathFor, splitDone } from "./lib/openQueue.mjs";

const ROOT = resolve(process.env.LH_REPO_ROOT ?? join(import.meta.dirname, ".."));
const date = process.env.LH_ARCHIVE_DATE ?? new Date().toISOString().slice(0, 10);
const md = readFileSync(join(ROOT, OPEN), "utf8");
const { kept, moved } = splitDone(md);
const target = archivePathFor(date);

if (process.argv.includes("--write")) {
  if (moved.length) {
    const abs = join(ROOT, target);
    writeFileSync(abs, appendToArchive(existsSync(abs) ? readFileSync(abs, "utf8") : "", moved, date));
    writeFileSync(join(ROOT, OPEN), kept);
  }
  console.log(`archive-done: moved ${moved.length} done item(s) from ${OPEN} to ${target}`);
} else {
  console.log(`archive-done: ${moved.length} done item(s) still in ${OPEN}`);
  if (moved.length) {
    console.error(`Run \`node scripts/archive-done.mjs --write\` (or \`npm run inventories:refresh\`) to move them to ${target}.`);
    process.exitCode = 1;
  }
}
