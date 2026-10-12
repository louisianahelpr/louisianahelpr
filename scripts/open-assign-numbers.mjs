#!/usr/bin/env node
/**
 * Queue numbers are assigned at LANDING time (lead, 2026-10-12).
 *
 * WHY. Every lane took "next free" from its own base, so parallel lanes filed
 * the same number. land.sh's open-renumber then moved the branch's item, but
 * a commit subject that named the old number ("file Q1652") now named main's
 * different item, and check-fixes-update-their-items went red on it after
 * the renumber (measured by the queue doctor on fix-land/open-1011,
 * fix-land/proof-ticks and local-mac/q252, 2026-10-12).
 *
 * A new item is filed with a PLACEHOLDER instead of a number:
 *
 *     - [ ] **Q?fill-rate LOW The Fill Rate card reads a failed load as no data.** ...
 *
 * `Q?<tag>` (tag: lowercase letters, digits, dashes) may also be cited
 * anywhere else in docs/OPEN.md or the archives ("see Q?fill-rate"). At land
 * time scripts/land.sh runs this script after the rebase: each distinct tag,
 * in order of first appearance, gets the next number free on both this tree
 * and origin/main (scripts/lib/queueAllocator.mjs, the one minter), and every
 * occurrence of that tag is rewritten. A commit subject never carries a new
 * item's number, so nothing can go stale when numbers move.
 *
 *   node scripts/open-assign-numbers.mjs [--base origin/main] [--dry-run]
 *
 * Guard: src/test/openAssignNumbers.test.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPEN, archiveFiles } from "./lib/openQueue.mjs";
import { nextFreeNumber, qCounter } from "./lib/queueAllocator.mjs";

/** A placeholder queue id: Q?<tag>. */
export const PLACEHOLDER = /\bQ\?([a-z0-9][a-z0-9-]*)/g;

/**
 * Pure: give each placeholder tag a number from `firstFree` upward, in order
 * of first appearance across `files` (OPEN.md first, then the archives), and
 * rewrite every occurrence.
 * @param {{ path: string, text: string }[]} files
 * @param {number} firstFree
 * @returns {{ files: { path: string, text: string, changed: boolean }[], assigned: Map<string, string> }}
 */
export function assignPlaceholders(files, firstFree) {
  const assigned = new Map();
  let next = null;
  for (const f of files) {
    for (const m of f.text.matchAll(PLACEHOLDER)) {
      if (assigned.has(m[1])) continue;
      next ??= qCounter(firstFree);
      assigned.set(m[1], next());
    }
  }
  const out = files.map((f) => {
    const text = f.text.replace(PLACEHOLDER, (_, tag) => assigned.get(tag));
    return { path: f.path, text, changed: text !== f.text };
  });
  return { files: out, assigned };
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--base");
  const base = at >= 0 ? args[at + 1] : "origin/main";
  const dry = args.includes("--dry-run");
  const root = resolve(".");
  const paths = [OPEN, ...archiveFiles(root)];
  const files = paths.map((p) => ({ path: p, text: readFileSync(join(root, p), "utf8") }));
  const firstFree = nextFreeNumber(root, base);
  const { files: out, assigned } = assignPlaceholders(files, firstFree);
  if (!assigned.size) {
    console.log("open-assign-numbers: no placeholder items.");
    return;
  }
  for (const [tag, id] of assigned) console.log(`open-assign-numbers: Q?${tag} -> ${id}`);
  if (dry) return;
  for (const f of out) if (f.changed) writeFileSync(join(root, f.path), f.text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
