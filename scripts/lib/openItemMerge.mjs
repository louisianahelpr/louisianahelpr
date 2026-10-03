#!/usr/bin/env node
/**
 * Item-level three-way merge of docs/OPEN.md, for a rebase that stopped on it.
 *
 * WHY. Every landing that files new items appends them after the last queue
 * line, so two landings in flight always conflict there, and a landing that
 * notes an item conflicts with any other that touched a neighbouring line.
 * On 2026-10-03 that stopped five land.sh runs in one evening, each resolved
 * by hand the same way: keep main's copy of every item, take the branch's
 * edit of an item only main left alone, append the branch's new items. Git
 * merges lines; the file's unit is the item. This does what the hand did, and
 * refuses whatever needs a person.
 *
 * The rule, with base = the branch commit's parent (stage 1), ours = main
 * plus what is already replayed (stage 2), theirs = the commit being replayed
 * (stage 3); an "item" is a top-level `- [ ] / [~] / [x] **Q123` line:
 *   - an item only the branch changed takes the branch's line;
 *   - an item only the branch deleted (ticked into an archive) is deleted;
 *   - an item the branch added is appended after main's last queue item (a
 *     number main also uses is left to scripts/open-renumber.mjs, which
 *     land.sh runs right after the rebase);
 *   - the generated queue-count line keeps main's copy (the refresh rewrites it);
 *   - anything else (an item both sides changed, any other line the branch
 *     changed) returns null: a person resolves it.
 *
 *   node scripts/lib/openItemMerge.mjs   # during a stopped rebase; exit 0 = resolved and written
 *
 * Guard: src/test/openItemMerge.test.ts. Used by scripts/land.sh.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ITEM = /^- \[[ x~.]\] \*\*(Q\d+)\b/;
const QUEUE_COUNT = /^\*\*Queue: \d+ items/;

function items(lines) {
  const map = new Map();
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (!m) continue;
    // a number held twice is a collision a person must see
    if (map.has(m[1])) return null;
    map.set(m[1], line);
  }
  return map;
}

/**
 * @param {{ base: string, ours: string, theirs: string }} sides the three file texts
 * @returns {string | null} the merged text, or null when a person must resolve it
 */
export function mergeOpenItems({ base, ours, theirs }) {
  const B = base.split("\n"), O = ours.split("\n"), T = theirs.split("\n");
  const bi = items(B), oi = items(O), ti = items(T);
  if (!bi || !oi || !ti) return null;

  // Non-item lines the branch changed: only the generated count line may differ.
  const baseLines = new Set(B);
  for (const line of T) {
    if (ITEM.test(line) || baseLines.has(line)) continue;
    if (QUEUE_COUNT.test(line)) continue;
    return null;
  }
  const theirsLines = new Set(T);
  for (const line of B) {
    if (ITEM.test(line) || theirsLines.has(line)) continue;
    if (QUEUE_COUNT.test(line)) continue;
    return null; // the branch removed a non-item line
  }

  const changed = new Map();
  const deleted = new Set();
  for (const [q, line] of bi) {
    if (!ti.has(q)) deleted.add(q);
    else if (ti.get(q) !== line) changed.set(q, ti.get(q));
  }
  const added = [...ti.keys()].filter((q) => !bi.has(q));

  // An item both sides changed (or main changed and the branch deleted) needs a person.
  for (const q of [...changed.keys(), ...deleted]) {
    if (oi.get(q) !== bi.get(q)) return null;
  }
  // A new item whose number main now holds for a DIFFERENT item is fine here
  // (open-renumber moves the branch's copy); the very same line twice is not new.
  const out = [];
  for (const line of O) {
    const m = ITEM.exec(line);
    if (m && deleted.has(m[1])) continue;
    out.push(m && changed.has(m[1]) ? changed.get(m[1]) : line);
  }
  const newLines = added.map((q) => ti.get(q)).filter((line) => !O.includes(line));
  if (newLines.length) {
    let last = -1;
    out.forEach((line, i) => { if (ITEM.test(line)) last = i; });
    if (last === -1) return null;
    // after the last item's whole block: its indented continuation lines stay with it
    while (last + 1 < out.length && /^\s{2,}\S/.test(out[last + 1])) last++;
    out.splice(last + 1, 0, ...newLines);
  }
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const show = (stage) => execFileSync("git", ["show", `:${stage}:docs/OPEN.md`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let merged;
  try {
    merged = mergeOpenItems({ base: show(1), ours: show(2), theirs: show(3) });
  } catch (e) {
    console.error(`openItemMerge: could not read the conflict stages: ${e.message}`);
    process.exit(1);
  }
  if (merged === null) {
    console.error("openItemMerge: an item both sides changed, or a non-item line: resolve docs/OPEN.md by hand");
    process.exit(1);
  }
  writeFileSync("docs/OPEN.md", merged);
  console.log("openItemMerge: docs/OPEN.md merged item by item");
}
